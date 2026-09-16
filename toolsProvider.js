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
const rateLimit_1 = require("./rateLimit");
const directiveStore_1 = require("./directiveStore");
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
    const getRateLimitConfig = () => ({
        cooldownMs: Number(cfg.get("rateLimitCooldown")) || 5000,
        dailyCap: Number(cfg.get("rateLimitDailyCap")) || 50,
    });
    const getCustomDirectivesText = () => {
        try {
            return cfg.get("customDirectives") ?? "";
        }
        catch {
            return "";
        }
    };
    let isGenerating = false;
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
                const rateLimitResult = (0, rateLimit_1.checkRateLimit)(getRateLimitConfig());
                if (!rateLimitResult.ok) {
                    throw new Error(rateLimitResult.error);
                }
                if (isGenerating) {
                    throw new Error("Another generation is already in progress. Wait for it to finish.");
                }
                isGenerating = true;
                try {
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
                    (0, rateLimit_1.recordGeneration)();
                    const remaining = (0, rateLimit_1.checkRateLimit)(getRateLimitConfig());
                    const remainingCount = remaining.ok ? remaining.remaining : 0;
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
                        generations_remaining_today: remainingCount,
                        message: `Image saved to ${filePath}`,
                    });
                }
                finally {
                    isGenerating = false;
                }
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
                const LORA_CAP = 10;
                let loraTruncated = false;
                if (include_loras && models.length > 0) {
                    const targets = models.slice(0, LORA_CAP);
                    loraTruncated = models.length > LORA_CAP;
                    ctx.status(`Loading compatible LoRAs for ${targets.length} models...`);
                    for (const model of targets) {
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
                    note: loraTruncated
                        ? `LoRA lookup capped to first ${LORA_CAP} models to avoid API flood. Use list_loras with base_model for others.`
                        : source === "curated"
                            ? "Expert-verified models. Use list_loras with base_model to find compatible LoRAs."
                            : "Pass model_id to generate_image to use a model.",
                });
            }),
        }),
        (0, sdk_1.tool)({
            name: "list_loras",
            description: (0, sdk_1.text) `
        Search HuggingFace for LoRA adapters.

        IMPORTANT: Avoid using the 'search' keyword filter! It often returns zero results because HuggingFace search is very strict.
        Instead, use only 'base_model' to find all compatible LoRAs, then pick from the results.
        Only use 'search' as a last resort with a very broad term (e.g. 'anime') if the result list is too large to browse.

        Use 'base_model' to find LoRAs compatible with a specific model.
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
                    .describe("AVOID using this — HuggingFace search is strict and often returns no results. " +
                    "Only use as a last resort with a broad keyword (e.g. 'anime'). " +
                    "Prefer using only base_model."),
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
        (0, sdk_1.tool)({
            name: "inclination_prompt_list",
            description: (0, sdk_1.text) `
        List all available Neigungsprompts / ImageGen Stimmungsprompts (profile set) – einheitlicher Prefix inclination_prompt_.

        Returns curated examples (read-only, source=curated) + user config (source=config, in plugin settings editable, per entry [ro]/[rw] switchable) + LLM-created (source=user).
        Each entry has id (short name), description (first line), prompt (indirect style/mood), source, readonly flag.
        Curated are only examples (few, not exhaustive) – main library is user config.

        Use this to discover available moods before calling inclination_prompt_set.
        The active profile is highlighted and also injected into the LLM system context to guide generate_image prompt creation.
        Hinweis: list ist auch via inclination_prompt_manage({action:"list"}) verfügbar (vereinheitlicht).
      `,
            parameters: {
                filter: zod_1.z.string().default("").describe("Optional substring to filter by id or description. Leave blank for all."),
            },
            implementation: safe_impl("inclination_prompt_list", async ({ filter }, _ctx) => {
                const text_ = getCustomDirectivesText();
                const all = (0, directiveStore_1.getAllDirectives)(text_);
                const activeId = (0, directiveStore_1.getActiveId)();
                const active = (0, directiveStore_1.getActiveDirective)(text_);
                const f = filter.trim().toLowerCase();
                const filtered = f ? all.filter((d) => d.id.includes(f) || d.description.toLowerCase().includes(f)) : all;
                return json({
                    active_id: activeId,
                    active_directive: active,
                    count: filtered.length,
                    total_count: all.length,
                    directives: filtered.map((d) => ({
                        ...d,
                        is_active: d.id === activeId,
                    })),
                    note: "Use inclination_prompt_set({name}) to activate. Curated=examples read-only, config RO=[ro] locked / RW=[rw] LLM-editable, user=via inclination_prompt_manage.",
                    config_hint: "Config 'Neigungsprompt-Katalog': 'name: Beschreibung [ro|rw]' Zeile 1, dann Prompt. Leerzeile/--- trennt. [ro]=read-only (default), [rw]=LLM darf ändern. Beispiele: siehe curated.",
                });
            }),
        }),
        (0, sdk_1.tool)({
            name: "inclination_prompt_set",
            description: (0, sdk_1.text) `
        Activate or clear the Neigungsprompt (Stimmungsprompt / Beeinflussungsprompt, synonym) for indirect prompt guidance – einheitlicher Prefix inclination_prompt_.

        Manages the whole profile set by simple name. The active prompt is injected as system context
        and guides the Tool LLM to create stylistically aligned generate_image prompts (Mood, Kunststil, Ausrichtung, Inszenierung).

        - Pass a name from inclination_prompt_list to activate (e.g. "pose-action", "interaction").
        - Pass empty string or "none"/"clear" to deactivate.
        Use inclination_prompt_list first to discover available profiles.
      `,
            parameters: {
                name: zod_1.z.string().describe("Profile id to activate (e.g. 'pose-action'). Use '' or 'none' to clear/deactivate."),
            },
            implementation: safe_impl("inclination_prompt_set", async ({ name }, _ctx) => {
                const text_ = getCustomDirectivesText();
                const clean = name.trim().toLowerCase();
                if (!clean || clean === "none" || clean === "clear") {
                    (0, directiveStore_1.setActiveDirective)(null, text_);
                    return json({
                        success: true,
                        active_id: null,
                        active_directive: null,
                        message: "Neigungsprompt deaktiviert. generate_image nutzt wieder neutralen Stil.",
                    });
                }
                const activated = (0, directiveStore_1.setActiveDirective)(clean, text_);
                return json({
                    success: true,
                    active_id: activated.id,
                    active_directive: activated,
                    message: `Aktiviert: ${activated.id} — ${activated.description}. Wird jetzt indirekt bei generate_image berücksichtigt.`,
                });
            }),
        }),
        (0, sdk_1.tool)({
            name: "inclination_prompt_manage",
            description: (0, sdk_1.text) `
        Create, update, delete, get, or list Neigungsprompts (Stimmungsprompts / Beeinflussungsprompts, synonym) – einheitlicher Prefix inclination_prompt_, LLM-managed, persisted in ~/.cache/hf-image-gen/directives.json. Vereinheitlicht list+manage via action:"list".

        Curated (source=curated) are examples only, always read-only.
        Config (source=config) profiles are user-written in plugin settings: with [ro] read-only (default, cannot be changed via tool), with [rw] RW (LLM darf via update ändern -> shadowed in user store). Delete of config base never via tool, only shadow revert.
        User (source=user) profiles are fully manageable here.

        Use when the user wants a new mood/style or the LLM wants to create a tailored Neigungsprompt dynamically.
        After create/update, use inclination_prompt_set to activate it. Use action:"list" to list (alternative to inclination_prompt_list).
      `,
            parameters: {
                action: zod_1.z.enum(["create", "update", "delete", "get", "list"]).describe("Action to perform. Use list to list all (unified with inclination_prompt_list)."),
                name: zod_1.z.string().default("").describe("Profile id (a-z,0-9,-,_). Required for create/update/delete/get, optional for list (ignored)."),
                description: zod_1.z.string().default("").describe("Kurzbeschreibung (Zeile 1). Required for create, optional for update."),
                prompt: zod_1.z.string().default("").describe("Neigungsprompt (indirekter Style/Mood, nicht direkter Bildinhalt). Required for create, optional for update."),
                filter: zod_1.z.string().default("").describe("Optional filter for list (substring of id/description). Only for action list."),
            },
            implementation: safe_impl("inclination_prompt_manage", async ({ action, name, description, prompt, filter }, _ctx) => {
                const text_ = getCustomDirectivesText();
                if (action === "list") {
                    const all = (0, directiveStore_1.getAllDirectives)(text_);
                    const activeId = (0, directiveStore_1.getActiveId)();
                    const active = (0, directiveStore_1.getActiveDirective)(text_);
                    const f = filter.trim().toLowerCase();
                    const filtered = f ? all.filter((d) => d.id.includes(f) || d.description.toLowerCase().includes(f)) : all;
                    return json({
                        active_id: activeId,
                        active_directive: active,
                        count: filtered.length,
                        total_count: all.length,
                        directives: filtered.map((d) => ({
                            ...d,
                            is_active: d.id === activeId,
                        })),
                        note: "Use inclination_prompt_set({name}) to activate. Vereinheitlicht: list via manage action list oder via inclination_prompt_list.",
                    });
                }
                const cleanName = name.trim().toLowerCase();
                if (!cleanName)
                    throw new Error("name is required for create/update/delete/get.");
                switch (action) {
                    case "create": {
                        if (!description.trim())
                            throw new Error("description is required for create.");
                        if (!prompt.trim())
                            throw new Error("prompt is required for create.");
                        const created = (0, directiveStore_1.createDirective)(cleanName, description, prompt, text_);
                        return json({ success: true, action, directive: created, message: `Erstellt: ${created.id}. Aktiviere mit inclination_prompt_set({name:"${created.id}"}).` });
                    }
                    case "update": {
                        const hasDesc = description.trim().length > 0;
                        const hasPrompt = prompt.trim().length > 0;
                        if (!hasDesc && !hasPrompt)
                            throw new Error("For update, provide at least description or prompt.");
                        const updated = (0, directiveStore_1.updateDirective)(cleanName, hasDesc ? description : undefined, hasPrompt ? prompt : undefined, text_);
                        return json({ success: true, action, directive: updated, message: `Aktualisiert: ${updated.id}.` });
                    }
                    case "delete": {
                        (0, directiveStore_1.deleteDirective)(cleanName, text_);
                        return json({ success: true, action, deleted_id: cleanName, message: `Gelöscht: ${cleanName}.` });
                    }
                    case "get": {
                        const found = (0, directiveStore_1.getDirectiveById)(cleanName, text_);
                        if (!found)
                            throw new Error(`Profil "${cleanName}" nicht gefunden.`);
                        const activeId = (0, directiveStore_1.getActiveId)();
                        return json({ success: true, action, directive: found, is_active: found.id === activeId });
                    }
                    default:
                        throw new Error(`Unknown action ${action}`);
                }
            }),
        }),
    ];
    return tools;
};
exports.toolsProvider = toolsProvider;
