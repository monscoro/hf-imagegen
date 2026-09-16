import { text, tool, type Tool, type ToolCallContext, type ToolsProvider } from "@lmstudio/sdk";
import { InferenceClient } from "@huggingface/inference";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { pluginConfigSchematics } from "./config";
import {
  getCuratedModels,
  getProviderModels,
  getTrendingModels,
  getDownloadedModels,
  getLoRAsForModel,
  getDefaultLoRAs,
} from "./hfApi";
import { checkRateLimit, recordGeneration } from "./rateLimit";
import {
  getAllDirectives,
  getActiveDirective,
  getActiveId,
  setActiveDirective,
  createDirective,
  updateDirective,
  deleteDirective,
  getDirectiveById,
} from "./directiveStore";

function json(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

function safe_impl<T extends Record<string, unknown>>(
  name: string,
  fn: (params: T, ctx: ToolCallContext) => Promise<string>
): (params: T, ctx: ToolCallContext) => Promise<string> {
  return async (params: T, ctx: ToolCallContext) => {
    if (ctx.signal.aborted) {
      return JSON.stringify({ tool_error: true, tool: name, error: "cancelled" });
    }
    try {
      return await fn(params, ctx);
    } catch (err: unknown) {
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

function resolvePath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function timestampedFilename(ext: "png" | "jpeg"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `hf-${ts}.${ext}`;
}

export const toolsProvider: ToolsProvider = async (ctl) => {
  const cfg = ctl.getPluginConfig(pluginConfigSchematics);

  const getToken = () => cfg.get("hfApiToken").trim();
  const getModel = () => cfg.get("defaultModel").trim() || "black-forest-labs/FLUX.1-schnell";
  const getOutputDir = () => resolvePath(cfg.get("outputDirectory").trim() || "~/hf-images");
  const getRateLimitConfig = () => ({
    cooldownMs: Number(cfg.get("rateLimitCooldown")) || 5000,
    dailyCap: Number(cfg.get("rateLimitDailyCap")) || 50,
  });

  let isGenerating = false;

  const tools: Tool[] = [

    tool({
      name: "generate_image",
      description: text`
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
        prompt: z.string().min(1).describe(
          "Text description of the image. Be specific — subject, style, lighting, mood, quality terms."
        ),
        model_id: z.string().default("").describe(
          "HuggingFace model ID override (e.g. 'stabilityai/stable-diffusion-xl-base-1.0'). " +
          "Leave blank to use the default model from plugin config."
        ),
        negative_prompt: z.string().default("").describe(
          "What to exclude from the image (e.g. 'blurry, low quality, text, watermark'). " +
          "Not all models support this."
        ),
        lora_id: z.string().default("").describe(
          "HuggingFace model ID of a LoRA adapter to apply (e.g. 'alvdansen/flux-koda'). " +
          "Only compatible with FLUX base models. Use list_loras to discover available LoRAs."
        ),
        lora_scale: z.number().min(0).max(2).default(1.0).describe(
          "Strength of the LoRA adapter. 0.5–1.0 is typical; higher = stronger effect."
        ),
      },
      implementation: safe_impl("generate_image", async ({ prompt, model_id, negative_prompt, lora_id, lora_scale }, ctx) => {
        ctx.status("Generating image…");
        const token = getToken();
        if (!token) {
          throw new Error(
            "HuggingFace API token is not set. " +
            "Go to plugin settings and paste your token from huggingface.co/settings/tokens."
          );
        }

        const rateLimitResult = checkRateLimit(getRateLimitConfig());
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

          await mkdir(outputDir, { recursive: true });

          const hf = new InferenceClient(token);

          const parameters: Record<string, unknown> = {};
          if (cleanNegative) parameters.negative_prompt = cleanNegative;
          if (cleanLora) parameters.loras = [{ path: cleanLora, scale: lora_scale }];

          ctx.status(`Calling ${modelToUse}…`);
          const blob = await hf.textToImage({
            provider: cleanLora ? "fal-ai" : "auto",
            model: modelToUse,
            inputs: prompt,
            parameters,
          }) as unknown as Blob;

          const mimeType = blob.type || "image/png";
          const ext: "png" | "jpeg" = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpeg" : "png";
          const filename = timestampedFilename(ext);
          const filePath = path.join(outputDir, filename);

          const buffer = Buffer.from(await blob.arrayBuffer());
          await writeFile(filePath, buffer);

          recordGeneration();
          const remaining = checkRateLimit(getRateLimitConfig());
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
        } finally {
          isGenerating = false;
        }
      }),
    }),

    tool({
      name: "list_models",
      description: text`
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
        source: z.enum(["curated", "provider", "trending", "downloads"])
          .default("curated")
          .describe("Which model list to return. Default: curated (expert-verified models)."),
        provider: z.string()
          .default("")
          .describe(
            "Inference provider name (required when source='provider'). " +
            "Examples: fal-ai, nscale, replicate, wavespeed."
          ),
        limit: z.number()
          .min(5)
          .max(50)
          .default(20)
          .describe("Maximum number of models to return (only for provider/trending/downloads)."),
        include_loras: z.boolean()
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
            models = getCuratedModels();
            break;
          case "provider":
            if (!provider.trim()) {
              throw new Error(
                "provider parameter is required when source='provider'. " +
                "Examples: fal-ai, nscale, replicate."
              );
            }
            models = await getProviderModels(provider.trim(), limit, token || undefined);
            break;
          case "trending":
            models = await getTrendingModels(limit, token || undefined);
            break;
          case "downloads":
            models = await getDownloadedModels(limit, token || undefined);
            break;
          default:
            models = getCuratedModels();
        }

        const LORA_CAP = 10;
        let loraTruncated = false;
        if (include_loras && models.length > 0) {
          const targets = models.slice(0, LORA_CAP);
          loraTruncated = models.length > LORA_CAP;
          ctx.status(`Loading compatible LoRAs for ${targets.length} models...`);
          for (const model of targets) {
            try {
              const loras = await getDefaultLoRAs(model.id, 5, token || undefined);
              model.compatible_loras = loras;
              model.compatible_loras_count = loras.length;
            } catch {
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

    tool({
      name: "list_loras",
      description: text`
        Search HuggingFace for LoRA adapters.

        IMPORTANT: Avoid using the 'search' keyword filter! It often returns zero results because HuggingFace search is very strict.
        Instead, use only 'base_model' to find all compatible LoRAs, then pick from the results.
        Only use 'search' as a last resort with a very broad term (e.g. 'anime') if the result list is too large to browse.

        Use 'base_model' to find LoRAs compatible with a specific model.
        The base_model should be a model ID from list_models (e.g. 'black-forest-labs/FLUX.1-dev').
      `,
      parameters: {
        base_model: z.string()
          .default("")
          .describe(
            "Filter LoRAs by compatible base model. " +
              "Use model IDs from list_models (e.g. 'black-forest-labs/FLUX.1-dev', " +
              "'stabilityai/stable-diffusion-xl-base-1.0'). " +
              "Leave blank to search all LoRAs."
          ),
        search: z.string()
          .default("")
          .describe(
            "AVOID using this — HuggingFace search is strict and often returns no results. " +
              "Only use as a last resort with a broad keyword (e.g. 'anime'). " +
              "Prefer using only base_model."
          ),
        limit: z.number()
          .min(5)
          .max(30)
          .default(15)
          .describe("Maximum number of results to return."),
      },
      implementation: safe_impl("list_loras", async ({ base_model, search, limit }, ctx) => {
        const token = getToken();
        const cleanBaseModel = base_model.trim();
        const cleanSearch = search.trim();

        ctx.status(
          cleanBaseModel
            ? `Finding LoRAs for ${cleanBaseModel}...`
            : "Searching LoRAs..."
        );

        const results = await getLoRAsForModel(
          cleanBaseModel,
          cleanSearch,
          limit,
          token || undefined
        );

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

    tool({
      name: "inclination_prompt_list",
      description: text`
        List all available Neigungsprompts / ImageGen Stimmungsprompts (profile set) – einheitlicher Prefix inclination_prompt_.

        Returns curated examples (read-only, source=curated) + user config (source=config, in plugin settings editable, per entry [ro]/[rw] switchable) + LLM-created (source=user).
        Each entry has id (short name), description (first line), prompt (indirect style/mood), source, readonly flag.
        Curated are only examples (few, not exhaustive) – main library is user config.

        Use this to discover available moods before calling inclination_prompt_set.
        The active profile is highlighted and also injected into the LLM system context to guide generate_image prompt creation.
        Hinweis: list ist auch via inclination_prompt_manage({action:"list"}) verfügbar (vereinheitlicht).
      `,
      parameters: {
        filter: z.string().default("").describe("Optional substring to filter by id or description. Leave blank for all."),
      },
      implementation: safe_impl("inclination_prompt_list", async ({ filter }, _ctx) => {
        const text_ = "";
        const all = getAllDirectives(text_);
        const activeId = getActiveId();
        const active = getActiveDirective(text_);
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
          note: "Use inclination_prompt_set({name}) to activate. Curated=read-only examples, user=via inclination_prompt_manage.",
          config_hint: "Eigene Prompts via inclination_prompt_manage(action:create). Aktivierung via inclination_prompt_set.",
        });
      }),
    }),

    tool({
      name: "inclination_prompt_set",
      description: text`
        Activate or clear the Neigungsprompt (Stimmungsprompt / Beeinflussungsprompt, synonym) for indirect prompt guidance – einheitlicher Prefix inclination_prompt_.

        Manages the whole profile set by simple name. The active prompt is injected as system context
        and guides the Tool LLM to create stylistically aligned generate_image prompts (Mood, Kunststil, Ausrichtung, Inszenierung).

        - Pass a name from inclination_prompt_list to activate (e.g. "pose-action", "interaction").
        - Pass empty string or "none"/"clear" to deactivate.
        Use inclination_prompt_list first to discover available profiles.
      `,
      parameters: {
        name: z.string().describe("Profile id to activate (e.g. 'pose-action'). Use '' or 'none' to clear/deactivate."),
      },
      implementation: safe_impl("inclination_prompt_set", async ({ name }, _ctx) => {
        const text_ = "";
        const clean = name.trim().toLowerCase();
        if (!clean || clean === "none" || clean === "clear") {
          setActiveDirective(null, text_);
          return json({
            success: true,
            active_id: null,
            active_directive: null,
            message: "Neigungsprompt deaktiviert. generate_image nutzt wieder neutralen Stil.",
          });
        }
        const activated = setActiveDirective(clean, text_);
        return json({
          success: true,
          active_id: activated!.id,
          active_directive: activated,
          message: `Aktiviert: ${activated!.id} — ${activated!.description}. Wird jetzt indirekt bei generate_image berücksichtigt.`,
        });
      }),
    }),

    tool({
      name: "inclination_prompt_manage",
      description: text`
        Create, update, delete, get, or list Neigungsprompts (Stimmungsprompts / Beeinflussungsprompts, synonym) – einheitlicher Prefix inclination_prompt_, LLM-managed, persisted in tmp/directives.json (projektlokal). Vereinheitlicht list+manage via action:"list".

        Curated (source=curated) are examples only, always read-only.
        User (source=user) profiles are fully manageable here.

        Typical workflow: User provides one or more prompt texts, LLM creates entries with fitting name/description/prompt via action:"create", then activates via inclination_prompt_set.
      `,
      parameters: {
        action: z.enum(["create", "update", "delete", "get", "list"]).describe("Action to perform. Use list to list all (unified with inclination_prompt_list)."),
        name: z.string().default("").describe("Profile id (a-z,0-9,-,_). Required for create/update/delete/get, optional for list (ignored)."),
        description: z.string().default("").describe("Kurzbeschreibung (Zeile 1). Required for create, optional for update."),
        prompt: z.string().default("").describe("Neigungsprompt (indirekter Style/Mood, nicht direkter Bildinhalt). Required for create, optional for update."),
        filter: z.string().default("").describe("Optional filter for list (substring of id/description). Only for action list."),
      },
      implementation: safe_impl("inclination_prompt_manage", async ({ action, name, description, prompt, filter }, _ctx) => {
        const text_ = "";

        if (action === "list") {
          const all = getAllDirectives(text_);
          const activeId = getActiveId();
          const active = getActiveDirective(text_);
          const f = (filter as string).trim().toLowerCase();
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

        const cleanName = (name as string).trim().toLowerCase();
        if (!cleanName) throw new Error("name is required for create/update/delete/get.");

        switch (action) {
          case "create": {
            if (!description.trim()) throw new Error("description is required for create.");
            if (!prompt.trim()) throw new Error("prompt is required for create.");
            const created = createDirective(cleanName, description, prompt, text_);
            return json({ success: true, action, directive: created, message: `Erstellt: ${created.id}. Aktiviere mit inclination_prompt_set({name:"${created.id}"}).` });
          }
          case "update": {
            const hasDesc = description.trim().length > 0;
            const hasPrompt = prompt.trim().length > 0;
            if (!hasDesc && !hasPrompt) throw new Error("For update, provide at least description or prompt.");
            const updated = updateDirective(cleanName, hasDesc ? description : undefined, hasPrompt ? prompt : undefined, text_);
            return json({ success: true, action, directive: updated, message: `Aktualisiert: ${updated.id}.` });
          }
          case "delete": {
            deleteDirective(cleanName, text_);
            return json({ success: true, action, deleted_id: cleanName, message: `Gelöscht: ${cleanName}.` });
          }
          case "get": {
            const found = getDirectiveById(cleanName, text_);
            if (!found) throw new Error(`Profil "${cleanName}" nicht gefunden.`);
            const activeId = getActiveId();
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
