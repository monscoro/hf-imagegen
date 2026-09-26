/**
 * Pollinations-Video (Phase 1 von generate_video, HF folgt in Phase 3).
 *
 * Ablauf pro Clip: Still liegt lokal vor (generate_image/compose_images-
 * Ergebnis oder Datei) → Upload auf media.pollinations.ai → GET
 * /video/{motion} mit der Media-URL als Startframe → MP4-Download → Ablage
 * in ~/images. Oeffentliche URLs als Startframe brauchen keinen Upload und
 * werden direkt durchgereicht.
 *
 * Duration/Resolution werden hier gegen eine statische Tabelle der
 * Tier-Modelle validiert (spart fehlgeschlagene, aber abgerechnete Calls).
 * Phase 2 ersetzt das durch den Live-Katalog (/video/models).
 */

export const POLLINATIONS_DEFAULT_VIDEO_MODEL = "alibaba/wan-2.7";

export type VideoTier = "draft" | "standard" | "final";

/**
 * Tier → Modell. Draft = billigste Exploration (480p-Cents-Bereich),
 * Standard = Sweet Spot mit Audio, Final = toleranteste Filter.
 * Explizite model_id gewinnt immer gegen den Tier.
 */
export const VIDEO_TIER_MODELS: Record<VideoTier, string> = {
  draft: "bytedance/seedance-1-pro-fast",
  standard: "minimax/minimax-h3-max-turbo",
  final: "x-ai/grok-video-pro",
};

interface KnownDurations {
  min: number;
  max: number;
  /** Wenn gesetzt: nur diese Werte sind gueltig, alles andere scheitert serverseitig. */
  allowed?: number[];
}

/** Aus den APIDOCS (v0.3.0), Stand 09/2026. Unbekannte Modelle: passthrough. */
const KNOWN_DURATIONS: Record<string, KnownDurations> = {
  "alibaba/wan-2.7": { min: 2, max: 15 },
  "alibaba/wan-2.6": { min: 5, max: 15, allowed: [5, 10, 15] },
  "alibaba/wan-2.2-fast": { min: 5, max: 5, allowed: [5] },
  "alibaba/wan-3.0": { min: 5, max: 5, allowed: [5] },
  "bytedance/seedance-1-pro-fast": { min: 2, max: 10 },
  "bytedance/seedance-2.0": { min: 4, max: 15 },
  "bytedance/seedance-2.0-mini": { min: 4, max: 10 },
  "bytedance/seedance-2.0-fast": { min: 4, max: 5 },
  "bytedance/seedance-2.5": { min: 4, max: 4, allowed: [4] },
  "minimax/minimax-h3-max-turbo": { min: 5, max: 15, allowed: [5, 10, 15] },
  "minimax/minimax-h3": { min: 5, max: 5, allowed: [5] },
  "x-ai/grok-video-pro": { min: 1, max: 15 },
  "x-ai/grok-imagine-video-1.5": { min: 1, max: 15 },
  "google/veo-3.1-fast": { min: 4, max: 8, allowed: [4, 6, 8] },
  "amazon/nova-reel-v1": { min: 6, max: 120 },
  "prunaai/p-video": { min: 1, max: 10 },
  "alibaba/happyhorse-1.1": { min: 3, max: 15 },
};

export function resolveVideoModel(modelId: string, tier: VideoTier): { model: string; autoNote: string | null } {
  if (modelId.trim()) return { model: modelId.trim(), autoNote: null };
  const model = tier === "draft" ? VIDEO_TIER_MODELS.draft
    : tier === "final" ? VIDEO_TIER_MODELS.final
    : VIDEO_TIER_MODELS.standard;
  return {
    model,
    autoNote:
      `tier '${tier}' picked '${model}' (draft = cheapest exploration, ` +
      `standard = sweet spot with audio, final = most tolerant filters). ` +
      `Override any time with model_id.`,
  };
}

