import { type ModelInfo, type LoRAInfo, type ModelSource } from "./types";
import { CURATED_MODELS, getCuratedEditModels } from "./curatedModels";
import {
  getCachedProviderModels,
  setCachedProviderModels,
  getCachedTrendingModels,
  setCachedTrendingModels,
  getCachedDownloadedModels,
  setCachedDownloadedModels,
  getCachedVideoModels,
  setCachedVideoModels,
  getCachedLoRAs,
  setCachedLoRAs,
} from "./modelCache";
import {
  readHfCatalogCache,
  writeHfCatalogCache,
  fetchHfCatalog,
  getHfCatalogCacheFile,
  type HFCatalogEntry,
} from "./hfCatalogCache";

const HF_API_BASE = "https://huggingface.co/api";

/**
 * Timeout fuer die drei Ranking-Listen (provider/trending/downloads). Die
 * holen bis zu 500 Zeilen (fetchLimit), weil die Filterkette Quantisierungen,
 * LoRAs, Altlasten und providerlose Modelle verwirft — mit den 15 s der
 * kleinen Abfragen wuerden sie auf langsamen Leitungen ins Timeout laufen.
 * Kurze Listen (returned < limit) sind trotzdem normal: verwirft die Kette
 * mehr als 11/12 der Zeilen, kommt einfach weniger zurueck.
 */
const HF_LIST_TIMEOUT_MS = 30_000;

interface HFModel {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  createdAt?: string;
}

export function getCuratedModels(): ModelInfo[] {
  return CURATED_MODELS;
}

const QUANTIZATION_MARKERS = [
  "gguf",
  "gptq",
  "awq",
  "exl2",
  "imatrix",
  "quanto",
  "hqq",
  "mxfp4",
  "w4a16",
  "w8a8",
  "fp8",
  "int8",
  "int4",
  "4bit",
  "8bit",
  "q4",
  "q5",
  "q6",
  "q8",
  "nf4",
  "bnb",
];

/**
 * Repo-Name in Tokens zerlegt (Trenner: alles ausser a-z0-9). "valorant-style"
 * wird zu {valorant, style} statt "lora" als Substring zu enthalten — ein
 * includes()-Check wuerde solche Namen fälschlich als LoRA/Quantisierung
 * verwerfen. Geprueft wird nur der Repo-Name, nicht der Autor.
 */
