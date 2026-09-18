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
    id: "black-forest-labs/flux.2-klein-4b",
    description:
      "FLUX.2 Klein 4B — Neueste FLUX-Generation, sub-second, Editing bis 2.4MP. " +
      "Erste Wahl für schnelle dark-fashion/power-spice Takes.",
    style: "photorealistic, artistic, fashion-editorial",
    speed: "fast",
    access: "free",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.1-kontext-pro",
    description:
      "FLUX.1 Kontext Pro — Instruction-Editing: Pose behalten, Outfit/Licht tauschen. " +
      "Bildet den KEEP/CHANGE-Workflow direkt ab.",
    style: "editing, photorealistic",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "black-forest-labs/flux.1-schnell",
    description:
      "FLUX.1 Schnell — Schnelle Baseline, winzige Kosten. Zum Durchprobieren von Posen und Stylings.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
  },
  {
    id: "community/vendouple/uncensored-image-v2",
    description:
      "Uncensored v2 — Explizit uncensored, kein Safety-Requirement, keine Datenspeicherung. " +
      "Für power-spice jenseits Intensität 7. Community-Alpha.",
    style: "photorealistic, adult",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "community/vendouple/anima",
    description:
      "Anima — Uncensored Kreativ-Modell (READ DOCS beim Anbieter). Community-Alpha.",
    style: "artistic, stylized",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "community/vendouple/animagine",
    description:
      "Animagine — Anime-nativ, nächste Pony-Ästhetik per API. " +
      "Für Idol-Crossover/Cosplay-Register. Community-Alpha.",
    style: "anime, illustration",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "community/MarcosFRG/phoenix-1.0",
    description:
      "Leonardo Phoenix 1.0 — 5MP-Fotorealismus, starke Prompt-Treue. Für Glamour/Pin-up. Community-Alpha.",
    style: "photorealistic, glamour",
    speed: "medium",
    access: "free",
    source: "pollinations",
  },
  {
    id: "community/CloudCompile/flux-2-klein-9b",
    description:
      "FLUX.2 Klein 9B via Community — Größerer Klein, kein Safety-Requirement. Community-Alpha.",
    style: "photorealistic, artistic",
    speed: "medium",
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
 * Modelle mit dokumentiertem quality-Support (APIDOCS: gptimage-Familie + grok-imagine-image-2.0).
 * quality wird nur für diese Modelle im POST-Body gesendet, sonst still ignoriert.
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
 * Baut den Request-Body für die neue gen.pollinations.ai API.
 * POST /v1/images/generations mit Bearer-Auth.
 *
 * Volle IDs UND Kurz-Aliase funktionieren (z.B. flux === black-forest-labs/flux.1-schnell).
 * seed ist im POST-Schema nicht dokumentiert und wird daher NICHT gesendet
 * (Reproduzierbarkeit via seed nur über GET /image/{prompt}).
 * quality wird nur für Modelle mit dokumentiertem Support gesendet.
 * safe=false wird explizit gesetzt (Filter aus, Default wäre ebenfalls off).
 */
export function buildPollinationsPostBody(opts: PollinationsGenerateOptions): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  qualityDropped: boolean;
  seedDropped: boolean;
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
  };

  if (opts.width && opts.height) {
    body.size = `${opts.width}x${opts.height}`;
  }
  const seedDropped = opts.seed !== undefined;
  let qualityDropped = false;
  if (opts.quality && isQualitySupportedModel(opts.model || POLLINATIONS_DEFAULT_MODEL)) {
    body.quality = opts.quality;
  } else if (opts.quality) {
    qualityDropped = true;
  }

  return { url, headers, body, qualityDropped, seedDropped };
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
  return "image/jpeg";
}

/**
 * @deprecated Host image.pollinations.ai ist deprecated (502-anfällig).
 * Nutze buildPollinationsGenGetUrl für GET bzw. buildPollinationsPostBody für POST.
 */
export function buildPollinationsUrl(opts: PollinationsGenerateOptions): string {
  return buildPollinationsGenGetUrl(opts);
}
