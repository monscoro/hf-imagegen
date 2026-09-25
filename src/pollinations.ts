import type { ModelInfo } from "./types";
import {
  getCachedPollinationsModels,
  setCachedPollinationsModels,
} from "./modelCache";

/**
 * Pollinations.ai backend — zweites Backend neben HuggingFace.
 *
 * - Neue API: https://gen.pollinations.ai (GET /image/{prompt}, POST /v1/images/generations)
 * - Auth: Bearer Token via Authorization-Header (POST) bzw. ?key= (GET)
 * - Modell-IDs: volle IDs UND Kurz-Aliase funktionieren auf gen.pollinations.ai
 *   (z.B. black-forest-labs/flux.1-schnell === flux). Volle IDs bevorzugt.
 * - Quality-Parameter: nur für gptimage-Modelle und grok-imagine-image-2.0 dokumentiert, sonst ignoriert.
 * - seed: nur als Query-Param von GET /image/{prompt} dokumentiert, NICHT im POST-Body.
 * - Der alte Host image.pollinations.ai ist deprecated und wird nicht mehr genutzt.
 *
 * Die kuratierte Liste unten ist bewusst kurz (7 Modelle). Jeder Eintrag hat eine
 * EIGENE Rolle — T2I-Standard, präzises 1-Bild-Edit, ungefiltertes Edit, günstiges
 * Multi-Referenz, maximale Multi-Image-Fähigkeit, Hochauflösend, 4K-Detail. Alles
 * Weitere im Live-Katalog: list_models source='pollinations' liefert die restlichen
 * Bildmodelle unter catalog_extras (inkl. max_reference_images), also ohne Pflege-
 * aufwand durch uns und ohne die Liste hier aufzublähen.
 *
 * Rollen der kuratierten Auswahl (Preise = pollen pro Bild, live geprüft):
 * - `black-forest-labs/flux.1-schnell`: T2I-Standard, ~0.002, gratis, Default
 * - `black-forest-labs/flux.1-kontext-pro`: präziseste Edits, 1 Referenz, gratis, STRENGE Filter
 * - `x-ai/grok-imagine-image-quality`: Default-Edit, wenige Filter, quality-Parameter
 * - `black-forest-labs/flux.2-klein-4b`: günstigstes Multi-Referenz, ~0.005, 10 Refs, gratis
 * - `openai/gpt-image-2`: 16 Referenzen, beste Prompt-Treue, token-basiert
 * - `bytedance/seedream-5.0-lite`: ab 1920x1920, 14 Refs, paid_only, STRENGE Filter
 * - `google/gemini-3-pro-image`: bis 4K, 14 Refs, token-basiert
 */
export const POLLINATIONS_DEFAULT_MODEL = "black-forest-labs/flux.1-schnell";

/**
 * Default-Edit-Modell für backend='pollinations' (POST /v1/images/edits).
 * bewusst NICHT restriktiv: kontext/seedream haben strenge Filter, die
 * Fashion-Editorial flaggen und Credits verbrennen (fehlgeschlagene Edits kosten).
 * grok-imagine-image-quality: healthy, edit-fähig, wenige Filter, quality-Parameter.
 * Günstige Alternative für viele Referenzen: flux.2-klein-4b (~0.005, 10 Refs, gratis).
 * Präzise Alternative für komplexe Edit-Anweisungen: flux.1-kontext-pro.
 */
export const POLLINATIONS_DEFAULT_EDIT_MODEL = "x-ai/grok-imagine-image-quality";

export const POLLINATIONS_ANON_COOLDOWN_MS = 15_000;

