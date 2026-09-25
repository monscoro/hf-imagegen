import { type ModelInfo, type LoRAInfo, type ModelSource } from "./types";
import { CURATED_MODELS } from "./curatedModels";
import {
  getCachedProviderModels,
  setCachedProviderModels,
  getCachedTrendingModels,
  setCachedTrendingModels,
  getCachedDownloadedModels,
  setCachedDownloadedModels,
} from "./modelCache";
import {
  readHfCatalogCache,
  writeHfCatalogCache,
  fetchHfCatalog,
  getHfCatalogCacheFile,
  type HFCatalogEntry,
} from "./hfCatalogCache";

const HF_API_BASE = "https://huggingface.co/api";

interface HFModel {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  cardData?: {
    base_model?: string;
    license?: string;
    language?: string[];
  };
  pipeline_tag?: string;
  safetensors?: { total?: number };
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
  "q4_",
  "q5_",
  "q6_",
  "q8_",
  "nf4",
  "bnb",
];

export function isQuantizationArtifact(modelId: string): boolean {
  const repo = modelId.slice(modelId.indexOf("/") + 1).toLowerCase();
  return QUANTIZATION_MARKERS.some((marker) => repo.includes(marker));
}

function dropQuantizations<T extends { id: string }>(models: T[], limit: number): T[] {
  const kept = models.filter((m) => !isQuantizationArtifact(m.id));
  return kept.length > limit ? kept.slice(0, limit) : kept;
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
  const unique = disk ? indexHfCatalog(disk.models) : null;
  return {
    fetchedAt: disk ? new Date(disk.fetchedAt) : null,
    expiresInMs: disk ? Math.max(0, HF_CATALOG_TTL_MS - (now - disk.fetchedAt)) : 0,
    file: getHfCatalogCacheFile(),
    persisted: disk !== null,
    models: unique ? unique.size : 0,
    modelsWithProviders: unique
      ? [...unique.values()].filter((e) => e.providers.length > 0).length
      : 0,
    lastFetchFailureAt: lastHfFetchFailureAt > 0 ? new Date(lastHfFetchFailureAt) : null,
  };
}

export async function getProviderModels(
  provider: string,
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedProviderModels(provider, limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 2, 100);
  const url = `${HF_API_BASE}/models?inference_provider=${provider}&pipeline_tag=text-to-image&sort=trendingScore&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = dropQuantizations((await res.json()) as HFModel[], limit);

  const result = models.map((m) => ({
    id: m.id,
    description: `${m.id} — Text-to-Image model via ${provider}`,
    style: "varies",
    speed: "medium" as const,
    access: "free" as const,
    source: "provider" as ModelSource,
    parameters: m.safetensors?.total
      ? `${Math.round(m.safetensors.total / 1e9)}B`
      : undefined,
    license: m.cardData?.license,
  }));

  setCachedProviderModels(provider, limit, result);
  return result;
}

export async function getTrendingModels(
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedTrendingModels(limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 2, 100);
  const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=trendingScore&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = dropQuantizations((await res.json()) as HFModel[], limit);

  const result = models.map((m) => ({
    id: m.id,
    description: `${m.id} — Trending text-to-image model`,
    style: "varies",
    speed: "medium" as const,
    access: "free" as const,
    source: "trending" as ModelSource,
    parameters: m.safetensors?.total
      ? `${Math.round(m.safetensors.total / 1e9)}B`
      : undefined,
    license: m.cardData?.license,
  }));

  setCachedTrendingModels(limit, result);
  return result;
}

export async function getDownloadedModels(
  limit: number = 20,
  token?: string
): Promise<ModelInfo[]> {
  const cached = getCachedDownloadedModels(limit);
  if (cached) return cached;

  const fetchLimit = Math.min(limit * 2, 100);
  const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=downloads&limit=${fetchLimit}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

  const models = dropQuantizations((await res.json()) as HFModel[], limit);

  const result = models.map((m) => ({
    id: m.id,
    description: `${m.id} — Popular text-to-image model`,
    style: "varies",
    speed: "medium" as const,
    access: "free" as const,
    source: "downloads" as ModelSource,
    parameters: m.safetensors?.total
      ? `${Math.round(m.safetensors.total / 1e9)}B`
      : undefined,
    license: m.cardData?.license,
  }));

  setCachedDownloadedModels(limit, result);
  return result;
}

export async function getLoRAsForModel(
  baseModel: string,
  search: string = "",
  limit: number = 15,
  token?: string
): Promise<LoRAInfo[]> {
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
    if (m.cardData?.base_model) return m.cardData.base_model;
    const tag = (m.tags ?? []).find((t) => t.startsWith("base_model:"));
    return tag ? tag.replace("base_model:", "") : "unknown";
  }

  return models
    .map((m) => ({
      id: m.id,
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      base_model: extractBaseModel(m),
      tags: (m.tags ?? []).filter((t) =>
        ["lora", "flux", "sdxl", "stable-diffusion", "krea", "qwen"].includes(t)
      ),
    }))
    .filter((m) => {
      if (!baseModel) return true;
      const loraBase = m.base_model.toLowerCase();
      const searchBase = baseModel.toLowerCase();
      const modelShort = searchBase.split("/").pop() || "";
      return loraBase.includes(searchBase) || loraBase.includes(modelShort);
    });
}

export async function getDefaultLoRAs(
  baseModel: string,
  limit: number = 10,
  token?: string
): Promise<LoRAInfo[]> {
  return getLoRAsForModel(baseModel, "", limit, token);
}
