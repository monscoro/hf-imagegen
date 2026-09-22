import { type ModelInfo } from "./types";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface ModelCacheEntry {
  fetchedAt: number;
  models: ModelInfo[];
}

interface ModelCache {
  provider: Record<string, ModelCacheEntry>;
  trending: Record<number, ModelCacheEntry>;
  downloads: Record<number, ModelCacheEntry>;
  pollinations: ModelCacheEntry | null;
}

let cache: ModelCache = {
  provider: {},
  trending: {},
  downloads: {},
  pollinations: null,
};

function isCacheValid(entry: ModelCacheEntry | null): boolean {
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

export function getCachedPollinationsModels(): ModelInfo[] | null {
  if (!isCacheValid(cache.pollinations)) return null;
  return cache.pollinations?.models ?? null;
}

export function setCachedPollinationsModels(models: ModelInfo[]): void {
  cache.pollinations = {
    fetchedAt: Date.now(),
    models,
  };
}

export function getModelCacheInfo(): {
  provider: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  trending: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  downloads: Record<string, { fetchedAt: Date; expiresInMs: number }>;
  pollinations: { fetchedAt: Date; expiresInMs: number } | null;
} {
  const getInfo = (entry: ModelCacheEntry | null) => {
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

  return {
    provider: providerInfo,
    trending: trendingInfo,
    downloads: downloadsInfo,
    pollinations: getInfo(cache.pollinations),
  };
}