export const POLLINATIONS_KNOWN_MODELS: ModelInfo[] = [
  {
    id: "black-forest-labs/flux.1-schnell",
    description:
      "FLUX.1 Schnell — T2I-Standard, ~0.002 pollen/Bild, gratis, mit Abstand am " +
      "häufigsten genutzten Modell. Kein Bild-Input (kein image_edit). Alias: flux.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
    cost: "~0.002 pollen",
  },
  {
    id: "black-forest-labs/flux.1-kontext-pro",
    description:
      "FLUX.1 Kontext Pro — präzises image_edit mit EINER Referenz, gratis: hält " +
      "Pose, Komposition und Identität zuverlässig und folgt komplexen Edit-" +
      "Anweisungen am genauesten. ACHTUNG: strenge Content-Filter, Fashion-Editorial " +
      "mit intakten Details wird als Sexual_Prompt geflaggt — gefilterte Edits kosten " +
      "trotdem. Verwirft weitere Referenzen still. Alias: kontext.",
    style: "photorealistic, artistic, editing",
    speed: "medium",
    access: "free",
    source: "pollinations",
    cost: "~0.03 pollen",
  },
  {
    id: "x-ai/grok-imagine-image-quality",
    description:
      "Grok Imagine (quality) — Default für image_edit: wenige Content-Filter " +
      "(kein Flagging bei Fashion-Editorial), quality-Parameter wird unterstützt. " +
      "Katalog sagt 1 Referenz, verarbeitet aber 2. Alias: aurora.",
    style: "photorealistic, cinematic, image-editing",
    speed: "medium",
    access: "pro",
    source: "pollinations",
    cost: "~0.053 pollen",
  },
  {
    id: "black-forest-labs/flux.2-klein-4b",
    description:
      "FLUX.2 Klein 4B — mit Abstand günstigstes MULTI-Referenz-Modell: ~0.005 " +
      "pollen/Bild, gratis, bis 10 Referenzen. Teil der FLUX.2-Familie, in der ALLE " +
      "Varianten Multi-Image können: pro (Qualität, 8), flex (Typografie, 10), " +
      "max (Konsistenz, 8) — die Geschwister stehen in catalog_extras. " +
      "Die Wahl für viele Bildvarianten.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "pollinations",
    cost: "~0.005 pollen",
  },
  {
    id: "openai/gpt-image-2",
    description:
      "GPT Image 2 — höchste Multi-Image-Fähigkeit (bis 16 Referenzen) und beste " +
      "Prompt-Treue, token-basiert abgerechnet. Auch ohne Pro-Account nutzbar. " +
      "Für Edits mit vielen Referenzen oder kniffligen Anweisungen.",
    style: "photorealistic, detailed",
    speed: "medium",
    access: "free",
    source: "pollinations",
    cost: "token-basiert",
  },
  {
    id: "bytedance/seedream-5.0-lite",
    description:
      "Seedream 5.0 Lite — Hochauflösend ab 1920x1920, bis 14 Referenzen. " +
      "ACHTUNG: sehr strenge Content-Filters, für ungefilterte Fashion-Edits " +
      "grok-imagine-image-quality nehmen. Alias: seedream5.",
    style: "photorealistic, high-res",
    speed: "slow",
    access: "pro",
    source: "pollinations",
    cost: "~0.035 pollen",
  },
  {
    id: "google/gemini-3-pro-image",
    description:
      "Nano Banana Pro (Gemini 3 Pro Image) — Studioqualität bis 4K, bis 14 " +
      "Referenzen, token-basiert. Stark bei feinen Details und kniffligen prompts. " +
      "Alias: nanobanana-pro.",
    style: "photorealistic, cinematic",
    speed: "slow",
    access: "pro",
    source: "pollinations",
    cost: "token-basiert",
  },
];

