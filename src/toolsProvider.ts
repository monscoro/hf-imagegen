import { text, tool, type Tool, type ToolCallContext, type ToolsProvider } from "@lmstudio/sdk";
import { InferenceClient } from "@huggingface/inference";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { pluginConfigSchematics } from "./config";

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

const POPULAR_MODELS = [
  {
    id: "black-forest-labs/FLUX.1-schnell",
    description: "FLUX.1 Schnell — fast, high-quality, state-of-the-art. Free tier friendly via Fal.ai provider.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
  },
  {
    id: "black-forest-labs/FLUX.1-dev",
    description: "FLUX.1 Dev — higher quality than schnell, ~50 steps. Requires HF Pro credits. Non-commercial license.",
    style: "photorealistic, artistic",
    speed: "medium",
    access: "pro",
  },
  {
    id: "black-forest-labs/FLUX.2-klein",
    description: "FLUX.2 Klein — latest FLUX, real-time generation under 1s. Apache 2.0 (fully open). Free tier.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
  },
  {
    id: "black-forest-labs/FLUX.2-dev",
    description: "FLUX.2 Dev — 32B parameter flagship. Best quality. Requires HF Pro credits. Non-commercial license.",
    style: "photorealistic, artistic",
    speed: "slow",
    access: "pro",
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    description: "SDXL — Stability AI flagship 1024px model. Stable and reliable, free tier.",
    style: "photorealistic, artistic, illustration",
    speed: "medium",
    access: "free",
  },
];

export const toolsProvider: ToolsProvider = async (ctl) => {
  const cfg = ctl.getPluginConfig(pluginConfigSchematics);

  const getToken = () => cfg.get("hfApiToken").trim();
  const getModel = () => cfg.get("defaultModel").trim() || "black-forest-labs/FLUX.1-schnell";
  const getOutputDir = () => resolvePath(cfg.get("outputDirectory").trim() || "~/hf-images");

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

    tool({
      name: "list_models",
      description: text`
        Return the list of popular Hugging Face text-to-image models you can use with generate_image.
        Shows model ID, description, style, and speed.

        Use when the user asks what models are available or wants to pick a different model.
      `,
      parameters: {},
      implementation: safe_impl("list_models", async () => {
        const currentDefault = getModel();
        return json({
          current_default_model: currentDefault,
          models: POPULAR_MODELS.map((m) => ({
            ...m,
            is_default: m.id === currentDefault,
          })),
          note: "Change the default model in plugin settings, or pass model_id directly to generate_image.",
        });
      }),
    }),

    tool({
      name: "list_loras",
      description: text`
        Search HuggingFace for LoRA adapters compatible with a base model (default: FLUX.1).
        Returns model IDs you can pass as lora_id in generate_image.

        Use when the user asks about LoRAs, styles, or wants to customize the image generation style.
      `,
      parameters: {
        search: z.string().default("").describe(
          "Optional keyword to filter LoRAs (e.g. 'anime', 'portrait', 'watercolor'). " +
          "Leave blank to list popular FLUX LoRAs."
        ),
      },
      implementation: safe_impl("list_loras", async ({ search }) => {
        const token = getToken();
        const query = search.trim() ? `${search.trim()} lora` : "flux lora";
        const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=lora&sort=downloads&limit=15`;

        const headers: Record<string, string> = { "Accept": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HF API error: ${res.status} ${res.statusText}`);

        const models = await res.json() as Array<{
          id: string;
          downloads?: number;
          likes?: number;
          tags?: string[];
          cardData?: { base_model?: string };
        }>;

        const results = models.map((m) => ({
          id: m.id,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          base_model: m.cardData?.base_model ?? "unknown",
          tags: (m.tags ?? []).filter((t) => ["lora", "flux", "sdxl", "stable-diffusion"].includes(t)),
        }));

        return json({
          query,
          results,
          usage: "Pass the 'id' field as lora_id in generate_image. Pair FLUX LoRAs with a FLUX base model.",
          note: "LoRA generation uses fal-ai provider. lora_scale default is 1.0; try 0.6–0.9 for subtle effects.",
        });
      }),
    }),

  ];

  return tools;
};
