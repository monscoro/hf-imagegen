/**
 * Pollinations-Video (Phase 1 von generate_video, HF folgt in Phase 3).
 *
 * Ablauf pro Clip: Still liegt lokal vor (generate_image/compose_images-
 * Ergebnis oder Datei) → Upload auf media.pollinations.ai → GET
 * /video/{motion} mit der Media-URL als Startframe → MP4-Download → Ablage
 * in ~/images. Oeffentliche URLs als Startframe brauchen keinen Upload und
 * werden direkt durchgereicht.
 *
 * Alle Modell-Limits (Dauer, Resolution, Aspect, Audio, Endframe) werden VOR
 * dem Call gegen statische Tabellen aus den APIDOCS (v0.3.0) und dem
 * Live-Katalog (GET /video/models) validiert: harte Fehler werfen (fail fast
 * statt abgerechnetem Fehlcall), weiche werden als Note gemeldet. Phase 2
 * ersetzt die Tabellen durch den Live-Katalog.
 */

export type VideoTier = "draft" | "standard" | "final";

/**
 * Tier → Modell (kanonische IDs aus GET /video/models, keine Aliase).
 * Draft = billigste Exploration, Standard = Sweet Spot mit Audio,
 * Final = toleranteste Filter. Explizite model_id gewinnt immer.
 */
export const VIDEO_TIER_MODELS: Record<VideoTier, string> = {
  draft: "bytedance/seedance-1-pro-fast",
  standard: "minimax/minimax-h3-max-turbo",
  final: "x-ai/grok-imagine-video",
};

interface KnownDurations {
  min: number;
  max: number;
  /** Nur diese Werte sind gueltig, alles andere scheitert serverseitig. */
  allowed?: number[];
  /** Dauer muss ein Vielfaches sein (nova-reel: 6er-Schritte). */
  step?: number;
}

/** APIDOCS v0.3.0 + Live-Katalog, Stand 09/2026. Unbekannte Modelle: passthrough. */
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
  "x-ai/grok-imagine-video": { min: 1, max: 15 },
  "x-ai/grok-imagine-video-1.5": { min: 1, max: 15 },
  "google/veo-3.1-fast": { min: 4, max: 8, allowed: [4, 6, 8] },
  "google/gemini-omni-1.1-flash": { min: 3, max: 10 },
  "amazon/nova-reel-v1": { min: 6, max: 120, step: 6 },
  "prunaai/p-video": { min: 1, max: 10 },
  "alibaba/happyhorse-1.1": { min: 3, max: 15 },
};

/** resolutions[] aus dem Live-Katalog. Fehlt das Modell → passthrough. */
const KNOWN_RESOLUTIONS: Record<string, string[]> = {
  "minimax/minimax-h3-max-turbo": ["480p", "768p", "1080p"],
  "google/gemini-omni-1.1-flash": ["720p", "360p", "1080p", "4k"],
  "alibaba/wan-3.0": ["480p", "720p", "1080p"],
  "bytedance/seedance-2.0-fast": ["480p"],
  "bytedance/seedance-2.0-mini": ["720p", "480p"],
  "minimax/minimax-h3": ["480p", "768p", "2k"],
  "bytedance/seedance-2.5": ["480p", "720p"],
  "x-ai/grok-imagine-video-1.5": ["720p", "480p", "1080p"],
  "alibaba/wan-2.7": ["720p", "1080p"],
  "prunaai/p-video": ["720p", "1080p"],
  "bytedance/seedance-1-pro-fast": ["720p", "480p", "1080p"],
  "google/veo-3.1-fast": ["720p", "1080p"],
};

/** Aspect-Ratios aus den Docs. Default: 16:9/9:16 (dokumentiert: "most models"). */
const KNOWN_ASPECTS: Record<string, string[]> = {
  "minimax/minimax-h3-max-turbo": ["16:9", "9:16", "21:9", "4:3", "1:1", "3:4"],
  "minimax/minimax-h3": ["16:9"],
};
const DEFAULT_ASPECTS = ["16:9", "9:16"];

/** In irgendeiner Tabelle bekannt (Dauer/Resolution/Caps) → validierbar. */
function isKnownVideoModel(lookup: string): boolean {
  return (
    lookup in KNOWN_DURATIONS ||
    lookup in KNOWN_RESOLUTIONS ||
    END_FRAME_MODELS.has(lookup) ||
    AUDIO_CAPABLE_MODELS.has(lookup)
  );
}
/** Modelle mit end_frame in video_capabilities (Live-Katalog). */
const END_FRAME_MODELS = new Set([
  "minimax/minimax-h3-max-turbo",
  "google/gemini-omni-1.1-flash",
  "alibaba/wan-3.0",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-2.0-mini",
  "bytedance/seedance-2.5",
  "bytedance/seedance-2.0",
  "alibaba/wan-2.7",
  "alibaba/wan-2.2-fast",
  "google/veo-3.1-fast",
]);

/** Modelle mit audio_output in video_capabilities (Live-Katalog). */
const AUDIO_CAPABLE_MODELS = new Set([
  "minimax/minimax-h3-max-turbo",
  "minimax/minimax-h3",
  "google/gemini-omni-1.1-flash",
  "alibaba/wan-3.0",
  "alibaba/wan-2.7",
  "alibaba/wan-2.6",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-2.0-mini",
  "bytedance/seedance-2.5",
  "bytedance/seedance-2.0",
  "x-ai/grok-imagine-video-1.5",
  "google/veo-3.1-fast",
]);