export function getPollinationsModels(): ModelInfo[] {
  const cached = getCachedPollinationsModels();
  if (cached) return cached;

  setCachedPollinationsModels(POLLINATIONS_KNOWN_MODELS);
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
 * Hinweis: quality: medium lohnt sich bei grok-imagine-image-quality (Default-Edit)
 * und gpt-image-2 — beides kuratiert und beide ohne strenge Content-Filter.
 */
const QUALITY_SUPPORTED_HINTS = [
  "gpt-image",
  "gptimage",
  "grok-imagine-image-2.0",
  "grok-imagine-image-quality",
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

export interface PollinationsEditImage {
  buffer: Buffer;
  mimeType: string;
}

export interface PollinationsEditOptions {
  prompt: string;
  model: string;
  images: PollinationsEditImage[];
  /** API key (enter.pollinations.ai). Pflicht seit Sep 2026. */
  apiKey: string;
  quality?: "low" | "medium" | "high" | "hd";
}

/**
 * Fähigkeiten aus GET /image/models. Der Endpoint hat laut APIDOCS (v0.3.0) KEINE
 * Feld-Tabelle; `name` + `aliases` + `input_modalities` + `supported_endpoints` +
 * `max_reference_images` sind nur empirisch belegt. `max_reference_images` ist in den
 * Docs ausschließlich als Prosa-Verweis für den GET-`image`-Parameter genannt, und
 * `/v1/models` dokumentiert `id` statt `name` — daher `id` als Fallback akzeptieren,
 * damit ein Umbenennen des Feldes nicht jeden Multi-Image-Call mit "model not found"
 * abbrechen lässt.
 */
export interface PollinationsEditModelCapabilities {
  name: string;
  aliases?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  supported_endpoints?: string[];
  max_reference_images?: number;
  /** "image" | "video" | … — /image/models liefert auch Video-Modelle. */
  category?: string;
  /** true = community-/Drittanbieter-Spiegel, nicht offiziell von Pollinations. */
  community?: boolean;
  title?: string;
  publisher?: string;
  paid_only?: boolean;
  health?: { status?: string; success_rate?: number };
}

const EDIT_CAPABILITIES_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, same TTL as costCache

interface EditCapabilitiesCache {
  fetchedAt: number;
  capabilities: Map<string, PollinationsEditModelCapabilities>;
}

let editCapabilitiesCache: EditCapabilitiesCache | null = null;
let editModelCapabilitiesPromise: Promise<Map<string, PollinationsEditModelCapabilities>> | null = null;

export async function getPollinationsModelCapabilities(): Promise<
  Map<string, PollinationsEditModelCapabilities>
> {
  if (editCapabilitiesCache && Date.now() - editCapabilitiesCache.fetchedAt < EDIT_CAPABILITIES_CACHE_TTL_MS) {
    return editCapabilitiesCache.capabilities;
  }
  if (!editModelCapabilitiesPromise) {
    editModelCapabilitiesPromise = (async () => {
      const response = await fetch("https://gen.pollinations.ai/image/models", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(
          `Could not load Pollinations model capabilities: ${response.status} ${response.statusText}`
        );
      }
      const raw = await response.json() as Array<PollinationsEditModelCapabilities & { id?: string }>;
      if (!Array.isArray(raw)) {
        throw new Error("Pollinations model capability response was not an array.");
      }
      const capabilities = new Map<string, PollinationsEditModelCapabilities>();
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const name = typeof entry.name === "string" ? entry.name : entry.id;
        if (typeof name !== "string" || !name) continue;
        const model: PollinationsEditModelCapabilities = { ...entry, name };
        capabilities.set(name.toLowerCase(), model);
        for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) {
          if (typeof alias === "string" && alias) {
            capabilities.set(alias.toLowerCase(), model);
          }
        }
      }
      if (capabilities.size === 0) {
        throw new Error("Pollinations model catalog contained no usable model entries.");
      }
      editCapabilitiesCache = { fetchedAt: Date.now(), capabilities };
      return capabilities;
    })().catch((error: unknown) => {
      editModelCapabilitiesPromise = null;
      throw error;
    });
  }
  return editModelCapabilitiesPromise;
}

export interface PollinationsEditReferenceCheck {
  model: string;
  maxReferenceImages: number;
  /** true wenn mehr Referenzen geschickt werden als der Katalog für das Modell ausweist. */
  exceedsDeclaredLimit: boolean;
  /** Warntext für exceedsDeclaredLimit, sonst null. */
  warning: string | null;
}

