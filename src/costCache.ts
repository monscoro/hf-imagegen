import { z } from "zod";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface CostEntry {
  cost: string;
  rawTokens: number;
}

interface CostCache {
  fetchedAt: number;
  costs: Record<string, CostEntry>;
}

let cache: CostCache | null = null;

function formatCost(tokens: number): string {
  if (tokens === 0) return "free";
  if (tokens < 0.001) return `~${tokens.toExponential(1)} pollen`;
  return `~${tokens.toFixed(4)} pollen`;
}

async function fetchPollinationsCosts(): Promise<Record<string, CostEntry>> {
  const costs: Record<string, CostEntry> = {};
  try {
    const resp = await fetch("https://gen.pollinations.ai/v1/models", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return costs;
    const data = await resp.json() as { data: Array<{
      id: string;
      supported_endpoints?: string[];
      pricing?: { currency?: string; completionImageTokens?: string };
    }> };
    for (const m of data.data) {
      const endpoints = m.supported_endpoints ?? [];
      const isImageModel =
        endpoints.includes("/v1/images/generations") ||
        endpoints.some((e) => e.startsWith("/image/"));
      if (!isImageModel) continue;
      const completionCost = parseFloat(m.pricing?.completionImageTokens ?? "0");
      if (isNaN(completionCost)) continue;
      costs[m.id] = { cost: formatCost(completionCost), rawTokens: completionCost };
    }
  } catch {
    // fetch failed — return empty, cache will retry after TTL
  }
  return costs;
}

const HF_COSTS: Record<string, CostEntry> = {
  "black-forest-labs/FLUX.1-dev": { cost: "free (license needed)", rawTokens: 0 },
  "black-forest-labs/FLUX.1-schnell": { cost: "free", rawTokens: 0 },
  "black-forest-labs/FLUX.1-Krea-dev": { cost: "free (license needed)", rawTokens: 0 },
  "krea/Krea-2-Turbo": { cost: "free", rawTokens: 0 },
  "Qwen/Qwen-Image-2512": { cost: "free", rawTokens: 0 },
  "stabilityai/stable-diffusion-xl-base-1.0": { cost: "free", rawTokens: 0 },
  "stabilityai/stable-diffusion-3.5-large": { cost: "free (gated)", rawTokens: 0 },
  "Tongyi-MAI/Z-Image-Turbo": { cost: "free", rawTokens: 0 },
  "black-forest-labs/FLUX.2-dev": { cost: "free (license needed)", rawTokens: 0 },
  "black-forest-labs/FLUX.1-Kontext-dev": { cost: "free (license needed)", rawTokens: 0 },
  "Qwen/Qwen-Image-Edit": { cost: "free", rawTokens: 0 },
};

async function ensureCache(): Promise<CostCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  const pollinationsCosts = await fetchPollinationsCosts();
  cache = {
    fetchedAt: Date.now(),
    costs: { ...HF_COSTS, ...pollinationsCosts },
  };
  return cache;
}

export async function getCost(modelId: string): Promise<string | undefined> {
  const c = await ensureCache();
  return c.costs[modelId]?.cost;
}

export async function getAllCosts(): Promise<Record<string, CostEntry>> {
  const c = await ensureCache();
  return { ...c.costs };
}

export async function getCacheInfo(): Promise<{ fetchedAt: Date; expiresInMs: number; modelCount: number }> {
  const c = await ensureCache();
  return {
    fetchedAt: new Date(c.fetchedAt),
    expiresInMs: Math.max(0, CACHE_TTL_MS - (Date.now() - c.fetchedAt)),
    modelCount: Object.keys(c.costs).length,
  };
}