export interface VideoTargetInput {
  modelId: string;
  tier: VideoTier;
  duration: number;
  resolution: string;
  aspectRatio: string;
  audio: boolean;
  wantEndFrame: boolean;
}

export interface ResolvedVideoTarget {
  model: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  audio: boolean;
  sendEndFrame: boolean;
  notes: string[];
}

/**
 * Einstiegspunkt der Modell-Aufloesung: Tier → Modell, dann alle Limits.
 * Harte Fehler werfen (fail fast vor jedem bezahlten Call), weiche landen
 * in notes. Unbekannte Modelle laufen im Passthrough (Phase 2 validiert live).
 */
export function resolveVideoTarget(input: VideoTargetInput): ResolvedVideoTarget {
  const notes: string[] = [];
  const key = input.modelId.trim().toLowerCase();

  let model: string;
  if (key) {
    model = input.modelId.trim();
  } else {
    model = VIDEO_TIER_MODELS[input.tier];
    notes.push(
      `tier '${input.tier}' picked '${model}' (draft = cheapest exploration, ` +
      `standard = sweet spot with audio, final = most tolerant filters). ` +
      `Override any time with model_id.`
    );
  }
  const lookup = model.toLowerCase();

  const known = KNOWN_DURATIONS[lookup];
  if (known) {
    if (known.allowed && !known.allowed.includes(input.duration)) {
      throw new Error(
        `Duration ${input.duration}s is not supported by '${model}'. ` +
        `Valid durations: ${known.allowed.join(", ")}.`
      );
    }
    if (input.duration < known.min || input.duration > known.max) {
      throw new Error(
        `Duration ${input.duration}s is outside '${model}' range (${known.min}–${known.max}s).`
      );
    }
    if (known.step && input.duration % known.step !== 0) {
      throw new Error(
        `Duration ${input.duration}s is not supported by '${model}'. ` +
        `Duration must be a multiple of ${known.step} (range ${known.min}–${known.max}s).`
      );
    }
  }

  let resolution = input.resolution.trim();
  const knownRes = KNOWN_RESOLUTIONS[lookup];
  if (resolution && knownRes && !knownRes.includes(resolution)) {
    throw new Error(
      `Resolution '${resolution}' is not supported by '${model}'. ` +
      `Valid tiers: ${knownRes.join(", ")}.`
    );
  }

  let aspectRatio = input.aspectRatio.trim();
  if (aspectRatio) {
    const valid = KNOWN_ASPECTS[lookup] ?? DEFAULT_ASPECTS;
    if (!valid.includes(aspectRatio)) {
      throw new Error(
        `Aspect ratio '${aspectRatio}' is not supported by '${model}'. ` +
        `Valid: ${valid.join(", ")}.`
      );
    }
  }

  let audio = input.audio;
  if (audio && isKnownVideoModel(lookup) && !AUDIO_CAPABLE_MODELS.has(lookup)) {
    audio = false;
    notes.push(`audio=true is not supported by '${model}' and was ignored.`);
  }

  let sendEndFrame = input.wantEndFrame;
  if (sendEndFrame && isKnownVideoModel(lookup) && !END_FRAME_MODELS.has(lookup)) {
    sendEndFrame = false;
    notes.push(`'${model}' has no end_frame capability — end_image was ignored (start frame only).`);
  }

  return { model, duration: input.duration, resolution, aspectRatio, audio, sendEndFrame, notes };
}

const MEDIA_UPLOAD_URL = "https://media.pollinations.ai/upload";
const VIDEO_API_BASE = "https://gen.pollinations.ai/video";

/**
 * Still hochladen, Media-URL zurueck. Antwort ist JSON {id, url, …} —
 * gelesen wird der Body als Text (JSON-Versuch, dann Link-Header, dann
 * blanke URL), damit kein Formatwechsel den Upload kippt. Untagged =
 * unlisted, 30-Tage-Lifecycle — genug fuer einen Startframe.
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
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { url?: string };
    if (parsed?.url) return parsed.url;
  } catch {
    // kein JSON — Fallbacks unten
  }
  if (/^https?:\/\/\S+$/.test(text.trim())) return text.trim();
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
}

/**
 * GET /video/{motion} — synchron, rendert serverseitig Minuten. Auth laeuft
 * ueber den Authorization-Header beim Download (kein Key in der URL).
 * safe=false/private/nologo wie bei den Bild-Endpoints: Filter aus, kein
 * Feed, kein Watermark mit Key.
 */
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
  // Doku: mehrere URLs mit "|" getrennt in EINEM image-Parameter.
  if (opts.imageUrls.length > 0) url.searchParams.set("image", opts.imageUrls.join("|"));
  return url.toString();
}

/**
 * MP4 herunterladen. Video rendert Minuten — Timeout entsprechend gross.
 * Akzeptiert video/*, mp4 und octet-stream (manche Gateways typisieren um);
 * Text/JSON ist immer ein Fehlerbody und wird als Vorschau gemeldet.
 */
export async function downloadVideo(url: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(900_000),
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
  const looksVideo =
    contentType.startsWith("video/") ||
    contentType.includes("mp4") ||
    contentType.includes("octet-stream");
  if (!looksVideo) {
    const preview = buffer.toString("utf-8").slice(0, 200);
    throw new Error(`Pollinations returned no video (content-type: ${contentType || "unknown"}): ${preview}`);
  }
  return buffer;
}