/**
 * Empirisch geprüfte Abweichungen vom Katalog — der Katalog ist nur ein Hinweis.
 * Hier steht, was tatsächlich passiert, damit list_models die Falle vorab benennt
 * statt sie erst nach einem bezahlten Call zu zeigen.
 */
const REFERENCE_EXPERIENCE: Record<string, string> = {
  "black-forest-labs/flux.1-kontext-pro": "single (1) — verwirft weitere Referenzen still",
  "x-ai/grok-imagine-image-quality": "2 (Katalog sagt 1, verarbeitet aber 2)",
};

/**
 * Family-/Budget-Hinweise fuer Live-Modelle, die NICHT in der kuratierten Liste
 * stehen. Der Katalog nennt nur eine Zahl (max_reference_images), aber nicht die
 * Rolle in der Modellfamilie und nicht die upstream Budgetregel — beides ist genau
 * das, was ein LLM bei der Modellauswahl braucht.
 *
 * FLUX.2: alle vier Varianten (klein/pro/flex/max) sind multi-image-faehig.
 * BFL limitet die API aber auf 8 Slots (input_image .. input_image_8); "bis 10"
 * gilt nur in der Playground-UI. Bei pro/max kommt ein 9MP-Budget fuer Input+Output
 * dazu: 8 Referenzen nur bei 1MP-Output, bei 2MP nur 7.
 * Quelle: docs.bfl.ai/flux_2/flux2_image_editing + Prompting Guide.
 */
const CATALOG_NOTES: Record<string, string> = {
  "black-forest-labs/flux.2-pro":
    "FLUX.2-Familie (klein/pro/flex/max sind alle multi-image) — BFL-Empfehlung fuer " +
    "Qualitaet, 4MP. Achtung: 9MP-Budget Input+Output, 8 Refs nur bei 1MP-Output (bei 2MP nur 7).",
  "black-forest-labs/flux.2-flex":
    "FLUX.2-Familie — Spezialist fuer Typografie und kleine Details (ersetzt die " +
    "Text-im-Bild-Rolle von ideogram). 10 Refs laut Katalog, ueber BFL-API sind es 8.",
  "black-forest-labs/flux.2-max":
    "FLUX.2-Familie — staerkste Edit-Konsistenz und Prompt-Treue der Linie. " +
    "9MP-Budget wie pro. Auf Pollinations bisher 0 Requests, ungetestet.",
};

export interface PollinationsReferenceSupport {
  imageEdit: boolean;
  maxReferenceImages: number;
  multiImage: string;
}

export interface PollinationsCatalogEntry {
  id: string;
  aliases: string[];
  image_edit: boolean;
  max_reference_images: number;
  /** Nur gesetzt, wenn das Label etwas erklaert (image_edit nein oder empirischer Sonderfall). */
  multi_image?: string;
  /** Nur gesetzt, wenn es etwas gibt, was max_reference_images nicht sagt. */
  note?: string;
  health: string;
  paid_only: boolean;
}
/**
 * Referenz-Faehigkeit eines Pollinations-Modells fuer Listen-Ausgaben.
 * Folgt derselben Prueflogik wie inspectPollinationsEditReferences
 * (input_modalities + supported_endpoints + max_reference_images), ergaenzt um die
 * empirischen Sonderfaelle aus REFERENCE_EXPERIENCE.
 */