function repoNameTokens(modelId: string): Set<string> {
  const repo = modelId.slice(modelId.indexOf("/") + 1).toLowerCase();
  return new Set(repo.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

export function isQuantizationArtifact(modelId: string): boolean {
  const tokens = repoNameTokens(modelId);
  return QUANTIZATION_MARKERS.some((marker) => tokens.has(marker));
}

/**
 * LoRAs sind Adapter, keine eigenstaendigen Bildmodelle, und tauchen in
 * `pipeline_tag=image-to-image` genauso auf wie Basis-Modelle. Im Katalog
 * machen sie 53 % der nutzbaren image-to-image-Modelle aus (35 % bei
 * text-to-image) — darunter mit 1549 Likes der meistgelikte Eintrag ueberhaupt
 * (fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA). Als `model_id` sind sie
 * nicht aufrufbar, also fliegen sie aus den Modelllisten raus.
 *
 * Geprueft wird nur der Repo-Name, nicht der Autor: sonst wuerde ein Autor
 * namens "lora-collective" komplett verschwinden. Und nur ganze Tokens, kein
 * Substring: "valorant-style" enthaelt "lora", ist aber kein Adapter.
 *
 * Die eigentliche LoRA-Suche (getLoRAsForModel, list_loras) filtert bewusst
 * NICHT — dort sind genau diese Modelle gesucht.
 */
export function isLoRAArtifact(modelId: string): boolean {
  const tokens = repoNameTokens(modelId);
  return tokens.has("lora") || tokens.has("loras");
}

/**
 * Verwirft, was als `model_id` nicht aufrufbar ist. Vier Gruende, alle
 * gemessen an den echten Katalogdaten:
 *
 * 1. Quantisierungen (GGUF/GPTQ/…) — 26 % der trending-Top-100.
 * 2. LoRAs — 53 % der nutzbaren image-to-image-Modelle.
 * 3. Pre-SDXL-Modelle — Schwelle Juli 2023, siehe isPreSdxlArtifact.
 * 4. Modelle ohne liveen Provider — ohne einen scheitert backend='hf'.
 *
 * Zu Punkt 4 zwei Ausnahmen, beide mit derselben Begruendung — ein Katalog-
 * ausfall darf nicht Models wegfiltern, die nachweislich verfuegbar sind:
 *   - Ist der Katalog nicht geladen, wird gar nicht nach Provider gefiltert.
 *     Sonst wuerde genau dann jede Liste leer, wenn ohnehin etwas kaputt ist.
 *   - source='provider': die Anfrage ist selbst nach Provider gefiltert
 *     (`?inference_provider=fal-ai`), das Ergebnis belegt also ein Mapping.
 *     Kennt der Katalog das Modell, gilt sein Status (live noetig). Kennt er
 *     es nicht (ausserhalb der 1000 meistgelikten je Task), bleibt es drin.
 *
 * In den uebrigen Quellen gilt: was der Katalog nicht kennt, kann nicht
 * belegt werden und fliegt raus — dort gibt es keinen Query-Beweis.
 */
function keepUsableModels<T extends { id: string; createdAt?: string }>(
  models: T[],
  limit: number,
  providerQueried: boolean = false
): T[] {
  const catalogLoaded = hfCatalogIndex !== null;
  const kept = models.filter((m) => {
    if (isQuantizationArtifact(m.id)) return false;
    if (isLoRAArtifact(m.id)) return false;
    if (isPreSdxlArtifact(m.id, m.createdAt)) return false;
    if (catalogLoaded) {
      const known = getHfCatalogEntry(m.id) !== null;
      if (known && getHfLiveProviders(m.id).length === 0) return false;
      if (!known && !providerQueried) return false;
    }
    return true;
  });
  return kept.length > limit ? kept.slice(0, limit) : kept;
}

/** SDXL-Basis ist Juli 2023; davor ist alles Vor-SDXL. */
const SDXL_EPOCH_MS = Date.UTC(2023, 6, 1);

/**
 * Direkte Altlast-Repos. Eine Namens-Deny-Liste der Community-Finetunes
 * (`dreamshaper-7`, `Realistic_Vision_V5.1`, …) waere unbrauchbar: die tragen
 * weder "stable-diffusion" im Namen noch einen `base_model`-Tag — geprueft,
 * beide Signale fehlen. Deshalb entscheidet das Datum, und die Liste hier
 * faengt nur die offiziellen Repos sowie spaeter hochgeladene Altlasten ab.
 *
 * "stable-diffusion-3" und "-xl" matchen bewusst NICHT: SD 3.x und SDXL
 * bleiben drin, sie sind juenger als die Schwelle und technisch relevant.
 */
const PRE_SDXL_NAME =
  /stable-diffusion-(v1|v2|1|2)(\b|[-_.])|runwayml\/|compvis\/|\bsd-?(v1|1\.5|15|2)\b|\bv1-5\b/i;

export function isPreSdxlArtifact(modelId: string, createdAt?: string): boolean {
  const repo = modelId.slice(modelId.indexOf("/") + 1);
  if (PRE_SDXL_NAME.test(repo)) return true;
  if (typeof createdAt === "string") {
    const t = Date.parse(createdAt);
    if (Number.isFinite(t) && t < SDXL_EPOCH_MS) return true;
  }
  return false;
}

const HF_CATALOG_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Nach einem Fehlschlag nicht sofort erneut versuchen, sonst wartet jeder Aufruf ins Timeout. */
const HF_CATALOG_BACKOFF_MS = 10 * 60 * 1000;

let hfCatalogIndex: Map<string, HFCatalogEntry> | null = null;
let hfCatalogFetchedAt = 0;
let hfCatalogPromise: Promise<Map<string, HFCatalogEntry>> | null = null;
let lastHfFetchFailureAt = 0;

/**
 * Baut den Lookup-Index. Ein Modell kann in beiden Task-Seiten stehen
 * (FLUX.2-dev etwa), dann werden die Provider-Meldungen vereinigt statt dass
 * eine Seite die andere ueberschreibt — der Eintrag bleibt der erste gefundene,
 * die Latenz ist der beste verfuegbare Wert.
 */
function indexHfCatalog(entries: HFCatalogEntry[]): Map<string, HFCatalogEntry> {
  const index = new Map<string, HFCatalogEntry>();
  for (const entry of entries) {
    const known = index.get(entry.id);
    if (!known) {
      index.set(entry.id, entry);
      continue;
    }
    const merged = new Map(known.providers.map((p) => [p.provider, p]));
    for (const p of entry.providers) {
      const seen = merged.get(p.provider);
      if (!seen) merged.set(p.provider, p);
      else if (p.latencyMs > 0 && (seen.latencyMs === 0 || p.latencyMs < seen.latencyMs)) {
        merged.set(p.provider, { ...seen, latencyMs: p.latencyMs, status: seen.status === "unknown" ? p.status : seen.status });
      }
    }
    known.providers = [...merged.values()];
    known.likes = Math.max(known.likes, entry.likes);
  }
  return index;
}

function rememberHfCatalog(
  index: Map<string, HFCatalogEntry>,
  fetchedAt: number
): Map<string, HFCatalogEntry> {
  hfCatalogIndex = index;
  hfCatalogFetchedAt = fetchedAt;
  return index;
}

function indexFromDisk(): { index: Map<string, HFCatalogEntry>; fetchedAt: number } | null {
  const disk = readHfCatalogCache();
  if (!disk) return null;
  const index = indexHfCatalog(disk.models);
  return index.size > 0 ? { index, fetchedAt: disk.fetchedAt } : null;
}

async function loadHfCatalog(): Promise<Map<string, HFCatalogEntry>> {
  const now = Date.now();
  const disk = indexFromDisk();

  // 1) Frischer Platten-Cache: gar kein Netzwerkzugriff.
  if (disk && now - disk.fetchedAt < HF_CATALOG_TTL_MS) {
    return rememberHfCatalog(disk.index, disk.fetchedAt);
  }

  // 2) Veraltet, aber vor kurzem erst gescheitert: veraltete Daten bedienen,
  //    statt bei toter Verbindung jeden Aufruf erneut zu versuchen.
  if (disk && now - lastHfFetchFailureAt < HF_CATALOG_BACKOFF_MS) {
    return rememberHfCatalog(disk.index, disk.fetchedAt);
  }

  // 3) Neu holen.
  try {
    const raw = await fetchHfCatalog();
    const index = indexHfCatalog(raw);
    if (index.size === 0) {
      throw new Error("HF model catalog contained no usable model entries.");
    }
    const fetchedAt = Date.now();
    writeHfCatalogCache(raw, fetchedAt);
    lastHfFetchFailureAt = 0;
    return rememberHfCatalog(index, fetchedAt);
  } catch (error) {
    lastHfFetchFailureAt = Date.now();
    // 4) lieber veraltete Katalogdaten liefern als gar keine. Ohne Platten-Cache
    //    bleibt es bei den kuratierten Modellen (Aufrufer-Fallback).
    if (disk) return rememberHfCatalog(disk.index, disk.fetchedAt);
    throw error;
  }
}

/**
 * Katalog mit Provider-Zuordnung, 12h TTL auf Platte, stale-while-error.
 * Der Aufrufer faellt bei einem Wurf auf die kuratierte Liste zurueck.
 */
export async function getHfCatalog(): Promise<Map<string, HFCatalogEntry>> {
  if (hfCatalogIndex && Date.now() - hfCatalogFetchedAt < HF_CATALOG_TTL_MS) {
    return hfCatalogIndex;
  }
  // In-Flight-Dedup: parallele Aufrufe setzen nur einen Doppel-Request ab.
  if (!hfCatalogPromise) {
    hfCatalogPromise = loadHfCatalog().finally(() => {
      hfCatalogPromise = null;
    });
  }
  return hfCatalogPromise;
}

/**
 * Katalog-Zugriff fuer die Listenvarianten. Bewusst synchron: die Aufrufer
 * laufen in einer Mapping-Schleife und sollen nicht auf einen await warten
 * muessen. Liefert null, solange der Katalog noch nicht geladen wurde.
 */
export function getHfCatalogEntry(modelId: string): HFCatalogEntry | null {
  return hfCatalogIndex?.get(modelId) ?? null;
}

/** Provider mit Status live — nur die sind tatsaechlich aufrufbar. */
export function getHfLiveProviders(modelId: string): string[] {
  const entry = getHfCatalogEntry(modelId);
  if (!entry) return [];
  return entry.providers.filter((p) => p.status === "live").map((p) => p.provider);
}

/**
 * Kann das Modell ueberhaupt image_edit? Zwei getrennte Fragen, die oft
 * verwechselt werden: die Task-Seite sagt, ob das Modell Bildeingaben
 * verarbeitet, der Provider-Status, ob es gerade jemand anbietet.
 */
export function isHfImageEditCapable(modelId: string): boolean {
  return getHfCatalogEntry(modelId)?.task === "image-to-image";
}

/** true, wenn ein Provider live ist — also ein Aufruf nicht sofort scheitert. */
export function isHfServable(modelId: string): boolean {
  return getHfLiveProviders(modelId).length > 0;
}

/**
 * Geschwindigkeit aus der gemessenen Anfrage-Latenz. Herkunft: die API meldet
 * `performance.requestLatencyMs` pro Provider, im Katalog Median 14,8 s,
 * Spanne 0,5–30 s. Genutzt wird der schnellste live-Provider, weil ein Modell
 * mit einem schnellen und einem langsamen Provider trotzdem schnell nutzbar ist.
 * Ohne Messwert null, damit der Aufrufer seine eigene Angabe behält.
 */
export function hfSpeedFromLatency(latencyMs: number): "fast" | "medium" | "slow" | null {
  if (!latencyMs || latencyMs <= 0) return null;
  if (latencyMs <= 8000) return "fast";
  if (latencyMs <= 20000) return "medium";
  return "slow";
}

export function getHfBestLiveLatency(modelId: string): number {
  const entry = getHfCatalogEntry(modelId);
  if (!entry) return 0;
  const live = entry.providers.filter((p) => p.status === "live" && p.latencyMs > 0);
  return live.length > 0 ? Math.min(...live.map((p) => p.latencyMs)) : 0;
}

/** Alle Provider, die im Katalog überhaupt auftauchen — statt hartcodierter Liste. */
export function listHfCatalogProviders(): string[] {
  if (!hfCatalogIndex) return [];
  const seen = new Set<string>();
  for (const entry of hfCatalogIndex.values()) {
    for (const p of entry.providers) seen.add(p.provider);
  }
  return [...seen].sort();
}

/** Alter/Status des Katalog-Caches fuer list_models und Diagnose. */
export function getHfCatalogCacheInfo(): {
  fetchedAt: Date | null;
  expiresInMs: number;
  file: string;
  persisted: boolean;
  models: number;
  modelsWithProviders: number;
  lastFetchFailureAt: Date | null;
} {
  const disk = readHfCatalogCache();
  const now = Date.now();
  // Ueber eindeutige IDs zaehlen, nicht ueber die rohen Array-Eintraege: ein
  // Modell steht in beiden Task-Seiten und wuerde sonst doppelt gezaehlt.
  // Bewusst ein Set statt indexHfCatalog(): der Merge der Providerlisten ist
  // fuer zwei Zaehlwerte unnoetig teuer, und diese Funktion laeuft bei jedem
  // list_models-Aufruf.
  const seen = new Set<string>();
  let modelsWithProviders = 0;
  if (disk) {
    const withProviders = new Set<string>();
    for (const entry of disk.models) {
      seen.add(entry.id);
      // Nur live zaehlen: staging/error-only Modelle sind nicht aufrufbar,
      // und die Filterkette (keepUsableModels, image-edit) verlangt live.
      if (entry.providers.some((p) => p.status === "live")) withProviders.add(entry.id);
    }
    modelsWithProviders = withProviders.size;
  }
  return {
    fetchedAt: disk ? new Date(disk.fetchedAt) : null,
    expiresInMs: disk ? Math.max(0, HF_CATALOG_TTL_MS - (now - disk.fetchedAt)) : 0,
    file: getHfCatalogCacheFile(),
    persisted: disk !== null,
    models: seen.size,
    modelsWithProviders,
    lastFetchFailureAt: lastHfFetchFailureAt > 0 ? new Date(lastHfFetchFailureAt) : null,
  };
}

/**
 * Laedt den Katalog fuer die Anreicherung, ohne dass ein Fehlschlag die
 * Modulliste kippt. Der Katalog ist eine Ergaenzung: fehlt er, bleibt die
 * Liste mit ihren bisherigen Platzhaltern bestehen.
 */
export async function ensureCatalogBestEffort(): Promise<void> {
  try {
    await getHfCatalog();
  } catch {
    // Katalog optional — die Liste ist auch ohne ihn korrekt, nur ungenauer.
  }
}

/**
 * Baut den Listen-Eintrag und reichert ihn aus dem Katalog an.
 *
 * Der Katalog beantwortet drei Fragen, die die Listenabfrage nicht kann:
 *   - ist das Modell ueberhaupt image_edit-faehig (`pipeline_tag`)
 *   - bietet gerade jemand das Modell an (`status: live`)
 *   - wie schnell war er dabei (`performance.requestLatencyMs`)
 *
 * Steht ein Modell nicht im Katalog (die API listet je Seite hoechstens 1000
 * nach Likes), bleibt image_edit leer statt auf false gesetzt werden. Das
 * unterscheidet "kann kein Edit" von "weiss es nicht".
 *
 * `parameters` und `license` werden hier bewusst NICHT gesetzt: die
 * Listen-Antwort enthaelt weder `safetensors` noch `cardData`, der alte Code
 * las beide Felder und lieferte dadurch dauerhaft undefined. Nur die kuratierte
 * Liste traegt handgepflegte Werte, dort kommen sie aus curatedModels.ts.
 */
function toModelInfo(
  m: HFModel,
  source: ModelSource,
  description: string,
  assumedProvider?: string
): ModelInfo {
  const entry = getHfCatalogEntry(m.id);
  const live = getHfLiveProviders(m.id);
  const latency = getHfBestLiveLatency(m.id);
  return {
    id: m.id,
    // Video-Rows: Provider in den Text — dort steht sonst nur Boilerplate,
    // und die Zeile ist die einzige Stelle mit Live-Signal.
    description:
      source === "video" && live.length > 0 ? `${description} — live: ${live.join(", ")}` : description,
    style: "varies",
    speed: hfSpeedFromLatency(latency) ?? "medium",
    access: "free",
    source,
    // image_edit gilt nur fuer Bild-Tasks: auf einer Video-Liste waere ein
    // false ("bekannt nicht editierbar") fuer ein Feld, das dort nichts soll.
    image_edit: entry ? (source === "video" ? undefined : entry.task === "image-to-image") : undefined,
    // Bei source='provider' belegt die Query selbst die Verfuegbarkeit. Der
    // Katalog kennt das Modell dann vielleicht nicht (ausserhalb der Top-1000
    // nach Likes) — statt das Feld zu leeren, wird der abgefragte Provider
    // genannt. Ein erfundener Status waere es nicht, der Name ist die Quelle.
    hf_providers: live.length > 0 ? live : assumedProvider ? [assumedProvider] : undefined,
    hf_latency_ms: latency > 0 ? latency : undefined,
  };
}

export async function getProviderModels(
  provider: string,
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedProviderModels(provider, limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 12, 500);
  const url = `${HF_API_BASE}/models?inference_provider=${provider}&pipeline_tag=text-to-image&sort=trendingScore&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(HF_LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  // providerQueried=true: die ?inference_provider=-Query belegt selbst die
  // Verfuegbarkeit, unbekannte Modelle bleiben drin (siehe keepUsableModels).
  const models = keepUsableModels((await res.json()) as HFModel[], limit, true);

  await ensureCatalogBestEffort();
  const result = models.map((m) =>
    toModelInfo(m, "provider", `${m.id} — Text-to-Image model via ${provider}`, provider)
  );

  setCachedProviderModels(provider, limit, result);
  return result;
}

export async function getTrendingModels(
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedTrendingModels(limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 12, 500);
  const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=trendingScore&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(HF_LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = keepUsableModels((await res.json()) as HFModel[], limit);

  await ensureCatalogBestEffort();
  const result = models.map((m) =>
    toModelInfo(m, "trending", `${m.id} — Trending text-to-image model`)
  );

  setCachedTrendingModels(limit, result);
  return result;
}

export async function getDownloadedModels(
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedDownloadedModels(limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 12, 500);
  const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=downloads&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(HF_LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = keepUsableModels((await res.json()) as HFModel[], limit);

  await ensureCatalogBestEffort();
  const result = models.map((m) =>
    toModelInfo(m, "downloads", `${m.id} — Popular text-to-image model`)
  );

  setCachedDownloadedModels(limit, result);
  return result;
}

/**
 * Video-Modelle fuer list_models source='video' (HF-Seite).
 *
 * Beide Video-Tasks live (text-to-video + image-to-video, trendingScore),
 * zusammengeführt und deduped — ein Modell steht oft in beiden. Gleiche
 * Filterkette wie die Ranking-Listen: LoRA-Adapter und Quantisierungen sind
 * auch hier keine aufrufbaren Modelle (die Listen sind voll davon, siehe
 * MiniMax-LoRAs); die Pre-SDXL-Schwelle laeuft ins Leere (alles post-2023).
 * Provider-Nachweis gibt es keinen (kein ?inference_provider=?), also gilt
 * die Standardregel: unbekannt + Katalog geladen = raus, bekannt + kein
 * live-Provider = raus.
 */
const HF_VIDEO_TAGS = ["text-to-video", "image-to-video"] as const;

export async function getHfVideoModels(
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedVideoModels(limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 12, 500);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const seen = new Map<string, HFModel>();
  // Pro Tag best-effort (wie fetchHfCatalog): faellt eine Seite aus, traegt
  // die andere die Liste allein — nur beide tot werfen.
  for (const tag of HF_VIDEO_TAGS) {
    try {
      const url = `${HF_API_BASE}/models?pipeline_tag=${tag}&sort=trendingScore&limit=${fetchLimit}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(HF_LIST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);
      for (const m of (await res.json()) as HFModel[]) {
        if (m?.id && !seen.has(m.id)) seen.set(m.id, m);
      }
    } catch {
      // naechster Tag; erst danach entscheiden
    }
  }
  if (seen.size === 0) {
    throw new Error("HF API error: both video tag pages failed.");
  }

  // Katalog ZUERST (anders als bei den Bild-Listen): Video-Listen sind voll
  // mit nicht aufrufbarem Beiwerk (Workflows, Merges, ControlNets) — ohne
  // Provider-Filter kaeme beim ersten Call nach jedem Reload nur Schrott.
  // Platten-Cache macht das im Normalfall netzfrei.
  await ensureCatalogBestEffort();
  // Tag-Reihenfolge (T2V vor I2V) sagt nichts ueber Qualitaet — likes ueber
  // beide Tags sortiert, damit kein I2V-only-Treffer unter allen T2V landet.
  const byLikes = [...seen.values()].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  const models = keepUsableModels(byLikes, limit);

  const result = models.map((m) =>
    toModelInfo(m, "video", `${m.id} — Video model (HuggingFace pipeline_tag)`)
  );

  setCachedVideoModels(limit, result);
  return result;
}

