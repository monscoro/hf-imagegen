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
import { lookupLibrary } from "./curatedLibrary";
import {
  getAllBooks,
  getAllRecords,
  getBookById,
  getRecordById,
  createBook,
  updateBook,
  deleteBook,
  createRecord,
  updateRecord,
  deleteRecord,
  getActiveRecordRefs,
  addActiveRecord,
  removeActiveRecord,
  removeActiveRecordsOfBook,
  clearActiveRecords,
  listAspects,
  refOf,
} from "./libraryStore";
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
  getActiveIds,
  addActiveDirective,
  removeActiveDirective,
  clearActiveDirectives,
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

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ähnlichkeits-Vorschläge: Substring-Treffer zuerst, dann Edit-Distance (Tippfehler). */
function suggestIds(candidates: string[], target: string): string[] {
  const t = target.toLowerCase();
  return candidates
    .map((c) => {
      const lc = c.toLowerCase();
      return { c, sub: lc.includes(t) || (t.length >= 4 && t.includes(lc)), d: levenshtein(lc, t) };
    })
    .filter((x) => x.sub || x.d <= Math.max(2, Math.floor(t.length / 3)))
    .sort((x, y) => (x.sub === y.sub ? x.d - y.d : x.sub ? -1 : 1))
    .slice(0, 5)
    .map((x) => x.c);
}

function profileNotFound(clean: string): Error {
  const close = suggestIds(getAllDirectives("").map((d) => d.id), clean);
  return new Error(
    `Profil "${clean}" nicht gefunden.` +
      (close.length ? ` Meintest du: ${close.join(", ")}?` : "") +
      ` Neues anlegen: inclination_prompt_manage({store:"profile", action:"create", name:"${clean}", ` +
      `description:"Kurzbeschreibung", prompt:"inclination: …"}). Verfügbar: inclination_prompt_list.`
  );
}

function bookNotFound(clean: string): Error {
  const all = getAllBooks();
  const close = suggestIds(all.map((b) => b.id), clean);
  return new Error(
    `Buch "${clean}" nicht gefunden.` +
      (close.length ? ` Meintest du: ${close.join(", ")}?` : "") +
      ` Neues Buch: inclination_prompt_manage({store:"book", action:"create", name:"${clean}", description:"…"}). ` +
      `Vorhandene Bücher: ${all.map((b) => b.id).join(", ")}.`
  );
}

function recordNotFound(ref: string): Error {
  const close = suggestIds(getAllRecords().map((r) => refOf(r.book, r.id)), ref);
  return new Error(
    `Record "${ref}" nicht gefunden.` +
      (close.length ? ` Meintest du: ${close.join(", ")}?` : "") +
      ` Neuer Record: inclination_prompt_manage({store:"record", action:"create", book:"…", name:"…", aspect:"…", content:"…"}). ` +
      `Katalog: inclination_prompt_library({query:""}).`
  );
}

function resolvePath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function slugifyFilename(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

function timestampedFilename(ext: "png" | "jpeg" | "webp", prefix: "hf" | "pl" = "hf", name = ""): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const slug = slugifyFilename(name);
  return `${prefix}-${ts}${slug ? `-${slug}` : ""}.${ext}`;
}