export function describePollinationsReferenceSupport(
  modelId: string,
  capabilities: Map<string, PollinationsEditModelCapabilities>
): PollinationsReferenceSupport {
  const caps = capabilities.get(modelId.trim().toLowerCase());
  if (!caps) {
    return { imageEdit: false, maxReferenceImages: 0, multiImage: "nicht im Katalog" };
  }
  const imageEdit =
    !!caps.input_modalities?.includes("image") &&
    !!caps.supported_endpoints?.includes("/v1/images/edits");
  const maxReferenceImages = caps.max_reference_images ?? 1;
  if (!imageEdit) {
    return { imageEdit: false, maxReferenceImages, multiImage: "kein image_edit" };
  }
  const empirical = REFERENCE_EXPERIENCE[modelId.trim().toLowerCase()];
  const multiImage =
    empirical ??
    (maxReferenceImages >= 2
      ? `multi — bis ${maxReferenceImages} Referenzen`
      : "single (1) — nur eine Referenz");
  return { imageEdit, maxReferenceImages, multiImage };
}

/**
 * Live-Modelle aus /image/models, die NICHT in der kuratierten Liste stehen.
 *
 * /image/models liefert ~77 Eintraege, davon Bild- UND Video-Modelle sowie
 * community-Spiegel Dritter. Ohne Filter wuerde die Ausgabe dominated von
 * Video-Modellen und Mirrors — beides fuer generate_image/image_edit irrelevant.
 * Sortiert nach max_reference_images absteigend, damit Multi-Image-Kandidaten oben
 * stehen; das ist der Grund, warum dieser Block ueberhaupt existiert. Die Zeilen
 * bleiben absichtlich kurz (kein title/publisher, multi_image nur als Erlaeuterung),
 * sonst frisst der Block mehr Tokens als die kuratierte Liste.
 */
