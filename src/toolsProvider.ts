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
  getPollinationsModels,
  buildPollinationsUrl,
  POLLINATIONS_DEFAULT_MODEL,
  POLLINATIONS_ANON_COOLDOWN_MS,
} from "./pollinations";
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
  const getPollinationsKey = () => {
    try {
      return (cfg.get("pollinationsApiKey") as unknown as string)?.trim() ?? "";
    } catch {
      return "";
    }
  };
  const getModel = () => cfg.get("defaultModel").trim() || "black-forest-labs/FLUX.1-dev";
  const getOutputDir = () => resolvePath(cfg.get("outputDirectory").trim() || "~/hf-images");
  const getRateLimitConfig = () => ({
    cooldownMs: Number(cfg.get("rateLimitCooldown")) || 5000,
    dailyCap: Number(cfg.get("rateLimitDailyCap")) || 50,
  });

  let isGenerating = false;
  let lastPollinationsCall = 0;

  const tools: Tool[] = [

    tool({
      name: "generate_image",
      description: text`
        Generate an image from a text prompt. Saves the image to disk and returns the file path.

        Use when the user asks to generate, create, draw, paint, or visualize something.

        Backends (parameter 'backend') — where the image is generated:
        - "hf" (default): HuggingFace Inference Providers. Requires the HF API token from plugin config.
          Models are HuggingFace IDs — browse them with list_models sources
          curated/provider/trending/downloads. LoRAs: pass lora_id (uses the fal-ai
          sub-provider); browse them with list_loras. Notes: some models need a license
          accepted at huggingface.co (e.g. FLUX.2-dev); cold models may take 20-60s to warm up.
        - "pollinations": Pollinations.ai. No token needed (optional pollinationsApiKey in config
          for higher limits + no watermark). Content filter is off by default.
          Models are Pollinations IDs — browse them with list_models source='pollinations'.
          Blank model_id = 'klein'. No negative_prompt (ignored), no lora_id (rejected with error).
          Anonymous tier ~1 request/15s. Free images may carry a watermark.
      `,
      parameters: {
        prompt: z.string().min(1).describe(
          "Text description of the image. Be specific — subject, style, lighting, mood, quality terms."
        ),
        model_id: z.string().default("").describe(
          "Model override. For backend='hf': HuggingFace model ID (e.g. 'stabilityai/stable-diffusion-xl-base-1.0'), " +
          "blank = default from plugin config. For backend='pollinations': Pollinations model " +
          "(e.g. 'klein', 'kontext'), blank = 'klein'."
        ),
        backend: z.enum(["hf", "pollinations"]).default("hf").describe(
          "Image backend: 'hf' (HuggingFace, needs token) or 'pollinations' (no token, filter off by default)."
        ),
        negative_prompt: z.string().default("").describe(
          "What to exclude from the image (e.g. 'blurry, low quality, text, watermark'). " +
          "HF only — ignored with backend='pollinations'."
        ),
        lora_id: z.string().default("").describe(
          "HuggingFace model ID of a LoRA adapter to apply (e.g. 'alvdansen/flux-koda'). " +
          "HF backend + FLUX base models only. Use list_loras to discover available LoRAs."
        ),
        lora_scale: z.number().min(0).max(2).default(1.0).describe(
          "Strength of the LoRA adapter. 0.5–1.0 is typical; higher = stronger effect."
        ),
      },
      implementation: safe_impl("generate_image", async ({ prompt, model_id, backend, negative_prompt, lora_id, lora_scale }, ctx) => {
        ctx.status("Generating image…");
        const usePollinations = backend === "pollinations";
        const cleanLora = lora_id.trim();

        if (!usePollinations) {
          const token = getToken();
          if (!token) {
            throw new Error(
              "HuggingFace API token is not set. " +
              "Go to plugin settings and paste your token from huggingface.co/settings/tokens. " +
              "Alternatively use backend='pollinations' which needs no token."
            );
          }
        }
        if (usePollinations && cleanLora) {
          throw new Error(
            "lora_id is not supported with backend='pollinations'. " +
            "Use backend='hf' with a FLUX base model for LoRAs."
          );
        }

        const rateLimitResult = checkRateLimit(getRateLimitConfig());
        if (!rateLimitResult.ok) {
          throw new Error(rateLimitResult.error);
        }
        if (usePollinations) {
          // Anonymous: 1 req/15s; with key (Seed tier): 1 req/5s.
          const pollinationsCooldownMs = getPollinationsKey() ? 5_000 : POLLINATIONS_ANON_COOLDOWN_MS;
          const waited = Date.now() - lastPollinationsCall;
          if (waited < pollinationsCooldownMs) {
            throw new Error(
              `Pollinations allows ~1 request per ${pollinationsCooldownMs / 1000}s on your tier. ` +
              `Wait ${Math.ceil((pollinationsCooldownMs - waited) / 1000)}s and retry.`
            );
          }
        }

        if (isGenerating) {
          throw new Error("Another generation is already in progress. Wait for it to finish.");
        }
        isGenerating = true;

        try {
          const cleanNegative = negative_prompt.trim();
          const outputDir = getOutputDir();

          await mkdir(outputDir, { recursive: true });

          let buffer: Buffer;
          let mimeType: string;
          let modelToUse: string;
          const notes: string[] = [];

          if (usePollinations) {
            modelToUse = model_id.trim() || POLLINATIONS_DEFAULT_MODEL;
            if (cleanNegative) {
              notes.push("negative_prompt is not supported by Pollinations and was ignored.");
            }
            const pollinationsKey = getPollinationsKey();
            const url = buildPollinationsUrl({ prompt, model: modelToUse, apiKey: pollinationsKey || undefined });
            ctx.status(`Calling Pollinations (${modelToUse})…`);
            const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
            if (!res.ok) {
              throw new Error(`Pollinations error: ${res.status} ${res.statusText}`);
            }
            buffer = Buffer.from(await res.arrayBuffer());
            mimeType = res.headers.get("content-type") || "image/jpeg";
            if (!mimeType.startsWith("image/")) {
              const preview = buffer.toString("utf-8").slice(0, 200);
              throw new Error(`Pollinations returned non-image content (${mimeType}): ${preview}`);
            }
            lastPollinationsCall = Date.now();
            notes.push(
              pollinationsKey
                ? "Pollinations with API key: no watermark (nologo), private=true keeps it out of the public feed."
                : "Pollinations anonymous: image may carry a watermark; private=true keeps it out of the public feed. Set pollinationsApiKey in plugin config for higher limits + no watermark."
            );
          } else {
            const token = getToken();
            modelToUse = model_id.trim() || getModel();
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

            mimeType = blob.type || "image/png";
            buffer = Buffer.from(await blob.arrayBuffer());
          }

          const ext: "png" | "jpeg" = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpeg" : "png";
          const filename = timestampedFilename(ext);
          const filePath = path.join(outputDir, filename);

          await writeFile(filePath, buffer);

          recordGeneration();
          const remaining = checkRateLimit(getRateLimitConfig());
          const remainingCount = remaining.ok ? remaining.remaining : 0;

          return json({
            success: true,
            file_path: filePath,
            filename,
            backend: usePollinations ? "pollinations" : "hf",
            model_used: modelToUse,
            lora_used: cleanLora || null,
            lora_scale: cleanLora ? lora_scale : null,
            prompt,
            negative_prompt: cleanNegative || null,
            file_size_bytes: buffer.length,
            mime_type: mimeType,
            generations_remaining_today: remainingCount,
            notes: notes.length > 0 ? notes : undefined,
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
        Browse text-to-image models per backend.

        Sources (parameter 'source') — which catalog to list:
        - "curated" (default): expert-verified HuggingFace IDs for generate_image backend='hf',
          with descriptions and LoRA compatibility info.
        - "provider": HuggingFace IDs served by one inference sub-provider (needs 'provider',
          e.g. fal-ai, nscale) — for backend='hf'.
        - "trending" / "downloads": live HuggingFace catalog — for backend='hf'.
        - "pollinations": Pollinations.ai models (no token needed, filter off by default) —
          for generate_image backend='pollinations'.

        Rule of thumb: IDs from curated/provider/trending/downloads only work with
        generate_image backend='hf'; IDs from source='pollinations' only with
        backend='pollinations'. LoRA lookup (include_loras) and the list_loras tool are HF-only.
      `,
      parameters: {
        source: z.enum(["curated", "provider", "trending", "downloads", "pollinations"])
          .default("curated")
          .describe("Which catalog to list. Default: curated (expert-verified HuggingFace IDs for backend='hf')."),
        provider: z.string()
          .default("")
          .describe(
            "HF inference sub-provider (required when source='provider'). " +
            "Examples: fal-ai, nscale, replicate, wavespeed."
          ),
        limit: z.number()
          .min(5)
          .max(50)
          .default(20)
          .describe("Maximum number of models (only for provider/trending/downloads; ignored for curated/pollinations)."),
        include_loras: z.boolean()
          .default(false)
          .describe("Include compatible LoRAs per model (HF sources only, skipped for source='pollinations'; slower, needs API calls)."),
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
          case "pollinations":
            models = getPollinationsModels();
            break;
          default:
            models = getCuratedModels();
        }

        const LORA_CAP = 10;
        let loraTruncated = false;
        // LoRA lookup is HF-only: Pollinations models have no HF LoRA ecosystem.
        if (include_loras && models.length > 0 && source !== "pollinations") {
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
          ...(source === "pollinations"
            ? { pollinations_default_model: POLLINATIONS_DEFAULT_MODEL }
            : {}),
          models: models.map((m) => ({
            ...m,
            is_default: m.id === currentDefault,
          })),
          note: loraTruncated
            ? `LoRA lookup capped to first ${LORA_CAP} models to avoid API flood. Use list_loras with base_model for others.`
            : source === "curated"
              ? "Expert-verified HuggingFace IDs for generate_image backend='hf'. Use list_loras with base_model to find compatible LoRAs."
              : source === "pollinations"
                ? "Pollinations IDs for generate_image backend='pollinations', no token needed. Snapshot Sep 2026; canonical IDs preferred, aliases (klein, flux, kontext) also work. No LoRAs on this backend."
                : "HuggingFace IDs for generate_image backend='hf'. Pass model_id to generate_image to use a model.",
        });
      }),
    }),

    tool({
      name: "list_loras",
      description: text`
        Search HuggingFace for LoRA adapters (HF backend only — Pollinations models have no LoRA support).

        IMPORTANT: Avoid using the 'search' keyword filter! It often returns zero results because HuggingFace search is very strict.
        Instead, use only 'base_model' to find all compatible LoRAs, then pick from the results.
        Only use 'search' as a last resort with a very broad term (e.g. 'anime') if the result list is too large to browse.

        Use 'base_model' to find LoRAs compatible with a specific model.
        The base_model should be a model ID from list_models (e.g. 
'black-forest-labs/FLUX.2-dev').
      `,
      parameters: {
        base_model: z.string()
          .default("")
          .describe(
            "Filter LoRAs by compatible base model. " +
              "Use model IDs from list_models (e.g. 'black-forest-labs/FLUX.2-dev', " +
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
