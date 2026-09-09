"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolsProvider = void 0;
const sdk_1 = require("@lmstudio/sdk");
const inference_1 = require("@huggingface/inference");
const zod_1 = require("zod");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const config_1 = require("./config");
const hfApi_1 = require("./hfApi");
function json(obj) {
    return JSON.stringify(obj, null, 2);
}
function safe_impl(name, fn) {
    return async (params, ctx) => {
        if (ctx.signal.aborted) {
            return JSON.stringify({ tool_error: true, tool: name, error: "cancelled" });
        }
        try {
            return await fn(params, ctx);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return JSON.stringify({
                tool_error: true,
                tool: name,
                error: msg,
                hint: "Read the error above, fix the parameter causing the issue, and retry the tool call.",
            }, null, 2);
        }
    };
}
function resolvePath(p) {
    if (p === "~")
        return os.homedir();
    if (p.startsWith("~/"))
        return path.join(os.homedir(), p.slice(2));
    return path.resolve(p);
}
function timestampedFilename(ext) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    return `hf-${ts}.${ext}`;
}
const toolsProvider = async (ctl) => {
    const cfg = ctl.getPluginConfig(config_1.pluginConfigSchematics);
    const getToken = () => cfg.get("hfApiToken").trim();
    const getModel = () => cfg.get("defaultModel").trim() || "black-forest-labs/FLUX.1-schnell";
    const getOutputDir = () => resolvePath(cfg.get("outputDirectory").trim() || "~/hf-images");
    const tools = [
        (0, sdk_1.tool)({
            name: "generate_image",
            description: (0, sdk_1.text) `
        Generate an image from a text prompt using a Hugging Face text-to-image model.
        Saves the image to disk and returns the file path.

        Use when the user asks to generate, create, draw, paint, or visualize something.
        The model defaults to config unless overridden with model_id.

        LoRA support: pass a lora_id (HuggingFace model ID of a LoRA adapter) to apply a style or
        character LoRA on top of the base model. Uses fal-ai provider which supports FLUX LoRAs.

        Note: FLUX.1-schnell requires accepting the license at huggingface.co first.
        HF free tier may take 20-60s to warm up inactive models on the first call.
      `,
            parameters: {
                prompt: zod_1.z.string().min(1).describe("Text description of the image. Be specific — subject, style, lighting, mood, quality terms."),
                model_id: zod_1.z.string().default("").describe("HuggingFace model ID override (e.g. 'stabilityai/stable-diffusion-xl-base-1.0'). " +
                    "Leave blank to use the default model from plugin config."),
                negative_prompt: zod_1.z.string().default("").describe("What to exclude from the image (e.g. 'blurry, low quality, text, watermark'). " +
                    "Not all models support this."),
                lora_id: zod_1.z.string().default("").describe("HuggingFace model ID of a LoRA adapter to apply (e.g. 'alvdansen/flux-koda'). " +
                    "Only compatible with FLUX base models. Use list_loras to discover available LoRAs."),
                lora_scale: zod_1.z.number().min(0).max(2).default(1.0).describe("Strength of the LoRA adapter. 0.5–1.0 is typical; higher = stronger effect."),
            },
            implementation: safe_impl("generate_image", async ({ prompt, model_id, negative_prompt, lora_id, lora_scale }, ctx) => {
                ctx.status("Generating image…");
                const token = getToken();
                if (!token) {
                    throw new Error("HuggingFace API token is not set. " +
                        "Go to plugin settings and paste your token from huggingface.co/settings/tokens.");
                }
                const modelToUse = model_id.trim() || getModel();
                const cleanNegative = negative_prompt.trim();
                const cleanLora = lora_id.trim();
                const outputDir = getOutputDir();
                await (0, promises_1.mkdir)(outputDir, { recursive: true });
                const hf = new inference_1.InferenceClient(token);
                const parameters = {};
                if (cleanNegative)
                    parameters.negative_prompt = cleanNegative;
                if (cleanLora)
                    parameters.loras = [{ path: cleanLora, scale: lora_scale }];
                ctx.status(`Calling ${modelToUse}…`);
                const blob = await hf.textToImage({
                    provider: cleanLora ? "fal-ai" : "auto",
                    model: modelToUse,
                    inputs: prompt,
                    parameters,
                });
                const mimeType = blob.type || "image/png";
                const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpeg" : "png";
                const filename = timestampedFilename(ext);
                const filePath = path.join(outputDir, filename);
                const buffer = Buffer.from(await blob.arrayBuffer());
                await (0, promises_1.writeFile)(filePath, buffer);
                return json({
                    success: true,
                    file_path: filePath,
                    filename,
                    model_used: modelToUse,
                    lora_used: cleanLora || null,
                    lora_scale: cleanLora ? lora_scale : null,
                    prompt,
                    negative_prompt: cleanNegative || null,
                    file_size_bytes: buffer.length,
                    mime_type: mimeType,
                    message: `Image saved to ${filePath}`,
                });
            }),
        }),
        (0, sdk_1.tool)({
            name: "list_models",
            description: (0, sdk_1.text) `
        Return available Hugging Face text-to-image models.

        Use the 'source' parameter to control which models to show:
        - "curated" (default): Expert-verified models with detailed descriptions and LoRA compatibility info
        - "provider": Models from a specific inference provider (e.g. "fal-ai", "nscale")
        - "trending": Currently popular models on HuggingFace
        - "downloads": Most downloaded models

        When source="provider", you must also specify the provider name.
        Each model includes compatible_loras_count when available.
      `,
            parameters: {
                source: zod_1.z.enum(["curated", "provider", "trending", "downloads"])
                    .default("curated")
                    .describe("Which model list to return. Default: curated (expert-verified models)."),
                provider: zod_1.z.string()
                    .default("")
                    .describe("Inference provider name (required when source='provider'). " +
                    "Examples: fal-ai, nscale, replicate, wavespeed."),
                limit: zod_1.z.number()
                    .min(5)
                    .max(50)
                    .default(20)
                    .describe("Maximum number of models to return (only for provider/trending/downloads)."),
                include_loras: zod_1.z.boolean()
                    .default(false)
                    .describe("Include compatible LoRAs for each model (slower, requires API calls)."),
            },
            implementation: safe_impl("list_models", async ({ source, provider, limit, include_loras }, ctx) => {
                const token = getToken();
                const currentDefault = getModel();
                ctx.status(`Fetching ${source} models...`);
                let models;
                switch (source) {
                    case "curated":
                        models = (0, hfApi_1.getCuratedModels)();
                        break;
                    case "provider":
                        if (!provider.trim()) {
                            throw new Error("provider parameter is required when source='provider'. " +
                                "Examples: fal-ai, nscale, replicate.");
                        }
                        models = await (0, hfApi_1.getProviderModels)(provider.trim(), limit, token || undefined);
                        break;
                    case "trending":
                        models = await (0, hfApi_1.getTrendingModels)(limit, token || undefined);
                        break;
                    case "downloads":
                        models = await (0, hfApi_1.getDownloadedModels)(limit, token || undefined);
                        break;
                    default:
                        models = (0, hfApi_1.getCuratedModels)();
                }
                if (include_loras && models.length > 0) {
                    ctx.status("Loading compatible LoRAs...");
                    for (const model of models) {
                        try {
                            const loras = await (0, hfApi_1.getDefaultLoRAs)(model.id, 5, token || undefined);
                            model.compatible_loras = loras;
                            model.compatible_loras_count = loras.length;
                        }
                        catch {
                            // LoRA query failed, continue
                        }
                    }
                }
                return json({
                    source,
                    current_default_model: currentDefault,
                    models: models.map((m) => ({
                        ...m,
                        is_default: m.id === currentDefault,
                    })),
                    note: source === "curated"
                        ? "Expert-verified models. Use list_loras with base_model to find compatible LoRAs."
                        : "Pass model_id to generate_image to use a model.",
                });
            }),
        }),
        (0, sdk_1.tool)({
            name: "list_loras",
            description: (0, sdk_1.text) `
        Search HuggingFace for LoRA adapters.

        Use 'base_model' to find only LoRAs compatible with a specific model.
        Use 'search' to filter by keyword (e.g. 'anime', 'portrait', 'watercolor').

        When base_model is provided, only compatible LoRAs are returned.
        The base_model should be a model ID from list_models (e.g. 'black-forest-labs/FLUX.1-dev').
      `,
            parameters: {
                base_model: zod_1.z.string()
                    .default("")
                    .describe("Filter LoRAs by compatible base model. " +
                    "Use model IDs from list_models (e.g. 'black-forest-labs/FLUX.1-dev', " +
                    "'stabilityai/stable-diffusion-xl-base-1.0'). " +
                    "Leave blank to search all LoRAs."),
                search: zod_1.z.string()
                    .default("")
                    .describe("Optional keyword to filter LoRAs (e.g. 'anime', 'portrait', 'watercolor'). " +
                    "Can be combined with base_model."),
                limit: zod_1.z.number()
                    .min(5)
                    .max(30)
                    .default(15)
                    .describe("Maximum number of results to return."),
            },
            implementation: safe_impl("list_loras", async ({ base_model, search, limit }, ctx) => {
                const token = getToken();
                const cleanBaseModel = base_model.trim();
                const cleanSearch = search.trim();
                ctx.status(cleanBaseModel
                    ? `Finding LoRAs for ${cleanBaseModel}...`
                    : "Searching LoRAs...");
                const results = await (0, hfApi_1.getLoRAsForModel)(cleanBaseModel, cleanSearch, limit, token || undefined);
                return json({
                    query: cleanSearch || "all",
                    base_model_filter: cleanBaseModel || "none (showing all)",
                    results,
                    count: results.length,
                    usage: cleanBaseModel
                        ? `These LoRAs are compatible with ${cleanBaseModel}. Pass the 'id' field as lora_id in generate_image.`
                        : "Pass the 'id' field as lora_id in generate_image. Use base_model to filter for specific models.",
                    note: "LoRA generation uses fal-ai provider. lora_scale default is 1.0; try 0.6–0.9 for subtle effects.",
                });
            }),
        }),
    ];
    return tools;
};
exports.toolsProvider = toolsProvider;