export function listPollinationsCatalogExtras(
  capabilities: Map<string, PollinationsEditModelCapabilities>,
  curatedIds: readonly string[],
  filter = ""
): PollinationsCatalogEntry[] {
  const curated = new Set(curatedIds.map((id) => id.trim().toLowerCase()));
  const f = filter.trim().toLowerCase();
  const seen = new Set<string>();
  const rows: PollinationsCatalogEntry[] = [];

  for (const caps of capabilities.values()) {
    if (curated.has(caps.name.toLowerCase())) continue;
    if ((caps.category ?? "image") !== "image") continue;
    if (caps.community === true) continue;
    if (!caps.output_modalities?.includes("image")) continue;
    if (seen.has(caps.name.toLowerCase())) continue;
    const aliases = (caps.aliases ?? []).filter((a) => a !== caps.name);
    const note = CATALOG_NOTES[caps.name.toLowerCase()];
    if (
      f &&
      !caps.name.toLowerCase().includes(f) &&
      !aliases.some((a) => a.toLowerCase().includes(f)) &&
      !(caps.title ?? "").toLowerCase().includes(f) &&
      !(caps.publisher ?? "").toLowerCase().includes(f)
    ) {
      continue;
    }
    seen.add(caps.name.toLowerCase());
    const support = describePollinationsReferenceSupport(caps.name, capabilities);
    // multi_image nur, wenn es etwas Erklaerendes sagt: max_reference_images >= 2 ist
    // fuer sich genommen klar, ein Sonderfall oder fehlendes image_edit nicht.
    const needsLabel = !support.imageEdit || caps.name.toLowerCase() in REFERENCE_EXPERIENCE;
    rows.push({
      id: caps.name,
      aliases,
      image_edit: support.imageEdit,
      max_reference_images: support.maxReferenceImages,
      ...(needsLabel ? { multi_image: support.multiImage } : {}),
      ...(note ? { note } : {}),
      health: caps.health?.status ?? "unknown",
      paid_only: caps.paid_only === true,
    });
  }

  return rows.sort(
    (a, b) =>
      b.max_reference_images - a.max_reference_images ||
      Number(b.image_edit) - Number(a.image_edit) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Prüft Modell + Referenzanzahl gegen den Live-Katalog (/image/models).
 *
 * Bewusst NICHT blockierend, wenn imageCount > max_reference_images: der Katalog
 * ist nur ein Hinweis. Empirisch verarbeitet x-ai/grok-imagine-image-quality
 * 2 Referenzen, obwohl der Katalog max_reference_images: 1 meldet, während
 * flux.1-kontext-pro Bild 2 tatsächlich still verwirft. Harte Grenzen würden also
 * funktionierende Modelle blockieren und Modelle mit stillem Verwerfen zulassen —
 * beides vermeiden wir zugunsten einer sichtbaren Note im Ergebnis.
 */
export async function inspectPollinationsEditReferences(
  model: string,
  imageCount: number
): Promise<PollinationsEditReferenceCheck> {
  const capabilities = await getPollinationsModelCapabilities();
  const modelCapabilities = capabilities.get(model.trim().toLowerCase());
  if (!modelCapabilities) {
    throw new Error(
      `Pollinations model '${model}' was not found in /image/models. ` +
      "Use list_models source='pollinations' and choose a listed model/alias."
    );
  }
  if (
    !modelCapabilities.input_modalities?.includes("image") ||
    !modelCapabilities.supported_endpoints?.includes("/v1/images/edits")
  ) {
    throw new Error(
      `Pollinations model '${modelCapabilities.name}' does not support image editing at /v1/images/edits.`
    );
  }
  const maxReferenceImages = modelCapabilities.max_reference_images ?? 1;
  const exceedsDeclaredLimit = imageCount > maxReferenceImages;
  const suggestion = imageCount <= 3
    ? "openai/gpt-image-2 (up to 16)"
    : imageCount <= 10
      ? "black-forest-labs/flux.2-klein-4b (up to 10, ~0.005 pollen)"
      : "openai/gpt-image-2 (up to 16)";
  return {
    model: modelCapabilities.name,
    maxReferenceImages,
    exceedsDeclaredLimit,
    warning: exceedsDeclaredLimit
      ? `Model '${modelCapabilities.name}' declares max_reference_images: ${maxReferenceImages}, but ` +
        `${imageCount} were sent. Extra references may be ignored by the model (e.g. ` +
        `flux.1-kontext-pro drops the second image); the catalog value is only advisory. ` +
        `A model verified to accept ${imageCount} references is '${suggestion}'. ` +
        `If the API rejects the request instead, the documented error code is ` +
        `'image_too_large' (HTTP 400), which also covers the per-request image count cap.`
      : null,
  };
}

/**
 * Baut den multipart/form-data Request für POST /v1/images/edits
 * (Image-Editing-Endpoint, akzeptiert JSON ODER multipart).
 *
 * multipart mit Datei-Upload, weil der 'image'-Parameter lokal als Buffer vorliegt
 * (JSON-Schema erwartet eine URL). safe=false + private + nologo wie bei generations.
 * quality nur bei Modellen mit dokumentiertem Support (gpt-image/grok-imagine-image-2.0).
 */
export function buildPollinationsEditForm(opts: PollinationsEditOptions): {
  url: string;
  headers: Record<string, string>;
  form: FormData;
  qualityDropped: boolean;
} {
  if (opts.images.length === 0) {
    throw new Error("Pollinations image editing requires at least one reference image.");
  }
  const url = "https://gen.pollinations.ai/v1/images/edits";
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  const form = new FormData();
  form.append("prompt", opts.prompt);
  form.append("model", opts.model);
  form.append("response_format", "b64_json");
  form.append("safe", "false");
  form.append("private", "true");
  form.append("nologo", "true");

  let qualityDropped = false;
  if (opts.quality) {
    if (isQualitySupportedModel(opts.model)) {
      form.append("quality", opts.quality);
    } else {
      qualityDropped = true;
    }
  }

  for (const [index, image] of opts.images.entries()) {
    const ext = image.mimeType.includes("png") ? "png"
      : image.mimeType.includes("webp") ? "webp"
      : image.mimeType.includes("gif") ? "gif"
      : image.mimeType.includes("bmp") ? "bmp"
      : "jpg";
    const blob = new Blob([new Uint8Array(image.buffer)], { type: image.mimeType });
    form.append("image", blob, `reference-${index + 1}.${ext}`);
  }

  return { url, headers, form, qualityDropped };
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