/** Gueltige Dauer oder Wurf mit den gueltigen Werten (spart abgerechnete Fehlcalls). */
export function resolveVideoDuration(model: string, requested: number): number {
  const known = KNOWN_DURATIONS[model.toLowerCase()];
  if (!known) return requested;
  if (known.allowed && !known.allowed.includes(requested)) {
    throw new Error(
      `Duration ${requested}s is not supported by '${model}'. ` +
      `Valid durations: ${known.allowed.join(", ")}.`
    );
  }
  if (requested < known.min || requested > known.max) {
    throw new Error(
      `Duration ${requested}s is outside '${model}' range (${known.min}–${known.max}s).`
    );
  }
  return requested;
}

const MEDIA_UPLOAD_URL = "https://media.pollinations.ai/upload";
const VIDEO_API_BASE = "https://gen.pollinations.ai/video";

/**
 * Still hochladen, Media-URL zurueck. Antwort ist JSON {id, url, …};
 * Link-Header und Plaintext werden als Fallback akzeptiert.
 * Untagged = unlisted, 30-Tage-Lifecycle — genug fuer einen Startframe.
 */
export async function uploadStillToPollinations(
  buffer: Buffer,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  const ext = mimeType.includes("png") ? "png"
    : mimeType.includes("webp") ? "webp"
    : mimeType.includes("gif") ? "gif"
    : "jpg";
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), `start-frame.${ext}`);
  const res = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Media upload failed: ${res.status} ${res.statusText} ${errText}`);
  }
  try {
    const parsed = (await res.json()) as { url?: string };
    if (parsed?.url) return parsed.url;
  } catch {
    // kein JSON — Fallbacks unten
  }
  const link = res.headers.get("Link") ?? "";
  const match = link.match(/<([^>]+)>/);
  if (match) return match[1];
  throw new Error("Media upload returned no usable URL.");
}

export interface VideoRequestOptions {
  motion: string;
  model: string;
  duration: number;
  /** z.B. "16:9" / "9:16" — leer = Server entscheidet. */
  aspectRatio: string;
  /** Tier-String wie "480p" — leer = Modell-Default. */
  resolution: string;
  audio: boolean;
  /** Startframe zuerst, optional Endframe danach (oeffentliche URLs). */
  imageUrls: string[];
  apiKey: string;
}

/** GET /video/{motion} — synchron, rendert serverseitig Minuten. */
export function buildVideoRequestUrl(opts: VideoRequestOptions): string {
  const url = new URL(`${VIDEO_API_BASE}/${encodeURIComponent(opts.motion)}`);
  url.searchParams.set("model", opts.model);
  url.searchParams.set("duration", String(opts.duration));
  if (opts.aspectRatio.trim()) url.searchParams.set("aspectRatio", opts.aspectRatio.trim());
  if (opts.resolution.trim()) url.searchParams.set("resolution", opts.resolution.trim());
  if (opts.audio) url.searchParams.set("audio", "true");
  url.searchParams.set("safe", "false");
  url.searchParams.set("private", "true");
  url.searchParams.set("nologo", "true");
  for (const imageUrl of opts.imageUrls) {
    url.searchParams.append("image", imageUrl);
  }
  return url.toString();
}

/** MP4 herunterladen. Video rendert Minuten — Timeout entsprechend gross. */
export async function downloadVideo(url: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Pollinations API error: 401 Unauthorized — set pollinationsApiKey in plugin config.");
    }
    if (res.status === 402 || res.status === 403) {
      throw new Error(`Pollinations API error: ${res.status} ${res.statusText} ${errText} — paid_only model or exhausted Pollen budget?`);
    }
    throw new Error(`Pollinations video error: ${res.status} ${res.statusText} ${errText}`);
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!contentType.startsWith("video/") && !contentType.includes("mp4")) {
    const preview = buffer.toString("utf-8").slice(0, 200);
    throw new Error(`Pollinations returned no video (content-type: ${contentType || "unknown"}): ${preview}`);
  }
  return buffer;
}