/**
 * Editing-native Modelle fuer list_models source='image-edit'.
 *
 * Quelle ist der image-to-image-Teil des Katalogs statt einer handgepflegten
 * ID-Liste: die Katalogseite ist mit 494 Modellen nicht abgeschnitten, damit
 * sind alle editing-faehigen Modelle erfasst, die ein Provider anbietet.
 *
 * Anders als bei den Ranking-Listen wird hier auf live-Provider gefiltert.
 * Der Unterschied ist nicht kosmetisch: image_edit mit backend='hf' geht
 * zwingend ueber einen Inference-Provider, ein Modell ohne liveen Provider
 * kann der Aufrufer gar nicht verwenden. In den allgemeinen Listen dagegen
 * bleibt es relevant, weil dort auch lokal geladene Modelle (lmstudio) gemeint
 * sind.
 *
 * Die kuratierten Modelle kommen zuerst und behalten ihre handgeschriebene
 * Beschreibung — die ist besser als "varies" — werden aber um Provider und
 * Latenz ergaenzt. Fehlt der Katalog, bleibt es bei den kuratierten IDs.
 */
export async function getHfImageEditModels(limit: number = 20): Promise<ModelInfo[]> {
  await ensureCatalogBestEffort();
  const curated = getCuratedEditModels();

  if (!hfCatalogIndex) return curated.slice(0, limit);

  const withProvider = [...hfCatalogIndex.values()].filter(
    (e) =>
      e.task === "image-to-image" &&
      e.providers.some((p) => p.status === "live") &&
      // Nur die Namenshaelfte der Altschwelle: HFCatalogEntry hat kein
      // createdAt (die expand=inferenceProviderMapping-Projektion liefert es
      // nicht), deshalb greift hier isPreSdxlArtifact ohne Datum. Offizielle
      // Alt-Repos fliegen trotzdem raus; Finetunes wie dreamshaper-7, die nur
      // ueber das Datum erkennbar waeren, schluepfen auf diesem Pfad durch,
      // waehrend die Ranking-Listen sie per createdAt verwerfen.
      !isPreSdxlArtifact(e.id)
  );
  if (withProvider.length === 0) return curated.slice(0, limit);

  const byLikes = [...withProvider].sort((a, b) => b.likes - a.likes);
  const seen = new Set<string>();
  const result: ModelInfo[] = [];

  // 1) kuratierte Modelle in ihrer Kurationsreihenfolge, mit Katalogdaten angereichert
  for (const model of curated) {
    seen.add(model.id);
    const live = getHfLiveProviders(model.id);
    const latency = getHfBestLiveLatency(model.id);
    result.push({
      ...model,
      image_edit: true,
      hf_providers: live.length > 0 ? live : undefined,
      hf_latency_ms: latency > 0 ? latency : undefined,
    });
  }

  // 2) der Rest aus dem Katalog, nach Likes
  for (const entry of byLikes) {
    if (seen.has(entry.id)) continue;
    if (isQuantizationArtifact(entry.id) || isLoRAArtifact(entry.id)) continue;
    const latency = getHfBestLiveLatency(entry.id);
    result.push({
      id: entry.id,
      description: `${entry.id} — Image-to-image model (HuggingFace pipeline_tag)`,
      style: "varies",
      speed: hfSpeedFromLatency(latency) ?? "medium",
      access: "free",
      source: "image-edit",
      image_edit: true,
      hf_providers: getHfLiveProviders(entry.id),
      hf_latency_ms: latency > 0 ? latency : undefined,
    });
  }

  return result.slice(0, limit);
}

