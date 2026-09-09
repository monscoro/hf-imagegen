"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCuratedModels = getCuratedModels;
exports.getProviderModels = getProviderModels;
exports.getTrendingModels = getTrendingModels;
exports.getDownloadedModels = getDownloadedModels;
exports.getLoRAsForModel = getLoRAsForModel;
exports.getDefaultLoRAs = getDefaultLoRAs;
const curatedModels_1 = require("./curatedModels");
const HF_API_BASE = "https://huggingface.co/api";
function getCuratedModels() {
    return curatedModels_1.CURATED_MODELS;
}
async function getProviderModels(provider, limit = 20, token) {
    const url = `${HF_API_BASE}/models?inference_provider=${provider}&pipeline_tag=text-to-image&sort=trending&limit=${limit}`;
    const headers = { Accept: "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
        throw new Error(`HF API error: ${res.status} ${res.statusText}`);
    const models = (await res.json());
    return models.map((m) => ({
        id: m.id,
        description: `${m.id} — Text-to-Image model via ${provider}`,
        style: "varies",
        speed: "medium",
        access: "free",
        source: "provider",
        parameters: m.safetensors?.total
            ? `${Math.round(m.safetensors.total / 1e9)}B`
            : undefined,
        license: m.cardData?.license,
    }));
}
async function getTrendingModels(limit = 20, token) {
    const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=trending&limit=${limit}`;
    const headers = { Accept: "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
        throw new Error(`HF API error: ${res.status} ${res.statusText}`);
    const models = (await res.json());
    return models.map((m) => ({
        id: m.id,
        description: `${m.id} — Trending text-to-image model`,
        style: "varies",
        speed: "medium",
        access: "free",
        source: "trending",
        parameters: m.safetensors?.total
            ? `${Math.round(m.safetensors.total / 1e9)}B`
            : undefined,
        license: m.cardData?.license,
    }));
}
async function getDownloadedModels(limit = 20, token) {
    const url = `${HF_API_BASE}/models?pipeline_tag=text-to-image&sort=downloads&limit=${limit}`;
    const headers = { Accept: "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
        throw new Error(`HF API error: ${res.status} ${res.statusText}`);
    const models = (await res.json());
    return models.map((m) => ({
        id: m.id,
        description: `${m.id} — Popular text-to-image model`,
        style: "varies",
        speed: "medium",
        access: "free",
        source: "downloads",
        parameters: m.safetensors?.total
            ? `${Math.round(m.safetensors.total / 1e9)}B`
            : undefined,
        license: m.cardData?.license,
    }));
}
async function getLoRAsForModel(baseModel, search = "", limit = 15, token) {
    const modelKey = baseModel.toLowerCase();
    let query;
    if (modelKey.includes("flux")) {
        query = search ? `${search} flux lora` : "flux lora";
    }
    else if (modelKey.includes("sdxl") || modelKey.includes("stable-diffusion")) {
        query = search ? `${search} sdxl lora` : "sdxl lora";
    }
    else if (modelKey.includes("krea")) {
        query = search ? `${search} krea lora` : "krea lora";
    }
    else if (modelKey.includes("qwen")) {
        query = search ? `${search} qwen lora` : "qwen lora";
    }
    else {
        query = search || `${baseModel.split("/").pop()} lora`;
    }
    const url = `${HF_API_BASE}/models?search=${encodeURIComponent(query)}&filter=lora&sort=downloads&limit=${limit}`;
    const headers = { Accept: "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
        throw new Error(`HF API error: ${res.status} ${res.statusText}`);
    const models = (await res.json());
    return models
        .filter((m) => {
        if (!baseModel)
            return true;
        const loraBase = m.cardData?.base_model?.toLowerCase() || "";
        const searchBase = baseModel.toLowerCase();
        const modelShort = searchBase.split("/").pop() || "";
        return loraBase.includes(searchBase) || loraBase.includes(modelShort);
    })
        .map((m) => ({
        id: m.id,
        downloads: m.downloads ?? 0,
        likes: m.likes ?? 0,
        base_model: m.cardData?.base_model ?? "unknown",
        tags: (m.tags ?? []).filter((t) => ["lora", "flux", "sdxl", "stable-diffusion", "krea", "qwen"].includes(t)),
    }));
}
async function getDefaultLoRAs(baseModel, limit = 10, token) {
    return getLoRAsForModel(baseModel, "", limit, token);
}
