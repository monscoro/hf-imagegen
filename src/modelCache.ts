import { type ModelInfo, type LoRAInfo } from "./types";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface ModelCacheEntry<T = ModelInfo> {
  fetchedAt: number;
  models: T[];
}

interface ModelCache {
  provider: Record<string, ModelCacheEntry>;
  trending: Record<number, ModelCacheEntry>;
  downloads: Record<number, ModelCacheEntry>;
  video: Record<number, ModelCacheEntry>;
  /** LoRA-Suchen (Phase 2.B): Key = base_model|search|limit, kleinteilig. */
  lora: Record<string, ModelCacheEntry<LoRAInfo>>;
}

let cache: ModelCache = {
  provider: {},
  trending: {},
  downloads: {},
  video: {},
  lora: {},
};

function isCacheValid(entry: ModelCacheEntry<unknown> | null): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

export function getCachedProviderModels(provider: string, limit: number): ModelInfo[] | null {
  const key = `${provider}:${limit}`;
  const entry = cache.provider[key];
  if (!isCacheValid(entry ?? null)) return null;
  return entry?.models ?? null;
}

export function setCachedProviderModels(provider: string, limit: number, models: ModelInfo[]): void {
  const key = `${provider}:${limit}`;
  cache.provider[key] = {
    fetchedAt: Date.now(),
    models,
  };
}

export function getCachedTrendingModels(limit: number): ModelInfo[] | null {
  const entry = cache.trending[limit];
  if (!isCacheValid(entry ?? null)) return null;
  return entry?.models ?? null;
}

export function setCachedTrendingModels(limit: number, models: ModelInfo[]): void {
  cache.trending[limit] = {
    fetchedAt: Date.now(),
    models,
  };
}

export function getCachedDownloadedModels(limit: number): ModelInfo[] | null {
  const entry = cache.downloads[limit];
  if (!isCacheValid(entry ?? null)) return null;
  return entry?.models ?? null;
}

export function setCachedDownloadedModels(limit: number, models: ModelInfo[]): void {
  cache.downloads[limit] = {
    fetchedAt: Date.now(),
    models,
  };
}

export function getCachedVideoModels(limit: number): ModelInfo[] | null {
  const entry = cache.video[limit];
  if (!isCacheValid(entry ?? null)) return null;
  return entry?.models ?? null;
}

export function setCachedVideoModels(limit: number, models: ModelInfo[]): void {
  cache.video[limit] = {
    fetchedAt: Date.now(),
    models,
  };
}

export function getCachedLoRAs(key: string): LoRAInfo[] | null {
  const entry = cache.lora[key];
  if (!isCacheValid(entry ?? null)) return null;
  return entry?.models ?? null;
}

export function setCachedLoRAs(key: string, loras: LoRAInfo[]): void {
  // Prozesslokal, 12h TTL, kein Platten-Cache (klein, user-spezifisch).
  cache.lora[key] = {
    fetchedAt: Date.now(),
    models: loras,
  };
}

export function getModelCacheInfo(): {
  provider: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  trending: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  downloads: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  video: Record<string, { fetchedAt: Date; expiresInMs: number }>;
} {
  const getInfo = (entry: ModelCacheEntry<unknown> | null) => {
    if (!entry) return null;
    return {
      fetchedAt: new Date(entry.fetchedAt),
      expiresInMs: Math.max(0, CACHE_TTL_MS - (Date.now() - entry.fetchedAt)),
    };
  };

  const providerInfo: Record<string, { fetchedAt: Date; expiresInMs: number }> = {};
  for (const [key, entry] of Object.entries(cache.provider)) {
    providerInfo[key] = getInfo(entry)!;
  }

  const trendingInfo: Record<string, { fetchedAt: Date; expiresInMs: number }> = {};
  for (const [key, entry] of Object.entries(cache.trending)) {
    trendingInfo[key] = getInfo(entry)!;
  }

  const downloadsInfo: Record<string, { fetchedAt: Date; expiresInMs: number }> = {};
  for (const [key, entry] of Object.entries(cache.downloads)) {
    downloadsInfo[key] = getInfo(entry)!;
  }

  const videoInfo: Record<string, { fetchedAt: Date; expiresInMs: number }> = {};
  for (const [key, entry] of Object.entries(cache.video)) {
    videoInfo[key] = getInfo(entry)!;
  }

  return {
    provider: providerInfo,
    trending: trendingInfo,
    downloads: downloadsInfo,
    video: videoInfo,
  };
}