async function saveImageBuffer(
  buffer: Buffer,
  mimeType: string,
  outputDir: string,
  prefix: "hf" | "pl" = "hf",
  name = ""
): Promise<{ filePath: string; filename: string }> {
  const ext: "png" | "jpeg" | "webp" =
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpeg"
    : mimeType.includes("webp") ? "webp"
    : "png";
  const filename = timestampedFilename(ext, prefix, name);
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

        FILES: saved under plugin output directory (config 'Output Directory'). Optional
        'name' appends a readable filename slug (sanitized) after the timestamp — set it
        when the user asks to name/label the file; it also makes list_output_images
        filtering useful. Hand the image to other tools as the returned absolute
        file_path (image_edit accepts it from ANY earlier tool result — do NOT strip it
        to a bare filename). Find results via list_output_images.
        quota.remaining counts plugin daily limit, not HF credits.
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
          "Output quality (backend='pollinations' only, ignored with backend='hf'). " +
          "Blank or unset = medium (server default). " +
          "Only documented for gpt-image and grok-imagine models; for other models it is ignored and a note is added to the result."
        ),
        name: z.string().default("").describe(
          "Optional filename label (e.g. 'red cat runway'). Sanitized to lowercase " +
          "a-z0-9- (max 40 chars) and appended after the timestamp: " +
          "hf-2026-09-23_12-00-00_red-cat-runway.png. Blank or fully sanitized away " +
          "= timestamp only. Pass it when the user asks to name/label the file."
        ),
      },
      implementation: safe_impl("generate_image", async ({ prompt, model_id, backend, negative_prompt, lora_id, lora_scale, width, height, seed, quality, name }, ctx) => {
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

          const { filePath, filename } = await saveImageBuffer(buffer, mimeType, outputDir, usePollinations ? "pl" : "hf", name);

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

        The 'image' parameter prefers an absolute local file path — use the file_path
        returned by any earlier generate_image/image_edit result as-is; relative paths
        resolve against the plugin process working directory (NOT the chat working dir),
        which is why bare or relative paths can miss. A bare filename is also accepted
        (output directory first, then process CWD), as is a public image URL.
        To generate from scratch, use generate_image instead.
        An active Neigungsprompt guides how the change is formulated, same as generate_image.
        Optional lora_id/negative_prompt/provider: HF backend only (rejected or ignored
        with pollinations).

        FILES: the edited image is saved under the plugin output directory (config
        'Output Directory', returned as output_dir); optional 'name' appends a readable
        filename slug (sanitized) after the timestamp — set it when the user asks to
        name/label the result. Use the returned absolute file_path when
        handing the image to other tools (incl. further image_edit calls) — do NOT strip it
        to a bare filename. Find results via
        list_output_images. quota.remaining counts the plugin's own daily limit, not HF credits.
      `,
      parameters: {
        image: z.string().min(1).describe(
          "Reference image: absolute local file path PREFERRED (the file_path from an earlier " +
          "generate_image/image_edit result — relative paths resolve against the plugin process " +
          "CWD, not the chat directory). Also accepted: bare filename (output directory first), " +
          "relative path, or public http(s) URL."
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
        name: z.string().default("").describe(
          "Optional filename label for the result (e.g. 'latex-v2'). Sanitized to " +
          "lowercase a-z0-9- (max 40 chars) and appended after the timestamp: " +
          "hf-2026-09-23_12-00-00_latex-v2.png. Blank or fully sanitized away = " +
          "timestamp only. Pass it when the user asks to name/label the file."
        ),
      },
      implementation: safe_impl("image_edit", async ({ image, prompt, backend, model_id, provider, negative_prompt, lora_id, lora_scale, quality, name }, ctx) => {
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

          const { filePath, filename } = await saveImageBuffer(outBuffer, mimeType, outputDir, usePollinations ? "pl" : "hf", name);

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
        List images in the plugin output directory — the shared workspace holding both
        generated results (generate_image/image_edit) and input/reference images
        (image_edit resolves bare filenames against this directory first).
        Paginated and compact — use it instead of reading a large directory at once.

        Use when the user asks which images exist, wants the latest result, or needs to
        locate an input/reference image for image_edit — a prior result or a file placed
        in this directory (newest first by default, so limit=1 returns the latest image).
        Entries return 'filename'; for image_edit, prefer the absolute path
        output_directory + filename. Walk large folders page by page via offset.
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
          usage: "For image_edit pass the absolute path: output_directory + filename (preferred over bare filename).",
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
            // is_default bezieht sich auf den Default des jeweiligen Katalogs:
            // pollinations → Pollinations-T2I-Default, image-edit → HF-Edit-Default, sonst HF-T2I-Default.
            is_default:
              source === "pollinations"
                ? m.id === POLLINATIONS_DEFAULT_MODEL
                : source === "image-edit"
                  ? m.id === editDefault
                  : m.id === currentDefault,
          })),
          note: loraTruncated
            ? `LoRA lookup capped to first ${LORA_CAP} models to avoid API flood. Use list_loras with base_model for others.`
            : source === "curated"
              ? "Expert-verified HuggingFace IDs for generate_image backend='hf'. Use list_loras with base_model to find compatible LoRAs."
              : source === "pollinations"
                ? "Pollinations IDs for generate_image or image_edit with backend='pollinations' (requires pollinationsApiKey). " +
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
        Gesamtübersicht über das Neigungsprompt-System (READ-ONLY, verändert nichts) – einheitlicher Prefix inclination_prompt_.

        Drei Abschnitte:
        - active: gerade injizierte Profile und aktive Bibliotheks-Records (Stacks).
        - profiles: Stimmungsprompts (curated + user) mit is_active-Flag.
        - library: Bücher mit Record-Zahl/Facetten + Facetten-Verteilung.
        detail:"full" liefert zusätzlich alle Prompt-/Content-Texte (teuer); compact nur Namen/Beschreibungen.

        Das ist DAS Einstiegstool, wenn unklar ist, was vorhanden ist und was gerade aktiv ist.
        Etwas ändern/anlegen/aktivieren → inclination_prompt_manage.
        Einen Record im Detail nachschlagen → inclination_prompt_library.
      `,
      parameters: {
        filter: z.string().default("").describe("Optional: Substring-Filter über Profile, Bücher und Records (id/aspect/keys/Text). Leer = alles."),
        detail: z.enum(["compact", "full"]).default("compact").describe("full = zusätzlich alle Prompt-/Content-Texte (teuer); compact = nur Übersicht (default)."),
      },
      implementation: safe_impl("inclination_prompt_list", async ({ filter = "", detail = "compact" }) => {
        const full = detail === "full";
        const f = filter.trim().toLowerCase();
        const profiles = getAllDirectives("");
        const activeProfileIds = getActiveIds();
        const activeRefs = getActiveRecordRefs();
        const books = getAllBooks();
        const records = getAllRecords();

        const matchProfile = (d: (typeof profiles)[number]) =>
          !f || d.id.includes(f) || d.description.toLowerCase().includes(f);
        const matchRecord = (r: (typeof records)[number]) =>
          !f ||
          r.id.includes(f) ||
          r.book.includes(f) ||
          r.aspect.includes(f) ||
          r.keys.some((k) => k.toLowerCase().includes(f)) ||
          r.content.toLowerCase().includes(f);

        const profileEntries = profiles.filter(matchProfile).map((d) => ({
          id: d.id,
          description: d.description,
          source: d.source,
          readonly: d.readonly,
          is_active: activeProfileIds.includes(d.id),
          ...(full ? { prompt: d.prompt } : {}),
        }));

        const bookEntries = books
          .filter(
            (b) =>
              !f ||
              b.id.includes(f) ||
              b.description.toLowerCase().includes(f) ||
              records.some((r) => r.book === b.id && matchRecord(r))
          )
          .map((b) => {
            const own = records.filter((r) => r.book === b.id);
            return {
              id: b.id,
              description: b.description,
              source: b.source,
              readonly: b.readonly,
              record_count: own.length,
              active_count: own.filter((r) => activeRefs.includes(refOf(r.book, r.id))).length,
              aspects: [...new Set(own.map((r) => r.aspect))].sort(),
            };
          });

        const facetCounts = new Map<string, number>();
        for (const r of records) facetCounts.set(r.aspect, (facetCounts.get(r.aspect) ?? 0) + 1);
        const facets = Array.from(facetCounts.entries())
          .map(([aspect, count]) => ({ aspect, count }))
          .sort((a, b) => a.aspect.localeCompare(b.aspect));

        const matchedRecords = records.filter(matchRecord);
        return json({
          active: {
            profiles: activeProfileIds.map((id) => ({
              id,
              description: profiles.find((p) => p.id === id)?.description ?? "",
            })),
            records: activeRefs.map((ref) => {
              const r = records.find((x) => refOf(x.book, x.id) === ref);
              return { ref, book: r?.book ?? "", id: r?.id ?? "", aspect: r?.aspect ?? "" };
            }),
          },
          profiles: { count: profileEntries.length, entries: profileEntries },
          library: {
            books: bookEntries,
            records_total: records.length,
            records_matched: matchedRecords.length,
            facets,
            ...(full
              ? {
                  records: matchedRecords.map((r) => ({
                    ref: refOf(r.book, r.id),
                    ...r,
                    is_active: activeRefs.includes(refOf(r.book, r.id)),
                  })),
                }
              : {}),
          },
          filter: f || "(none)",
          note: "Aktivieren/Deaktivieren: inclination_prompt_manage({action:'activate'|'deactivate', store:'profile'|'record'|'book'}) — idempotent, kein Toggle; store:'book' = alle Records des Buchs; action:'clear' leert beide Stacks.",
          config_hint: "Neue Inhalte: inclination_prompt_manage({store:'profile'|'book'|'record', action:'create'}). Record-Inhalte nachschlagen: inclination_prompt_library.",
        });
      }),
    }),

    tool({
      name: "inclination_prompt_manage",
      description: text`
        Einziges Tool, das etwas am Neigungsprompt-System VERÄNDERT (Inhalte und aktiver Stack) – einheitlicher Prefix inclination_prompt_.

        store wählt die Domäne:
        - profile (default): Stimmungsprompts, die injiziert werden (directives.json).
        - book: Container der Bibliothek (library.json) — id + description; delete räumt auch die Records.
        - record: Einzelner Bibliotheks-Eintrag {book, aspect, keys, content} — on-demand Nachschlagewerk,
          wird NICHT injiziert, solange er nicht per activate in den Stack wandert.

        action (alle idempotent — kein verstecktes Umschalten wie früher bei _set):
        - create: profile {description, prompt} | book {description} | record {book, name, aspect, content, keys}
          (record-create legt ein fehlendes Buch automatisch an und meldet das).
        - update / delete / get: wie erwartet; curated (skillset, lorebook, Beispiel-Profile) bleiben read-only.
        - activate / deactivate: Ziel hängt am store; store:"book" aktiviert/deaktiviert ALLE Records des Buchs.
        - clear: leert BEIDE Stacks (profile-Stack + Record-Stack), store wird ignoriert.
        Jede Mutation meldet active_profiles + active_records (Stack-Sichtbarkeit).

        Nur lesen: inclination_prompt_list (Gesamtübersicht) und inclination_prompt_library (Record-Volltext).
      `,
      parameters: {
        store: z.enum(["profile", "book", "record"]).default("profile").describe(
          "Ziel-Domäne: profile = Stimmungsprompt (injiziert), book = Bibliotheks-Buch, record = Bibliotheks-Eintrag."
        ),
        action: z.enum(["create", "update", "delete", "get", "activate", "deactivate", "clear", "list"]).describe(
          "Operation. 'list' existiert nicht mehr (Fehler nennt inclination_prompt_list)."
        ),
        name: z.string().default("").describe(
          "Id (a-z,0-9,-,_) von Profil, Buch oder Record. Bei store:'record' zusätzlich book angeben."
        ),
        book: z.string().default("").describe("Buch-Id — Pflicht bei store:'record'."),
        aspect: z.string().default("").describe(
          "Facette für records: session, role, positions, bondage, sensation, play, training, tones, aftercare, spaces, safety, realm (oder eigener Slug)."
        ),
        description: z.string().default("").describe("Kurzbeschreibung/Titel — profile.create/update, book.create/update."),
        prompt: z.string().default("").describe("Neigungsprompt-Text (indirekt, nicht Bildinhalt) — profile.create/update."),
        content: z.string().default("").describe("Record-Volltext — record.create/update."),
        keys: z.string().default("").describe("Komma-getrennte Suchschlüssel — record.create/update."),
      },
      implementation: safe_impl(
        "inclination_prompt_manage",
        async ({
          store = "profile",
          action = "",
          name = "",
          book = "",
          aspect = "",
          description = "",
          prompt = "",
          content = "",
          keys = "",
        }) => {
          const stack = () => ({
            active_profiles: getActiveIds(),
            active_records: getActiveRecordRefs(),
          });
          const cleanName = name.trim().toLowerCase();
          const cleanBook = book.trim().toLowerCase();
          const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
          const splitKeys = (raw: string) => raw.split(",").map((k) => k.trim()).filter(Boolean);

          if (!action) {
            throw new Error(
              'action ist Pflicht: create, update, delete, get, activate, deactivate oder clear (store wählt profile|book|record).'
            );
          }
          if (action === "list") {
            throw new Error(
              'action:"list" wurde entfernt — inclination_prompt_list ist die read-only Gesamtübersicht (Profile + Bücher + aktive Stacks).'
            );
          }
          if (action === "clear") {
            clearActiveDirectives();
            clearActiveRecords();
            return json({
              success: true,
              action,
              ...stack(),
              message: "Beide Stacks geleert — alle Profile und Bibliotheks-Records deaktiviert.",
            });
          }

          if (store === "profile") {
            if (!cleanName) throw new Error('name (Profil-Id) ist Pflicht bei store:"profile".');
            switch (action) {
              case "create": {
                if (!description.trim()) throw new Error("description ist Pflicht für profile.create.");
                if (!prompt.trim()) throw new Error("prompt ist Pflicht für profile.create.");
                const created = createDirective(cleanName, description, prompt, "");
                return json({
                  success: true,
                  store,
                  action,
                  directive: created,
                  ...stack(),
                  message: `Profil "${created.id}" erstellt. Aktivieren: inclination_prompt_manage({store:"profile", action:"activate", name:"${created.id}"}).`,
                });
              }
              case "update": {
                const hasDesc = description.trim().length > 0;
                const hasPrompt = prompt.trim().length > 0;
                if (!hasDesc && !hasPrompt)
                  throw new Error("Für profile.update mindestens description oder prompt mitgeben.");
                const updated = updateDirective(
                  cleanName,
                  hasDesc ? description : undefined,
                  hasPrompt ? prompt : undefined,
                  ""
                );
                return json({ success: true, store, action, directive: updated, ...stack(), message: `Profil "${updated.id}" aktualisiert.` });
              }
              case "delete": {
                deleteDirective(cleanName, "");
                return json({ success: true, store, action, deleted: cleanName, ...stack(), message: `Profil "${cleanName}" gelöscht.` });
              }
              case "get": {
                const found = getDirectiveById(cleanName, "");
                if (!found) throw profileNotFound(cleanName);
                return json({ success: true, store, action, directive: found, is_active: getActiveIds().includes(found.id) });
              }
              case "activate": {
                const found = getDirectiveById(cleanName, "");
                if (!found) throw profileNotFound(cleanName);
                if (getActiveIds().includes(cleanName)) {
                  return json({
                    success: true,
                    store,
                    action,
                    already_active: true,
                    ...stack(),
                    message: `Profil "${cleanName}" ist bereits aktiv — keine Änderung.`,
                  });
                }
                const activated = addActiveDirective(cleanName, "");
                return json({
                  success: true,
                  store,
                  action,
                  activated: { id: activated.id, description: activated.description },
                  ...stack(),
                  message: `Profil "${activated.id}" aktiviert. Wird indirekt bei generate_image/image_edit berücksichtigt.`,
                });
              }
              case "deactivate": {
                const found = getDirectiveById(cleanName, "");
                if (!found) throw profileNotFound(cleanName);
                if (!getActiveIds().includes(cleanName)) {
                  return json({
                    success: true,
                    store,
                    action,
                    already_inactive: true,
                    ...stack(),
                    message: `Profil "${cleanName}" war nicht aktiv — keine Änderung.`,
                  });
                }
                removeActiveDirective(cleanName);
                return json({ success: true, store, action, deactivated: cleanName, ...stack(), message: `Profil "${cleanName}" deaktiviert.` });
              }
              default:
                throw new Error(`Unbekannter action "${action}".`);
            }
          }

          if (store === "book") {
            if (!cleanName) throw new Error('name (Buch-Id) ist Pflicht bei store:"book".');
            switch (action) {
              case "create": {
                const created = createBook(cleanName, description);
                return json({
                  success: true,
                  store,
                  action,
                  book: created,
                  ...stack(),
                  message: `Buch "${created.id}" erstellt. Records: inclination_prompt_manage({store:"record", action:"create", book:"${created.id}", …}).`,
                });
              }
              case "update": {
                if (!description.trim()) throw new Error("description ist Pflicht für book.update.");
                const updated = updateBook(cleanName, description);
                return json({ success: true, store, action, book: updated, ...stack(), message: `Buch "${updated.id}" aktualisiert.` });
              }
              case "delete": {
                const { deletedRecords } = deleteBook(cleanName);
                return json({
                  success: true,
                  store,
                  action,
                  deleted: cleanName,
                  deleted_records: deletedRecords,
                  ...stack(),
                  message: `Buch "${cleanName}" gelöscht${deletedRecords.length ? ` inkl. ${deletedRecords.length} Record(s)` : ""}.`,
                });
              }
              case "get": {
                const found = getBookById(cleanName);
                if (!found) throw bookNotFound(cleanName);
                const own = getAllRecords().filter((r) => r.book === found.id);
                const refs = getActiveRecordRefs();
                return json({
                  success: true,
                  store,
                  action,
                  book: found,
                  record_count: own.length,
                  active_count: own.filter((r) => refs.includes(refOf(r.book, r.id))).length,
                  records: own.map((r) => ({ id: r.id, aspect: r.aspect, keys: r.keys, is_active: refs.includes(refOf(r.book, r.id)) })),
                  note: "Volltexte: inclination_prompt_library({book:\"" + found.id + "\"}).",
                });
              }
              case "activate": {
                const found = getBookById(cleanName);
                if (!found) throw bookNotFound(cleanName);
                const own = getAllRecords().filter((r) => r.book === found.id);
                if (own.length === 0) {
                  return json({ success: true, store, action, activated_records: 0, ...stack(), message: `Buch "${found.id}" enthält keine Records.` });
                }
                let added = 0;
                let already = 0;
                let w = 0;
                for (const r of own) {
                  const res = addActiveRecord(r.book, r.id);
                  if (res.alreadyActive) already++;
                  else {
                    added++;
                    w += words(r.content);
                  }
                }
                return json({
                  success: true,
                  store,
                  action,
                  activated_records: added,
                  already_active: already,
                  estimated_words: w,
                  ...stack(),
                  message:
                    added > 0
                      ? `${added} Record(s) aus "${found.id}" aktiviert (${w} Wörter Injektion). Stilistisch verweben, nicht wörtlich präfixen.`
                      : `Alle ${already} Record(s) von "${found.id}" waren bereits aktiv — keine Änderung.`,
                });
              }
              case "deactivate": {
                const found = getBookById(cleanName);
                if (!found) throw bookNotFound(cleanName);
                const removed = removeActiveRecordsOfBook(found.id);
                return json({
                  success: true,
                  store,
                  action,
                  deactivated_records: removed,
                  ...stack(),
                  message: removed
                    ? `${removed} Record(s) aus "${found.id}" deaktiviert.`
                    : `Keine aktiven Records in "${found.id}" — keine Änderung.`,
                });
              }
              default:
                throw new Error(`Unbekannter action "${action}".`);
            }
          }

          // store === "record"
          if (!cleanBook) throw new Error('book (Buch-Id) ist Pflicht bei store:"record".');
          if (!cleanName) throw new Error('name (Record-Id) ist Pflicht bei store:"record".');
          const ref = refOf(cleanBook, cleanName);
          switch (action) {
            case "create": {
              if (!aspect.trim())
                throw new Error(`aspect ist Pflicht für record.create. Bekannte Facetten: ${listAspects().join(", ")}.`);
              if (!content.trim()) throw new Error("content ist Pflicht für record.create.");
              const { record, bookCreated } = createRecord({
                book: cleanBook,
                id: cleanName,
                aspect,
                keys: splitKeys(keys),
                content,
              });
              const newRef = refOf(record.book, record.id);
              return json({
                success: true,
                store,
                action,
                record,
                book_created: bookCreated,
                ...stack(),
                message:
                  `Record "${newRef}" erstellt${bookCreated ? ` (Buch "${record.book}" neu angelegt)` : ""}. ` +
                  `Aktivieren: inclination_prompt_manage({store:"record", action:"activate", book:"${record.book}", name:"${record.id}"}).`,
              });
            }
            case "update": {
              const hasAspect = aspect.trim().length > 0;
              const hasKeys = keys.trim().length > 0;
              const hasContent = content.trim().length > 0;
              if (!hasAspect && !hasKeys && !hasContent)
                throw new Error("Für record.update mindestens aspect, keys oder content mitgeben.");
              const updated = updateRecord(cleanBook, cleanName, {
                ...(hasAspect ? { aspect } : {}),
                ...(hasKeys ? { keys: splitKeys(keys) } : {}),
                ...(hasContent ? { content } : {}),
              });
              return json({ success: true, store, action, record: updated, ...stack(), message: `Record "${refOf(updated.book, updated.id)}" aktualisiert.` });
            }
            case "delete": {
              deleteRecord(cleanBook, cleanName);
              return json({ success: true, store, action, deleted: ref, ...stack(), message: `Record "${ref}" gelöscht.` });
            }
            case "get": {
              const found = getRecordById(cleanBook, cleanName);
              if (!found) throw recordNotFound(ref);
              return json({
                success: true,
                store,
                action,
                record: { ref: refOf(found.book, found.id), ...found },
                is_active: getActiveRecordRefs().includes(refOf(found.book, found.id)),
              });
            }
            case "activate": {
              const { record, alreadyActive } = addActiveRecord(cleanBook, cleanName);
              if (alreadyActive) {
                return json({ success: true, store, action, already_active: true, ...stack(), message: `Record "${ref}" ist bereits aktiv — keine Änderung.` });
              }
              return json({
                success: true,
                store,
                action,
                activated: { ref: refOf(record.book, record.id), book: record.book, id: record.id, aspect: record.aspect },
                estimated_words: words(record.content),
                ...stack(),
                message: `Record "${ref}" aktiviert (${words(record.content)} Wörter). Wird indirekt bei generate_image/image_edit verwebt.`,
              });
            }
            case "deactivate": {
              const found = getRecordById(cleanBook, cleanName);
              if (!found) throw recordNotFound(ref);
              if (!removeActiveRecord(cleanBook, cleanName)) {
                return json({ success: true, store, action, already_inactive: true, ...stack(), message: `Record "${ref}" war nicht aktiv — keine Änderung.` });
              }
              return json({ success: true, store, action, deactivated: ref, ...stack(), message: `Record "${ref}" deaktiviert.` });
            }
            default:
              throw new Error(`Unbekannter action "${action}".`);
          }
        }
      ),
    }),

    tool({
      name: "inclination_prompt_library",
      description: text`
        Nachschlagewerk für Technik-/Stil-Records — Bücher "skillset" (A01–A33) und "lorebook" (Masken, Reiche, Töne, Filter) plus eigene Bücher – einheitlicher Prefix inclination_prompt_. READ-ONLY, verändert nichts.

        - query "" → kompakter Katalog (ref, id, book, aspect, keys) + facets + books.
        - query = exakte id ('A08', 'realm-combos', 'tone-rage') oder Keyword ('impact', 'aftercare') → voller Record.
        - query = Wortteil → Trefferliste (greift auf id, keys, aspect, content).
        - book / aspect filtern (z.B. book:"lorebook", aspect:"realm").

        Der Record-Inhalt ist STAGING-GUIDANCE FÜR DICH: indirekt in den nächsten
        generate_image/image_edit-Prompt weben, nicht wörtlich als Präfix kopieren.
        On-demand, nicht injiziert. Dauerhafter Style = in den Stack heben:
        inclination_prompt_manage({store:"record", action:"activate", …}).
        Gesamtübersicht (Profile, Bücher, aktive Stacks) → inclination_prompt_list.
      `,
      parameters: {
        query: z.string().default("").describe("Record-Id, Keyword oder Wortteil; '' = kompakter Katalog."),
        book: z.string().default("").describe("Optional: nur dieses Buch (z.B. 'skillset', 'lorebook' oder eigene Buch-Id)."),
        aspect: z.string().default("").describe("Optional: nur diese Facette (session, role, positions, bondage, sensation, play, training, tones, aftercare, spaces, safety, realm)."),
      },
      implementation: safe_impl("inclination_prompt_library", async ({ query = "", book = "", aspect = "" }) => {
        const all = getAllRecords();
        const books = getAllBooks();
        const activeRefs = getActiveRecordRefs();
        const cleanBook = book.trim().toLowerCase();
        const cleanAspect = aspect.trim().toLowerCase();
        const res = lookupLibrary(all, { query, book, aspect });

        const compact = (r: (typeof all)[number]) => ({
          ref: refOf(r.book, r.id),
          id: r.id,
          book: r.book,
          aspect: r.aspect,
          keys: r.keys,
          is_active: activeRefs.includes(refOf(r.book, r.id)),
        });

        const scoped = all.filter(
          (r) => (!cleanBook || r.book === cleanBook) && (!cleanAspect || r.aspect === cleanAspect)
        );
        const facetCounts = new Map<string, number>();
        for (const r of scoped) facetCounts.set(r.aspect, (facetCounts.get(r.aspect) ?? 0) + 1);
        const facets = Array.from(facetCounts.entries())
          .map(([a, count]) => ({ aspect: a, count }))
          .sort((x, y) => x.aspect.localeCompare(y.aspect));
        const bookList = books.map((b) => ({
          id: b.id,
          description: b.description,
          source: b.source,
          readonly: b.readonly,
          record_count: all.filter((r) => r.book === b.id).length,
        }));

        if (res.mode === "catalog") {
          return json({
            mode: "catalog",
            query: query.trim() || "(all)",
            book: cleanBook || "(all)",
            aspect: cleanAspect || "(all)",
            count: res.records.length,
            records: res.records.map(compact),
            facets,
            books: bookList,
            usage: "Exakte id oder Keyword in query liefern den Volltext eines Records.",
          });
        }

        if (res.mode === "record") {
          const r = res.records[0];
          return json({
            mode: "record",
            record: { ref: refOf(r.book, r.id), id: r.id, book: r.book, aspect: r.aspect, keys: r.keys, content: r.content, source: r.source },
            is_active: activeRefs.includes(refOf(r.book, r.id)),
            usage:
              "Staging-Guidance: indirekt in den nächsten generate_image/image_edit-Prompt einweben " +
              "(nicht wörtlich präfixen). On-demand, nicht injiziert — dauerhaft aktiv über " +
              `inclination_prompt_manage({store:"record", action:"activate", book:"${r.book}", name:"${r.id}"}).`,
          });
        }

        if (res.records.length === 0) {
          throw new Error(
            `Keine Treffer für "${query.trim()}"${cleanBook ? ` in Buch "${cleanBook}"` : ""}${cleanAspect ? ` (aspect "${cleanAspect}")` : ""}. ` +
              `Mit query:"" für den Katalog. Facetten: ${facets.map((f) => `${f.aspect}(${f.count})`).join(", ") || listAspects().join(", ")}. ` +
              `Bücher: ${bookList.map((b) => `${b.id}(${b.record_count})`).join(", ")}.`
          );
        }

        const sameId = res.records.every((r) => r.id === res.records[0].id);
        return json({
          mode: "matches",
          query: query.trim(),
          count: res.records.length,
          matches: res.records.map(compact),
          facets,
          usage: sameId
            ? `Die id existiert in mehreren Büchern — mit book einschränken (Treffer: ${res.records.map((r) => r.book).join(", ")}).`
            : `Mehrere Treffer — wähle eine exakte ref, z.B. inclination_prompt_library({query:"${res.records[0].id}"}).`,
        });
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
