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
import { getCuratedEditModels } from "./curatedModels";
import { checkRateLimit, recordGeneration } from "./rateLimit";
import { resolveImageInput } from "./imageInput";
import { listOutputImages } from "./workspace";
import {
  getPollinationsModels,
  buildPollinationsPostBody,
  buildPollinationsEditForm,
  detectImageMime,
  POLLINATIONS_DEFAULT_MODEL,
  POLLINATIONS_DEFAULT_EDIT_MODEL,
} from "./pollinations";
import { getAllCosts, getCacheInfo } from "./costCache";
import { getModelCacheInfo } from "./modelCache";
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

function timestampedFilename(ext: "png" | "jpeg" | "webp", prefix: "hf" | "pl" = "hf"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `${prefix}-${ts}.${ext}`;
}

async function saveImageBuffer(
  buffer: Buffer,
  mimeType: string,
  outputDir: string,
  prefix: "hf" | "pl" = "hf"
): Promise<{ filePath: string; filename: string }> {
  const ext: "png" | "jpeg" | "webp" =
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpeg"
    : mimeType.includes("webp") ? "webp"
    : "png";
  const filename = timestampedFilename(ext, prefix);
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, buffer);
  return { filePath, filename };
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
  const getEditModel = () =>
    cfg.get("defaultEditModel").trim() || "black-forest-labs/FLUX.2-dev";
  const getOutputDir = () => resolvePath(cfg.get("outputDirectory").trim() || "~/hf-images");
  const getRateLimitConfig = () => ({
    cooldownMs: Number(cfg.get("rateLimitCooldown")) || 5000,
    dailyCap: Number(cfg.get("rateLimitDailyCap")) || 75,
  });
  // Config-Schalter für das Neigungsprompt-Subsystem (default an).
  const inclinationsEnabled = cfg.get("enableInclinationPrompts") !== false;

  let isGenerating = false;
  let lastPollinationsCall = 0;

  const tools: Tool[] = [

    tool({
      name: "generate_image",
      description: text`
        Generate an image from a text prompt. Saves the image to disk and returns the file path.

        Use when the user asks to generate, create, draw, paint, or visualize something.
        To edit an existing image instead, use image_edit.

        Backends (parameter 'backend'):
        - "hf" (default): HuggingFace Inference Providers. Requires HF API token from config.
          Models are HuggingFace IDs — browse with list_models (source curated/provider/trending/downloads).
          LoRAs: pass lora_id (fal-ai sub-provider); browse with list_loras.
          BEST QUALITY for complex/detailed prompts — recommended for production.
        - "pollinations": Pollinations.ai — requires pollinationsApiKey in config.
          Uses gen.pollinations.ai API. Browse models with list_models source='pollinations'.

        MODEL IDS for pollinations backend:
        • Use FULL canonical IDs (e.g. "black-forest-labs/flux.1-schnell").
        • Valid short aliases: "flux" (= flux.1-schnell), "kontext" (= flux.1-kontext-pro),
          "seedream5" (= seedream-5.0-lite). ALL OTHER IDs MUST BE FULL FORM.
        • Blank model_id defaults to "black-forest-labs/flux.1-schnell".

        PARAMETERS:
        • prompt: descriptive text — subject, style, lighting, mood, quality terms.
        • width/height: pollinations only. POST needs BOTH (a single dimension is ignored).
        • seed: POST never sends seed — any seed value is ignored (note in result).
        • quality: only for gptimage/grok-imagine-image-2.0 family; ignored otherwise.
        • negative_prompt: HF only, ignored with pollinations.
        • lora_id: HF only, rejected with error on pollinations.

        FILES: saved under plugin output directory (config 'Output Directory'). Use the returned
        absolute file_path when handing the image to other tools — do NOT strip to bare filename.
        Find results via list_output_images. quota.remaining counts plugin daily limit, not HF credits.
      `,
      parameters: {
        prompt: z.string().min(1).describe(
          "Text description of the image. Be specific — subject, style, lighting, mood, quality terms."
        ),
        model_id: z.string().default("").describe(
          "Model override. For backend='hf': HuggingFace model ID (e.g. 'stabilityai/stable-diffusion-xl-base-1.0'), " +
          "blank = default from plugin config. For backend='pollinations': full Pollinations model ID " +
          "(e.g. 'black-forest-labs/flux.1-schnell', 'black-forest-labs/flux.1-kontext-pro'), " +
          "blank = 'black-forest-labs/flux.1-schnell'."
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
        width: z.number().int().min(0).max(2048).default(0).describe(
          "Output width in pixels (backend='pollinations' only, ignored with backend='hf'). " +
          "0 = backend default. Portrait e.g. 768 with height 1152 for fashion editorial."
        ),
        height: z.number().int().min(0).max(2048).default(0).describe(
          "Output height in pixels (backend='pollinations' only, ignored with backend='hf'). " +
          "0 = backend default."
        ),
        seed: z.number().int().min(0).default(0).describe(
          "Seed (backend='pollinations' only, ignored with backend='hf'). " +
          "0 = random. POST /v1/images/generations does not accept seed — any value is ignored (note in result)."
        ),
        quality: z.enum(["low", "medium", "high", "hd"]).optional().describe(
          "Image quality (backend='pollinations' only, ignored with backend='hf'). " +
          "Blank or unset = medium (server default). " +
          "Only documented for gpt-image and grok-imagine models; for other models it is ignored and a note is added to the result."
        ),
      },
      implementation: safe_impl("generate_image", async ({ prompt, model_id, backend, negative_prompt, lora_id, lora_scale, width, height, seed, quality }, ctx) => {
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
        const pollinationsKey = usePollinations ? getPollinationsKey() : "";
        if (usePollinations && !pollinationsKey) {
          throw new Error(
            "Pollinations API key is not set (required since Sep 2026). " +
            "Set pollinationsApiKey in plugin config (get one at https://enter.pollinations.ai/keys) " +
            "or use backend='hf'."
          );
        }
        if (usePollinations) {
          // Key ist oben garantiert: ~1 Request pro 5s (Seed tier).
          const pollinationsCooldownMs = 5_000;
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

            // POST /v1/images/generations mit Bearer-Auth (einziger Pfad: anonymer
            // Zugang wurde Sep 2026 entfernt, Key ist oben garantiert).
            // Hinweis: seed ist im POST-Schema nicht dokumentiert und wird nicht gesendet;
            // quality nur bei Modellen mit dokumentiertem Support (gpt-image/grok-imagine).
            const { url, headers, body, qualityDropped } = buildPollinationsPostBody({
              prompt,
              model: modelToUse,
              width: width || undefined,
              height: height || undefined,
              quality,
              apiKey: pollinationsKey,
            });
            if (seed) {
              notes.push("seed is not sent by POST /v1/images/generations and was ignored.");
            }
            if (qualityDropped) {
              notes.push(`quality='${quality}' is only documented for gpt-image and grok-imagine models and was ignored for '${modelToUse}'.`);
            }
            if ((width && !height) || (!width && height)) {
              notes.push("POST size needs width AND height (WIDTHxHEIGHT); a single dimension was ignored. Use both for exact size.");
            }
            ctx.status(`Calling Pollinations API (${modelToUse}, quality=${quality ?? "medium"}, auth=key)…`);
            const res = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(180_000),
            });
            if (!res.ok) {
              const errText = await res.text().catch(() => "");
              if (res.status === 401) {
                throw new Error("Pollinations API error: 401 Unauthorized — invalid or expired key. Check pollinationsApiKey in plugin config (get one at https://enter.pollinations.ai/keys).");
              }
              if (res.status === 402 || res.status === 403) {
                throw new Error(`Pollinations API error: ${res.status} ${res.statusText} ${errText} — paid_only model or exhausted Pollen budget? Check key balance / use a free model.`);
              }
              throw new Error(`Pollinations API error: ${res.status} ${res.statusText} ${errText}`);
            }
            const jsonRes = await res.json() as { data?: { b64_json?: string }[] };
            if (!jsonRes.data?.[0]?.b64_json) {
              throw new Error("Pollinations API returned no image data");
            }
            buffer = Buffer.from(jsonRes.data[0].b64_json, "base64");
            mimeType = detectImageMime(buffer);
            if (!mimeType.startsWith("image/")) {
              const preview = buffer.toString("utf-8").slice(0, 200);
              throw new Error(`Pollinations returned non-image content (${mimeType}): ${preview}`);
            }
            notes.push("Pollinations API (gen.pollinations.ai POST): safe=false, private (hidden from public feed), no watermark with key. Credit consumed.");
            lastPollinationsCall = Date.now();
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

          const { filePath, filename } = await saveImageBuffer(buffer, mimeType, outputDir, usePollinations ? "pl" : "hf");

          recordGeneration();
          const quota = checkRateLimit(getRateLimitConfig());

          return json({
            success: true,
            file_path: filePath,
            filename,
            output_dir: outputDir,
            backend: usePollinations ? "pollinations" : "hf",
            model_used: modelToUse,
            lora_used: cleanLora || null,
            lora_scale: cleanLora ? lora_scale : null,
            prompt,
            negative_prompt: cleanNegative || null,
            file_size_bytes: buffer.length,
            mime_type: mimeType,
            quota: {
              guard: "plugin daily limit (config), not HF credits",
              limit: quota.limit,
              used: quota.used,
              remaining: quota.remaining,
              resets_in_hours: quota.resetInHours,
            },
            notes: notes.length > 0 ? notes : undefined,
            message: `Image saved to ${filePath}${quota.remaining === 0 ? " — daily generation quota reached; next generation is blocked until local midnight." : ""}`,
          });
        } finally {
          isGenerating = false;
        }
      }),
    }),

    tool({
      name: "image_edit",
      description: text`
        Edit an existing image (image-to-image). Backends: hf or pollinations.

        Use when the user provides a reference image plus a change instruction
        (e.g. a generated portrait + "same pose, latex dress instead of silk").
        Reference image = KEEP, prompt = CHANGE — mirrors the Neigungsprompt gates:
        pose/composition stay, the instruction transforms material, light, or details.

        Backends (parameter 'backend'):
        - "hf" (default): HuggingFace Inference Providers, needs HF API token.
          Editing-native models ONLY — base T2I models (FLUX.1-dev, SDXL, Qwen-Image)
          have NO image-to-image provider mapping and fail. Working models:
          - "black-forest-labs/FLUX.2-dev" (default): instruction editing, fal-ai/replicate
          - "black-forest-labs/FLUX.1-Kontext-dev": instruction editing, fal-ai/replicate/wavespeed
          - "Qwen/Qwen-Image-Edit": precise edits, fal-ai/replicate/wavespeed
          Browse with list_models source='image-edit'.
        - "pollinations": Pollinations.ai POST /v1/images/edits, needs pollinationsApiKey.
          Blank model_id defaults to "x-ai/grok-imagine-image-quality" (alias "aurora") —
          deliberately non-restrictive (strict filters on kontext/seedream flag fashion-editorial
          and burn credits on failed edits). Other edit-capable IDs with /v1/images/edits:
          x-ai/grok-imagine-image (cheaper), black-forest-labs/flux.1-kontext-pro (STRICT),
          flux.2-*, gpt-image-2*, seedream-5*.
          Browse with list_models source='pollinations'.

        The 'image' parameter accepts a local file path (also from earlier generate_image
        results) or a public image URL. To generate from scratch, use generate_image instead.
        An active Neigungsprompt guides how the change is formulated, same as generate_image.
        Optional lora_id/negative_prompt/provider: HF backend only (rejected or ignored
        with pollinations).

        FILES: the edited image is saved under the plugin output directory (config
        'Output Directory', returned as output_dir). Use the returned absolute file_path when
        handing the image to other tools — do NOT strip it to a bare filename. Find results via
        list_output_images. quota.remaining counts the plugin's own daily limit, not HF credits.
      `,
      parameters: {
        image: z.string().min(1).describe(
          "Reference image: local file path, bare filename (looked up in the output directory first), " +
          "or public http(s) URL."
        ),
        prompt: z.string().min(1).describe(
          "CHANGE instruction: what to transform (subject, garment, material, light, mood). " +
          "Be specific — everything not mentioned tends to stay as in the reference."
        ),
        backend: z.enum(["hf", "pollinations"]).default("hf").describe(
          "Edit backend: 'hf' (HuggingFace, needs token) or 'pollinations' " +
          "(needs pollinationsApiKey; uses POST /v1/images/edits)."
        ),
        model_id: z.string().default("").describe(
          "Model override. backend='hf': editing-native HF ID, blank = defaultEditModel " +
          "('black-forest-labs/FLUX.2-dev'); alternatives 'black-forest-labs/FLUX.1-Kontext-dev', " +
          "'Qwen/Qwen-Image-Edit' (list_models source='image-edit'). " +
          "backend='pollinations': full ID or alias (e.g. 'x-ai/grok-imagine-image-quality', " +
          "'x-ai/grok-imagine-image', 'black-forest-labs/flux.1-kontext-pro'), " +
          "blank = 'x-ai/grok-imagine-image-quality' (few filters)."
        ),
        provider: z.string().default("auto").describe(
          "HF inference sub-provider (auto, fal-ai, replicate, wavespeed). " +
          "Default auto resolves via the model's image-to-image mapping. HF backend only — " +
          "ignored with backend='pollinations'."
        ),
        negative_prompt: z.string().default("").describe(
          "What to exclude from the image (e.g. 'blurry, low quality, text, watermark'). " +
          "HF only — ignored with backend='pollinations'."
        ),
        lora_id: z.string().default("").describe(
          "HuggingFace LoRA adapter ID (e.g. 'alvdansen/flux-koda'). HF backend + FLUX base " +
          "models only, passed through to fal-ai — rejected with backend='pollinations'."
        ),
        lora_scale: z.number().min(0).max(2).default(1.0).describe(
          "Strength of the LoRA adapter. 0.5–1.0 is typical; higher = stronger effect."
        ),
        quality: z.enum(["low", "medium", "high", "hd"]).optional().describe(
          "Image quality (backend='pollinations' only, ignored with backend='hf'). " +
          "Blank = medium (server default). Only documented for gpt-image/grok-imagine-image-2.0; " +
          "for other models it is ignored and a note is added to the result."
        ),
      },
      implementation: safe_impl("image_edit", async ({ image, prompt, backend, model_id, provider, negative_prompt, lora_id, lora_scale, quality }, ctx) => {
        ctx.status("Reading reference image…");
        const usePollinations = backend === "pollinations";
        const cleanLora = lora_id.trim();
        const cleanNegative = negative_prompt.trim();

        if (!usePollinations) {
          const token = getToken();
          if (!token) {
            throw new Error(
              "HuggingFace API token is not set. " +
              "Go to plugin settings and paste your token from huggingface.co/settings/tokens. " +
              "Alternatively use backend='pollinations' which needs no HF token."
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

        const pollinationsKey = usePollinations ? getPollinationsKey() : "";
        if (usePollinations) {
          if (!pollinationsKey) {
            throw new Error(
              "Pollinations API key is not set (required since Sep 2026). " +
              "Set pollinationsApiKey in plugin config (get one at https://enter.pollinations.ai/keys) " +
              "or use backend='hf'."
            );
          }
          // Key ist oben garantiert: ~1 Request pro 5s (gleicher Account/Rate-Limit wie generate_image).
          const pollinationsCooldownMs = 5_000;
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
          const outputDir = getOutputDir();
          const { buffer: inputBuffer, mimeType: inputMime, source: inputSource } =
            await resolveImageInput(image, [outputDir]);
          await mkdir(outputDir, { recursive: true });

           let outBuffer: Buffer;
           let mimeType: string;
           let modelToUse: string;
           const notes: string[] = [];

           if (quality !== undefined && !usePollinations) {
             notes.push("quality is only supported with backend='pollinations' and was ignored here.");
           }

           if (usePollinations) {
            modelToUse = model_id.trim() || POLLINATIONS_DEFAULT_EDIT_MODEL;
            if (cleanNegative) {
              notes.push("negative_prompt is not supported by Pollinations and was ignored.");
            }
            if (provider.trim() && provider.trim() !== "auto") {
              notes.push(`provider='${provider.trim()}' is HF-only and was ignored (backend='pollinations').`);
            }

            const { url, headers, form, qualityDropped } = buildPollinationsEditForm({
              prompt,
              model: modelToUse,
              imageBuffer: inputBuffer,
              imageMime: inputMime,
              apiKey: pollinationsKey,
              quality,
            });
            if (qualityDropped && quality) {
              notes.push(`quality='${quality}' is only documented for gpt-image/grok-imagine-image-2.0 models and was ignored for '${modelToUse}'.`);
            }

            ctx.status(`Editing with Pollinations (${modelToUse})…`);
            const res = await fetch(url, {
              method: "POST",
              headers,
              body: form,
              signal: AbortSignal.timeout(180_000),
            });
            if (!res.ok) {
              const errText = await res.text().catch(() => "");
              if (res.status === 401) {
                throw new Error("Pollinations API error: 401 Unauthorized — set pollinationsApiKey in plugin config.");
              }
              if (res.status === 402 || res.status === 403) {
                throw new Error(`Pollinations API error: ${res.status} ${res.statusText} ${errText} — paid_only model or exhausted Pollen budget? Check key balance / use a free model.`);
              }
              throw new Error(`Pollinations API error: ${res.status} ${res.statusText} ${errText}`);
            }

            // Antwort: JSON mit data[0].b64_json ODER data[0].url (ggf. nachladen).
            const contentType = (res.headers.get("content-type") || "").toLowerCase();
            if (contentType.includes("application/json")) {
              const jsonRes = await res.json() as {
                data?: { b64_json?: string; url?: string }[];
              };
              const item = jsonRes.data?.[0];
              if (item?.b64_json) {
                outBuffer = Buffer.from(item.b64_json, "base64");
                mimeType = detectImageMime(outBuffer);
              } else if (item?.url) {
                const dl = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
                if (!dl.ok) {
                  throw new Error(`Pollinations returned an image URL but download failed: ${dl.status} ${dl.statusText}`);
                }
                outBuffer = Buffer.from(await dl.arrayBuffer());
                mimeType = detectImageMime(outBuffer);
              } else {
                throw new Error("Pollinations API returned no image data");
              }
            } else {
              outBuffer = Buffer.from(await res.arrayBuffer());
              mimeType = contentType.startsWith("image/") ? contentType.split(";")[0] : detectImageMime(outBuffer);
              if (!mimeType.startsWith("image/")) {
                const preview = outBuffer.toString("utf-8").slice(0, 200);
                throw new Error(`Pollinations returned non-image content (${mimeType}): ${preview}`);
              }
            }
            lastPollinationsCall = Date.now();
            notes.push("Pollinations API (gen.pollinations.ai POST /v1/images/edits): safe=false, private, no watermark with key. Credit consumed.");
          } else {
            const token = getToken();
            modelToUse = model_id.trim() || getEditModel();
            const providerToUse = (provider.trim() || "auto") as
              "auto" | "fal-ai" | "replicate" | "wavespeed" | "together" | "nscale";

            const hf = new InferenceClient(token);
            // Copy out of the Node buffer pool so TS accepts it as BlobPart.
            const inputBlob = new Blob([new Uint8Array(inputBuffer)], { type: inputMime });

            const parameters: Record<string, unknown> = {};
            if (cleanNegative) parameters.negative_prompt = cleanNegative;
            if (cleanLora) parameters.loras = [{ path: cleanLora, scale: lora_scale }];

            ctx.status(`Editing with ${modelToUse}…`);
            let blob: Blob;
            try {
              blob = await hf.imageToImage({
                provider: providerToUse,
                model: modelToUse,
                inputs: inputBlob,
                parameters: {
                  prompt,
                  ...parameters,
                },
              }) as unknown as Blob;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/not supported for task image-to-image/i.test(msg)) {
                throw new Error(
                  `${msg} — use an editing-native model instead: ` +
                  `'black-forest-labs/FLUX.2-dev' (default), 'black-forest-labs/FLUX.1-Kontext-dev' ` +
                  `or 'Qwen/Qwen-Image-Edit'. ` +
                  `Base text-to-image models (FLUX.1-dev, SDXL, Qwen-Image) have no image-to-image provider mapping.`
                );
              }
              throw err;
            }

            mimeType = blob.type || "image/png";
            outBuffer = Buffer.from(await blob.arrayBuffer());
          }

          const { filePath, filename } = await saveImageBuffer(outBuffer, mimeType, outputDir, usePollinations ? "pl" : "hf");

          recordGeneration();
          const quota = checkRateLimit(getRateLimitConfig());

          return json({
            success: true,
            file_path: filePath,
            filename,
            output_dir: outputDir,
            backend: usePollinations ? "pollinations" : "hf",
            model_used: modelToUse,
            input_image: image,
            input_source: inputSource,
            prompt,
            negative_prompt: cleanNegative || null,
            lora_used: cleanLora || null,
            lora_scale: cleanLora ? lora_scale : null,
            file_size_bytes: outBuffer.length,
            mime_type: mimeType,
            quota: {
              guard: "plugin daily limit (config), not HF credits",
              limit: quota.limit,
              used: quota.used,
              remaining: quota.remaining,
              resets_in_hours: quota.resetInHours,
            },
            notes: notes.length > 0 ? notes : undefined,
            message:
              `Edited image saved to ${filePath}` +
              (quota.remaining === 0
                ? " — daily generation quota reached; next generation is blocked until local midnight."
                : ""),
          });
        } finally {
          isGenerating = false;
        }
      }),
    }),

    tool({
      name: "list_output_images",
      description: text`
        List images in the plugin output directory (where generate_image/image_edit save files).
        Paginated and compact — use it instead of reading a large directory at once.

        Use when the user asks which images exist, wants the latest result, or needs a
        file path as reference 'image' for image_edit (newest first by default, so
        limit=1 returns the latest image). Walk large folders page by page via offset.
        Scoped to the output directory only.
      `,
      parameters: {
        sort: z.enum(["newest", "oldest", "name"]).default("newest").describe(
          "Sort order. Default newest first (limit=1 gives the latest image)."
        ),
        limit: z.number().int().min(1).max(100).default(20).describe(
          "Entries per page (max 100)."
        ),
        offset: z.number().int().min(0).default(0).describe(
          "Skip this many entries for paging (e.g. 20 for page 2 with limit 20)."
        ),
        filter: z.string().default("").describe(
          "Substring filter on filenames (e.g. a date or keyword). Leave blank for all."
        ),
      },
      implementation: safe_impl("list_output_images", async ({ sort, limit, offset, filter }, ctx) => {
        const outputDir = getOutputDir();
        ctx.status("Listing output images…");
        const result = await listOutputImages(outputDir, { sort, limit, offset, filter });
        return json({
          output_directory: outputDir,
          ...result,
          has_more: result.offset + result.entries.length < result.total,
          usage: "Pass a 'filename' as image in image_edit (same directory).",
        });
      }),
    }),

    tool({
      name: "list_models",
      description: text`
        Browse text-to-image models per backend.

        Sources (parameter 'source') — which catalog to list:
        - "curated" (default): expert-verified HuggingFace IDs for generate_image backend='hf',
          with descriptions and LoRA compatibility info.
        - "image-edit": editing-native HuggingFace IDs with verified image-to-image mapping
          (FLUX.2-dev, Kontext-dev, Qwen-Image-Edit) — for the image_edit tool. Do NOT use
          text-to-image base models from the other sources here; they fail with "not supported for task".
        - "provider": HuggingFace IDs served by one inference sub-provider (needs 'provider',
          e.g. fal-ai, nscale) — for backend='hf'.
        - "trending" / "downloads": live HuggingFace catalog — for backend='hf'.
        - "pollinations": Pollinations.ai models (requires pollinationsApiKey in config).
          ALIASES: only "flux" (= flux.1-schnell), "kontext" (= flux.1-kontext-pro),
          "seedream5" (= seedream-5.0-lite). Use FULL IDs for all other models.

        Rule of thumb: IDs from curated/provider/trending/downloads only work with
        generate_image backend='hf'; IDs from source='pollinations' only with
        backend='pollinations'; IDs from source='image-edit' only with image_edit.
        LoRA lookup (include_loras) and the list_loras tool are HF-only.
        Model lists are cached for 12 hours to reduce API calls.
      `,
      parameters: {
        source: z.enum(["curated", "provider", "trending", "downloads", "pollinations", "image-edit"])
          .default("curated")
          .describe("Which catalog to list. Default: curated (expert-verified HuggingFace IDs for backend='hf'). Use 'image-edit' for image_edit models."),
        provider: z.string()
          .default("")
          .describe(
            "HF inference sub-provider (required when source='provider'). " +
            "Examples: fal-ai, nscale, replicate, wavespeed. " +
            "Not 'pollinations' — use source='pollinations' instead."
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
        const editDefault = getEditModel();

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
            if (provider.trim().toLowerCase() === "pollinations") {
              throw new Error(
                "provider='pollinations' is not a HuggingFace sub-provider. " +
                "Use source='pollinations' instead."
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
          case "image-edit":
            models = getCuratedEditModels();
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

        // Merge dynamic costs from cache (Pollinations API + HF hardcoded)
        const costMap = await getAllCosts();
        const cacheInfo = await getCacheInfo();
        const modelCacheInfo = getModelCacheInfo();

        return json({
          source,
          current_default_model: currentDefault,
          ...(source === "pollinations"
            ? { pollinations_default_model: POLLINATIONS_DEFAULT_MODEL }
            : {}),
          ...(source === "image-edit" ? { image_edit_default_model: editDefault } : {}),
          cost_cache: {
            fetched_at: cacheInfo.fetchedAt.toISOString(),
            expires_in_hours: Math.round(cacheInfo.expiresInMs / 3600000),
            models_priced: cacheInfo.modelCount,
          },
          model_cache: {
            provider: modelCacheInfo.provider,
            trending: modelCacheInfo.trending,
            downloads: modelCacheInfo.downloads,
            pollinations: modelCacheInfo.pollinations,
          },
          models: models.map((m) => ({
            ...m,
            cost: costMap[m.id]?.cost ?? m.cost,
            is_default: m.id === currentDefault,
          })),
          note: loraTruncated
            ? `LoRA lookup capped to first ${LORA_CAP} models to avoid API flood. Use list_loras with base_model for others.`
            : source === "curated"
              ? "Expert-verified HuggingFace IDs for generate_image backend='hf'. Use list_loras with base_model to find compatible LoRAs."
              : source === "pollinations"
                ? "Pollinations IDs for generate_image backend='pollinations' (requires pollinationsApiKey). " +
                  "Canonical IDs preferred, aliases (flux, kontext, seedream5) also work. " +
                  "Each model's 'cost' field is fetched live from the Pollinations API (12h cache). " +
                  "Use full IDs — only flux/kontext/seedream5 are valid aliases. No LoRAs on this backend."
                : source === "image-edit"
                  ? "Editing-native IDs for the image_edit tool (verified image-to-image mapping). image_edit_default_model applies here; current_default_model is the text-to-image default — do not use it for editing."
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
            ? `These LoRAs are compatible with ${cleanBaseModel}. Pass the 'id' field as lora_id in generate_image (backend='hf').`
            : "Pass the 'id' field as lora_id in generate_image (backend='hf'). Use base_model to filter for specific models.",
          note: "LoRA generation uses fal-ai provider. lora_scale default is 1.0; try 0.6–0.9 for subtle effects.",
        });
      }),
    }),

    tool({
      name: "inclination_prompt_list",
      description: text`
        List all available Neigungsprompts / ImageGen Stimmungsprompts (profile set) – einheitlicher Prefix inclination_prompt_.

        Returns curated examples (read-only, source=curated) + LLM-created profiles
        (source=user, manageable via inclination_prompt_manage).
        Each entry has id (short name), description (first line), prompt (indirect style/mood), source, readonly flag.
        Curated are only examples (few, not exhaustive) – main library is user-created via inclination_prompt_manage.

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
        Create, update, delete, get, or list Neigungsprompts (Stimmungsprompts / Beeinflussungsprompts, synonym) – einheitlicher Prefix inclination_prompt_, LLM-managed, persisted in the plugin storage (directives.json). Vereinheitlicht list+manage via action:"list".

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

  if (!inclinationsEnabled) {
    // Config-Schalter aus: Neigungsprompt-Tools nicht registrieren
    // (Injektion läuft separat über promptPreprocessor).
    return tools.filter((t) => !t.name.startsWith("inclination_prompt_"));
  }

  return tools;
};
