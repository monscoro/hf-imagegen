import type { ModelInfo } from "./types";

/**
 * Pollinations.ai backend — zweites Backend neben HuggingFace.
 *
 * - Neue API: https://gen.pollinations.ai (GET /image/{prompt}, POST /v1/images/generations)
 * - Auth: Bearer Token via Authorization-Header (POST) bzw. ?key= (GET)
 * - Modell-IDs: volle IDs UND Kurz-Aliase funktionieren auf gen.pollinations.ai
 *   (z.B. black-forest-labs/flux.1-schnell === flux). Volle IDs bevorzugt.
 * - Quality-Parameter: nur für gptimage-Modelle dokumentiert, sonst ignoriert.
 * - seed: nur als Query-Param von GET /image/{prompt} dokumentiert, NICHT im POST-Body.
 * - Der alte Host image.pollinations.ai ist deprecated und wird nicht mehr genutzt.
 *
 * Qualitäts-Hinweise für komplexe, detailreiche Prompts:
 * - `black-forest-labs/flux.1-schnell`: Solide Basis, 1024px
 * - `black-forest-labs/flux.1-kontext-pro`: Azure-FLUX, ideal für komplexe Prompts
 * - `bytedance/seedream-5.0-lite`: ByteDance, sehr hoch, min 1920x1920 (paid_only)
 * - `google/gemini-3-pro-image`: Gemini 3 Pro, bis 4K, höchste Qualität
 */
export const POLLINATIONS_DEFAULT_MODEL = "black-forest-labs/flux.1-schnell";

export const POLLINATIONS_ANON_COOLDOWN_MS = 15_000;

export const POLLINATIONS_KNOWN_MODELS: ModelInfo[] = [
  {
    id: "black-forest-labs/flux.1-schnell",
    description:
      "FLUX.1 Schnell — Standard T2I. Solide Qualität, 1024px. " +
      "Guter Allrounder für die meisten Prompts.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.1-kontext-pro",
    description:
      "FLUX.1 Kontext Pro — Azure-FLUX. " +
      "Ideal für komplexe Prompts. ACHTUNG: Strenge Content-Filter — " +
      "Fashion-Editorial mit intimen Details kann als Sexual_Prompt geflaggt werden.",
    style: "photorealistic, artistic, editing",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.2-klein-4b",
    description:
      "FLUX.2 Klein 4B — Schnell, aber 4B Parameter. " +
      "Zu klein für komplexe Szenen, nur für schnelle Takes.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.2-pro",
    description:
      "FLUX.2 Pro — Neues FLUX-2 Flaggschiff. " +
      "Höchste Qualität, flexibel für 1k–2k. Empfohlen für Production.",
    style: "photorealistic, cinematic",
    speed: "medium",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.2-flex",
    description:
      "FLUX.2 Flex — FLUX-2 variabel. " +
      "Gute Qualität, schnellere Inferenz als Pro.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "bytedance/seedream-5.0-lite",
    description:
      "Seedream 5.0 Lite — ByteDance, sehr hohe Qualität. " +
      "Min. 1920x1920 px. " +
      "ACHTUNG: Sehr strenge Content-Filter.",
    style: "photorealistic, high-res",
    speed: "slow",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "bytedance/seedream-5.0-pro",
    description:
      "Seedream 5.0 Pro — ByteDance, höchste Qualität, min 1920x1920.",
    style: "photorealistic, high-res",
    speed: "slow",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "google/gemini-3-pro-image",
    description:
      "Gemini 3 Pro Image — Bis 4K Auflösung, höchste Qualität. " +
      "Langsam, aber exzellent für feine Details.",
    style: "photorealistic, cinematic",
    speed: "slow",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "google/gemini-3.1-flash-image",
    description:
      "Gemini 3.1 Flash Image — Schnell, gute Qualität. " +
      "Ideal für schnelle Iterationen. Kosten: ~0.07 pollen.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "x-ai/grok-imagine-image-2.0",
    description:
      "Grok Imagine 2.0 — xAI, sehr hohe Qualität. " +
      "Unterstützt quality-Parameter. Kosten: ~0.07 pollen.",
    style: "photorealistic, cinematic",
    speed: "medium",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "x-ai/grok-imagine-image",
    description:
      "Grok Imagine — xAI, erste Generation. " +
      "Solide Qualität, schnellere Inferenz. Kosten: ~0.02 pollen.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "ideogram-ai/ideogram-v4-turbo",
    description:
      "Ideogram V4 Turbo — Exzellent für Text-in-Bild. " +
      "Schnell, gute Qualität für Grafiken und Logos. Kosten: ~0.03 pollen.",
    style: "illustration, graphic, text-in-image",
    speed: "fast",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "alibaba/wan-2.7-image",
    description:
      "Wan 2.7 Image — Alibaba, multimodal. " +
      "Gute Qualität für detailreiche Szenen. Kosten: ~0.03 pollen.",
    style: "photorealistic, artistic",
    speed: "medium",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "qwen/qwen-image-3",
    description:
      "Qwen Image 3 — Alibaba/Qwen, stark für detailreiche Szenen. " +
      "Gute Prompt-Treue. Kosten: ~0.04 pollen.",
    style: "photorealistic, detailed",
    speed: "medium",
    access: "pro",
    source: "pollinations",
  },
  {
    id: "tongyi-mai/z-image-turbo",
    description:
      "Z-Image Turbo — Default-Modell der neuen API, schnell und zuverlässig.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
  },
];

