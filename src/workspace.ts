import { readdir, stat } from "fs/promises";
import * as path from "path";

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

/**
 * Kompakte, paginierte Auflistung der Bilder im Output-Verzeichnis —
 * gleichzeitig generierte Ergebnisse (generate_image/image_edit) UND
 * Input-/Referenzbilder, gegen die image_edit bloße Dateinamen zuerst auflöst.
 * Absichtlich auf dieses eine Verzeichnis begrenzt (kein beliebiger Dateizugriff):
 * große Verzeichnisse werden in häppchenweisen Seiten gelesen statt komplett in den Kontext.
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
