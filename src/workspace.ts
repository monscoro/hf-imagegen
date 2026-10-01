import { readdir, stat } from "fs/promises";
import * as path from "path";
import { getCacheFile } from "./cachePaths";

export interface OutputImageEntry {
  filename: string;
  bytes: number;
  modified_iso: string;
}

export interface OutputImageList {
  total: number;
  offset: number;
  limit: number;
  entries: OutputImageEntry[];
}

export type OutputImageSort = "newest" | "oldest" | "name";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

// ---------------------------------------------------------------------------
// Working-Dir-Scoping fuer die Neigungsprompt-Aktivierung
// ---------------------------------------------------------------------------

/**
 * Aktiver Stack fuer genau EINEN Working Dir. Der Stack (welche Profile und
 * Library-Records gerade wirken) ist bewusst nicht global: ein Chat in
 * Verzeichnis A darf keinen Neigungsprompt nachziehen, den das LLM in
 * Verzeichnis B aktiviert hat. Deshalb liegt die Datei im Working Dir selbst
 * — sichtbar, git-ignorable, und beim Wechsel des Verzeichnisses wechselt der
 * Stack mit.
 *
 * Ohne Working Dir (Chat ohne angehaengten Ordner) greift der Bucket
 * `NO_WORKING_DIR_KEY`. Er ist ein eigener, persistenter Bucket — kein
 * Nonsense-Fallback auf einen globalen Stack, denn genau den gibt es nicht
 * mehr. Die Tools melden diesen Zustand explizit zurück.
 */
export const NO_WORKING_DIR_KEY = "(none)";

/** Dateiname im Working Dir. Punkt-Praefix, damit er in Editoren/Tools als hidden gilt. */
const STACK_FILENAME = ".image-gen-inclinations.json";

/** Nur Controller mit Working-Dir-Zugriff; BaseController.getWorkingDirectory() wirft. */
export interface WorkingDirCapable {
  getWorkingDirectory(): string;
}

/**
 * Ermittelt den Scope-Key des aktuellen Chats. `getWorkingDirectory()` wirft
 * bewusst, wenn kein Ordner angehaengt ist — das ist hier der Normalfall und
 * kein Fehler, wird deshalb gefangen.
 *
 * Ohne Controller (Tools) wird der vom PromptPreprocessor gemeldete Key
 * verwendet; ohne Prediction ueberhaupt greift der (none)-Bucket.
 */
export function resolveWorkingDirKey(ctl: WorkingDirCapable | undefined | null): string {
  if (ctl && typeof ctl.getWorkingDirectory === "function") {
    try {
      const dir = ctl.getWorkingDirectory();
      if (typeof dir === "string" && dir.trim()) return path.resolve(dir.trim());
    } catch {
      // kein Working Dir attached — (none)-Bucket
    }
    return NO_WORKING_DIR_KEY;
  }
  return predictionScopeKey ?? NO_WORKING_DIR_KEY;
}

/** Anzeigename fuer den Bucket: der Pfad selbst oder der (none)-Marker. */
export function workingDirLabel(key: string): string {
  return key === NO_WORKING_DIR_KEY ? NO_WORKING_DIR_KEY : key;
}

/**
 * Vom PromptPreprocessor gesetzter Scope fuer die laufende Prediction.
 *
 * Der LM-Studio-SDK reicht den Working Dir an Tools NICHT durch: der
 * `toolCallContext` besteht nur aus status/warn/signal/callId (im SDK fest
 * verdrahtet), `getWorkingDirectory()` gibt es nur auf dem Controller. Der
 * Preprocessor laeuft aber bei jedem Turn VOR den Tools desselben Turns und
 * hat den Controller — er ist damit der einzige Ort, der den Working Dir
 * kennt, und fungiert als Broker fuer die Inclination-Tools.
 *
 * `null` = noch keine Prediction gesehen. Die Stores behandeln das wie
 * "(none)", damit ein Tool-Aufruf ausserhalb einer Prediction nicht auf einen
 * Stack eines frueheren Verzeichnisses zurueckfaellt.
 */
let predictionScopeKey: string | null = null;

/** Vom PromptPreprocessor einmal pro Turn aufgerufen. */
export function setPredictionScopeKey(key: string): void {
  predictionScopeKey = key;
}

/**
 * Absolute Datei des aktiven Stacks fuer diesen Working Dir.
 *
 * Fuer den (none)-Bucket liegt sie im Cache-Verzeichnis (es gibt keinen
 * Ordner, in den geschrieben werden koennte), fuer echte Working Dirs im
 * Verzeichnis selbst. Der Dateiname ist ueberall gleich, weil er nie einen
 * Pfad repraesentiert — der eigentliche Working Dir steht als `dir` im JSON
 * und wird nicht in den Dateinamen uebersetzt (keine Sonderzeichen, keine
 * Trennzeichen, keine Kollisionen zwischen gleichen Basisnamen).
 */
export function activeStackFileFor(key: string): string {
  if (key === NO_WORKING_DIR_KEY) {
    return getCacheFile(path.join("stacks", `${NO_WORKING_DIR_KEY}.json`));
  }
  return path.join(key, STACK_FILENAME);
}

/**
 * Kompakte, paginierte Auflistung der Bilder EINES Verzeichnisses — von
 * list_image_directory pro Eintrag in 'directories' aufgerufen (Default: das
 * Output-Verzeichnis mit generierten Ergebnissen UND Input-/Referenzbildern,
 * gegen die image_edit bloße Dateinamen zuerst aufloest). Beliebige lokale
 * Verzeichnisse sind ok: image_edit oeffnet ohnehin jede absolute Pfadangabe
 * als Input, das reine Auflisten ist kein zusaetzlicher Zugriff.
 * Fehlendes Verzeichnis = leere Liste, kein Fehler.
 */
export async function listOutputImages(
  dir: string,
  opts: { sort: OutputImageSort; limit: number; offset: number; filter: string }
): Promise<OutputImageList> {
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const offset = Math.max(opts.offset, 0);

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { total: 0, offset, limit, entries: [] };
  }

  const f = opts.filter.trim().toLowerCase();
  const candidates = names.filter(
    (n) => IMAGE_EXT.test(n) && (!f || n.toLowerCase().includes(f))
  );

  const withStat = await Promise.all(
    candidates.map(async (filename) => {
      try {
        const s = await stat(path.join(dir, filename));
        if (!s.isFile()) return null;
        return { filename, bytes: s.size, mtime: s.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  const valid = withStat.filter((e): e is NonNullable<typeof e> => e !== null);

  switch (opts.sort) {
    case "oldest":
      valid.sort((a, b) => a.mtime - b.mtime);
      break;
    case "name":
      valid.sort((a, b) => a.filename.localeCompare(b.filename));
      break;
    case "newest":
    default:
      valid.sort((a, b) => b.mtime - a.mtime);
      break;
  }

  return {
    total: valid.length,
    offset,
    limit,
    entries: valid
      .slice(offset, offset + limit)
      .map(({ filename, bytes, mtime }) => ({
        filename,
        bytes,
        modified_iso: new Date(mtime).toISOString(),
      })),
  };
}