export async function getLoRAsForModel(
  baseModel: string,
  search: string = "",
  limit: number = 15,
  token?: string
): Promise<LoRAInfo[]> {
  // Prozess-Cache (Phase 2.B, 12h wie list_models): LoRA-Suchen sind
  // user-spezifisch und klein — kein Platten-Cache, Key mit allen Parametern.
  const cacheKey = `${baseModel.toLowerCase().trim()}|${search.toLowerCase().trim()}|${limit}`;
  const cached = getCachedLoRAs(cacheKey);
  if (cached) return cached;

  const modelKey = baseModel.toLowerCase();
  let query: string;

  if (modelKey.includes("flux")) {
    query = search ? `${search} flux lora` : "flux lora";
  } else if (modelKey.includes("sdxl") || modelKey.includes("stable-diffusion")) {
    query = search ? `${search} sdxl lora` : "sdxl lora";
  } else if (modelKey.includes("krea")) {
    query = search ? `${search} krea lora` : "krea lora";
  } else if (modelKey.includes("qwen")) {
    query = search ? `${search} qwen lora` : "qwen lora";
  } else if (modelKey.includes("wan")) {
    query = search ? `${search} wan lora` : "wan lora";
  } else if (modelKey.includes("ltx")) {
    query = search ? `${search} ltx lora` : "ltx lora";
  } else if (modelKey.includes("hunyuan")) {
    query = search ? `${search} hunyuan video lora` : "hunyuan video lora";
  } else if (modelKey.includes("cogvideo")) {
    query = search ? `${search} cogvideo lora` : "cogvideo lora";
  } else if (modelKey.includes("minimax")) {
    // "minimax" allein trifft auch Text-Modelle — Video-Disambiguierung noetig.
    query = search ? `${search} minimax video lora` : "minimax video lora";
  } else {
    query = search || `${baseModel.split("/").pop()} lora`;
  }

  const url = `${HF_API_BASE}/models?search=${encodeURIComponent(query)}&filter=lora&sort=downloads&limit=${limit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = (await res.json()) as HFModel[];

  function extractBaseModel(m: HFModel): string {
    // Nur der Tag traegt: die Listen-Antwort enthaelt kein `cardData`, ein
    // `cardData.base_model`-Zweig waere hier dauerhaft undefined gewesen.
    const tag = (m.tags ?? []).find((t) => t.startsWith("base_model:"));
    return tag ? tag.replace("base_model:", "") : "unknown";
  }

  const result = models
    .map((m) => ({
      id: m.id,
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      base_model: extractBaseModel(m),
      tags: (m.tags ?? []).filter((t) => LORA_FAMILY_TAGS.includes(t)),
      description: describeLoRA(m),
    }))
    .filter((m) => {
      if (!baseModel) return true;
      const loraBase = m.base_model.toLowerCase();
      const searchBase = baseModel.toLowerCase();
      const modelShort = searchBase.split("/").pop() || "";
      if (loraBase.includes(searchBase) || loraBase.includes(modelShort)) return true;
      // Video-LoRAs deklarieren die Familie statt der Version
      // ("Comfy-Org/MiniMax-H3" statt "MiniMax-H3-Turbo") — Familien-Match,
      // sonst wuerde der Versionsfilter fast alles verwerfen. Token-Praefix
      // (kein Substring), damit "swan" nicht zu "wan" wird.
      const family = matchesVideoFamily(baseModel);
      return family ? matchesVideoFamily(loraBase) === family : false;
    });

  setCachedLoRAs(cacheKey, result);
  return result;
}

/** Video-Basis-Modell? Entscheidet Query-Formulierung und Usage-Texte. */
const VIDEO_MODEL_FAMILIES = ["wan", "ltx", "hunyuan", "cogvideo", "minimax"];

/**
 * Familien-Match per Token-Praefix statt Substring: "wan2" gehoert zu "wan",
 * "swan" nicht (Substring wuerde treffen). Nutzt repoNameTokens wie die
 * Artefakt-Filter.
 */
function matchesVideoFamily(modelId: string): string | null {
  const tokens = repoNameTokens(modelId);
  for (const f of VIDEO_MODEL_FAMILIES) {
    for (const t of tokens) {
      if (t === f || t.startsWith(f)) return f;
    }
  }
  return null;
}

export function isVideoBaseModelId(modelId: string): boolean {
  return matchesVideoFamily(modelId) !== null;
}

/** Familien-Tags (Bild + Video) fuer das tags-Feld. */
const LORA_FAMILY_TAGS = [
  "lora",
  "flux",
  "sdxl",
  "stable-diffusion",
  "krea",
  "qwen",
  "wan",
  "ltx",
  "hunyuan",
  "cogvideo",
  "minimax",
  "video",
];

/** Rauschen raus: Lizenzen, Regionen, base_model-Tags, Sprachcodes (ausser "xl"), Task-/Runtime-Tags. */
const LORA_TAG_NOISE =
  /^(arxiv:|license:|region:|base_model:)|^(?!xl$)[a-z]{2}$|^(diffusers|comfyui|safetensors|transformers|pytorch|text-to-video|image-to-video|text-to-image|image-to-image)$/;

/**
 * Kurzbeschreibung aus Listen-Daten: Die List-Response enthaelt kein cardData,
 * also sind Likes/Downloads + die auffaelligsten Tags alles, was das LLM zur
 * Auswahl bekommt. Max. 6 Tags, ASCII (Encoding-Historie des Repos).
 */
function describeLoRA(m: HFModel): string {
  const stats = `${m.likes ?? 0} likes, ${m.downloads ?? 0} downloads`;
  const notable = (m.tags ?? [])
    .filter((t) => !LORA_FAMILY_TAGS.includes(t) && !LORA_TAG_NOISE.test(t))
    .slice(0, 6);
  return notable.length > 0 ? `${stats} | ${notable.join(", ")}` : stats;
}

export async function getDefaultLoRAs(
  baseModel: string,
  limit: number = 10,
  token?: string
): Promise<LoRAInfo[]> {
  return getLoRAsForModel(baseModel, "", limit, token);
}
