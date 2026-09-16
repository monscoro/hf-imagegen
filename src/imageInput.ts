import { readFile } from "fs/promises";
import * as os from "os";
import * as path from "path";

export interface ResolvedImageInput {
  buffer: Buffer;
  mimeType: string;
  source: "file" | "url";
}

function sniffImageMime(buffer: Buffer, fallbackExt = ""): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 6).startsWith("GIF8")) {
    return "image/gif";
  }
  const ext = fallbackExt.toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Normalisiert den image_edit-Input zu Bytes: lokaler Pfad (inkl. ~) oder öffentliche URL.
 * Bloße Dateinamen werden zusätzlich in extraBases (z.B. Output-Verzeichnis) gesucht —
 * das deckt Prompts wie "nimm das Bild NAME aus dem Working Dir" ab.
 * Unbekannte/fehlende Dateien, tote URLs und Nicht-Bilder scheitern mit klaren Fehlern
 * inkl. der durchsuchten Orte.
 */
export async function resolveImageInput(
  input: string,
  extraBases: string[] = []
): Promise<ResolvedImageInput> {
  const clean = input.trim();
  if (!clean) {
    throw new Error("image parameter is required: local file path or public image URL.");
  }

  if (/^https?:\/\//i.test(clean)) {
    const res = await fetch(clean, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw new Error(`Could not download reference image: ${res.status} ${res.statusText}`);
    }
    const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    const sniffed = sniffImageMime(buffer);
    if (!headerMime.startsWith("image/") && !sniffed) {
      throw new Error(
        `URL does not point to an image (content-type: ${headerMime || "unknown"}).`
      );
    }
    return { buffer, mimeType: sniffed ?? headerMime, source: "url" };
  }

  const expanded = expandHome(clean);
  const candidates = path.isAbsolute(expanded)
    ? [expanded]
    : [path.resolve(expanded), ...extraBases.map((b) => path.join(b, expanded))];

  let buffer: Buffer | null = null;
  for (const candidate of candidates) {
    try {
      buffer = await readFile(candidate);
      break;
    } catch {
      // next candidate
    }
  }
  if (!buffer) {
    throw new Error(
      `Reference image not found: "${clean}". Searched: ${candidates.join(" | ")}. ` +
      `Use an existing local path, a bare filename from the output directory, or a public http(s) URL.`
    );
  }
  const mimeType = sniffImageMime(buffer, path.extname(clean));
  if (!mimeType) {
    throw new Error(`File is not a recognized image (jpeg/png/webp/gif): "${clean}".`);
  }
  return { buffer, mimeType, source: "file" };
}