export function getPollinationsModels(): ModelInfo[] {
  return POLLINATIONS_KNOWN_MODELS;
}

export interface PollinationsGenerateOptions {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  quality?: "low" | "medium" | "high" | "hd";
  seed?: number;
  /** Optional API key (enter.pollinations.ai). Leer = anonym. */
  apiKey?: string;
}

/**
 * Modelle mit dokumentiertem quality-Support (APIDOCS).
 * quality wird nur für diese Modelle im POST-Body gesendet, sonst still ignoriert.
 * Unterstützt: gptimage, gptimage-large, gpt-image-2*, grok-imagine-image-2.0
 */
const QUALITY_SUPPORTED_HINTS = [
  "gpt-image",
  "gptimage",
  "grok-imagine-image-2.0",
];

export function isQualitySupportedModel(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return QUALITY_SUPPORTED_HINTS.some((h) => m.includes(h));
}

/**
 * Modelle mit dokumentiertem seed-Support (APIDOCS).
 * flux.1-schnell, z-image-turbo, seedream-4.0, flux.2-klein-4b.
 * Andere Modelle ignorieren seed auch auf GET.
 */
const SEED_SUPPORTED_HINTS = [
  "flux.1-schnell",
  "z-image-turbo",
  "seedream-4.0",
  "flux.2-klein-4b",
];

export function isSeedSupportedModel(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return SEED_SUPPORTED_HINTS.some((h) => m.includes(h));
}

/**
 * Baut den Request-Body für die neue gen.pollinations.ai API.
 * POST /v1/images/generations mit Bearer-Auth.
 *
 * Volle IDs UND Kurz-Aliase funktionieren (z.B. flux === black-forest-labs/flux.1-schnell).
 * seed ist im POST-Schema nicht dokumentiert und wird daher NICHT gesendet
 * (Reproduzierbarkeit via seed nur über GET /image/{prompt}).
 * quality wird nur für Modelle mit dokumentiertem Support gesendet.
 * safe: Skill-Set (comma-separated: privacy,secrets,sexual,violence,shield,nsfw,true,false).
 *       "false" = alle Filter aus (Default). "true" = privacy+secrets an.
 * private → nofeed (versteckt aus öffentlichem Feed). nologo → kein Wasserzeichen (nur mit Key).
 */
export function buildPollinationsPostBody(opts: PollinationsGenerateOptions): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  qualityDropped: boolean;
} {
  const url = "https://gen.pollinations.ai/v1/images/generations";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    model: opts.model || POLLINATIONS_DEFAULT_MODEL,
    n: 1,
    response_format: "b64_json",
    safe: false,
    // Passthrough-Params der POST-Route (enter.pollinations.ai): private → nofeed,
    // nologo entfernt das Wasserzeichen (nur mit Key).
    private: true,
    nologo: true,
  };

  if (opts.width && opts.height) {
    body.size = `${opts.width}x${opts.height}`;
  }
  let qualityDropped = false;
  if (opts.quality && isQualitySupportedModel(opts.model || POLLINATIONS_DEFAULT_MODEL)) {
    body.quality = opts.quality;
  } else if (opts.quality) {
    qualityDropped = true;
  }

  return { url, headers, body, qualityDropped };
}

/**
 * Baut die GET-URL auf dem aktuellen Host gen.pollinations.ai (auch anonym nutzbar).
 * Unterstützt einzelne width/height UND seed (im Gegensatz zum POST-Body).
 */
export function buildPollinationsGenGetUrl(opts: PollinationsGenerateOptions): string {
  const base = `https://gen.pollinations.ai/image/${encodeURIComponent(opts.prompt)}`;
  const params = new URLSearchParams();
  params.set("model", opts.model || POLLINATIONS_DEFAULT_MODEL);
  if (opts.width) params.set("width", String(opts.width));
  if (opts.seed !== undefined) params.set("seed", String(opts.seed));
  if (opts.height) params.set("height", String(opts.height));
  if (opts.quality && isQualitySupportedModel(opts.model || POLLINATIONS_DEFAULT_MODEL)) {
    params.set("quality", opts.quality);
  }
  params.set("safe", "false");
  params.set("private", "true");
  if (opts.apiKey) {
    params.set("key", opts.apiKey);
    params.set("nologo", "true");
  }
  return `${base}?${params.toString()}`;
}

/**
 * Erkennt JPEG/PNG anhand Magic Bytes (POST liefert b64 ohne Content-Type).
 */
export function detectImageMime(buffer: Buffer): string {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/**
 * @deprecated Host image.pollinations.ai ist deprecated (502-anfällig).
 * Nutze buildPollinationsGenGetUrl für GET bzw. buildPollinationsPostBody für POST.
 */
export function buildPollinationsUrl(opts: PollinationsGenerateOptions): string {
  return buildPollinationsGenGetUrl(opts);
}
