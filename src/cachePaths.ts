import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Zentrale Ablageorte fuer alle Plugin-Caches und -Stores.
 *
 * Vor dem Umbenennen von `hf-image-gen` auf `image-gen` lagen die Dateien in
 * ~/.cache/hf-image-gen/. Der alte Name bleibt als Legacy-Pfad erhalten:
 * `resolveExistingCacheFile` faellt darauf zurueck, solange die neue Datei
 * noch fehlt, damit Directives (Neigungsprompts) und die Bibliothek nach dem
 * Update nicht verloren gehen. `dropLegacyCacheFile` entfernt die alte Datei,
 * sobald in die neue geschrieben wurde — ein Downgrade liest sonst einen
 * eingefrorenen Stand.
 *
 * Ueberschreiben laesst sich der Pfad per IMAGE_GEN_CACHE_DIR (alt:
 * HF_IMAGE_GEN_CACHE_DIR, wird weiterhin gelesen), damit Tests und Probes die
 * echten Dateien nicht anfassen. Mit gesetztem Override gibt es bewusst
 * weder Legacy-Fallback noch das tmp/-Verzeichnis.
 */
const CACHE_DIR_NAME = "image-gen";
const LEGACY_CACHE_DIR_NAME = "hf-image-gen";

/** Erster nicht-leerer Wert aus IMAGE_GEN_CACHE_DIR / HF_IMAGE_GEN_CACHE_DIR. */
function overrideDir(): string | null {
  for (const raw of [process.env.IMAGE_GEN_CACHE_DIR, process.env.HF_IMAGE_GEN_CACHE_DIR]) {
    const value = (raw ?? "").trim();
    if (value) return value;
  }
  return null;
}

export function getCacheDir(): string {
  return overrideDir() ?? path.join(os.homedir(), ".cache", CACHE_DIR_NAME);
}

export function getCacheFile(name: string): string {
  return path.join(getCacheDir(), name);
}

function legacyCacheFile(name: string): string {
  return path.join(os.homedir(), ".cache", LEGACY_CACHE_DIR_NAME, name);
}

/**
 * Lesepfad: erster existierender Kandidat aus `extraCandidates` (z. B. das
 * project-lokale tmp/), dem aktuellen Cache und dem Legacy-Verzeichnis.
 * Ohne Treffer wird der aktuelle Cache zurueckgegeben (Datei existiert dann
 * noch nicht).
 */
export function resolveExistingCacheFile(name: string, extraCandidates: string[] = []): string {
  const current = getCacheFile(name);
  const candidates = overrideDir() ? [current] : [...extraCandidates, current, legacyCacheFile(name)];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // nicht lesbar / Race — als "nicht vorhanden" behandeln
    }
  }
  return current;
}

/**
 * Legacy-Datei nach einem erfolgreichen Schreiben in den aktuellen Cache
 * entfernen. Best-effort: ein Fehler darf den Store nicht beeinflussen.
 */
export function dropLegacyCacheFile(name: string): void {
  if (overrideDir()) return;
  try {
    const legacy = legacyCacheFile(name);
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
  } catch {
    // beste-effort
  }
}
