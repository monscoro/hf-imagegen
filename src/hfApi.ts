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
