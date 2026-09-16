import type { ModelInfo } from "./types";

/**
 * Pollinations.ai backend — zweites Backend neben HuggingFace.
 *
 * - Kein Token nötig, Filter default aus (safe-Parameter bleibt unbelegt).
 * - Kanonische Modell-IDs (Publisher/Modellname) seit Pollinations-Umstellung Sep 2025,
 *   Aliase (flux, klein, kontext …) funktionieren weiter.
 * - Stand der Liste: Sep 2026 (Registry + models.ts auf GitHub verifiziert).
 *   Community-Modelle sind Alpha über Dritt-Proxies — als Fallback-Kette nutzen,
 *   nicht als Single Point.
 */
export const POLLINATIONS_DEFAULT_MODEL = "klein";

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
  seed?: number;
  /** Optional API key (enter.pollinations.ai). Leer = anonym. */
  apiKey?: string;
}

/**
 * Baut die Legacy-GET-URL (image.pollinations.ai). private=true hält Bilder aus dem
 * öffentlichen Feed — sinnvoller Default für unseren Einsatzzweck. Mit apiKey zusätzlich
 * nologo=true (kein Wasserzeichen) — geht nur mit Account.
 */
export function buildPollinationsUrl(opts: PollinationsGenerateOptions): string {
  const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(opts.prompt)}`;
  const params = new URLSearchParams();
  params.set("model", opts.model);
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  if (opts.seed !== undefined) params.set("seed", String(opts.seed));
  params.set("private", "true");
  params.set("enhance", "false");
  if (opts.apiKey) {
    params.set("key", opts.apiKey);
    params.set("nologo", "true");
  }
  return `${base}?${params.toString()}`;
}
