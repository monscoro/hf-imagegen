import { createConfigSchematics } from "@lmstudio/sdk";

export const pluginConfigSchematics = createConfigSchematics()
  .field("hfApiToken", "string", {
    displayName: "HuggingFace API Token",
    subtitle:
      "Your Hugging Face access token from huggingface.co/settings/tokens. " +
      "Required for image generation. Use a token with at least 'read' scope.",
  }, "")
  .field("defaultModel", "string", {
    displayName: "Default Model",
    subtitle:
      "HuggingFace model ID for text-to-image generation. " +
      "Default: black-forest-labs/FLUX.1-dev (free via Inference Providers, good quality). " +
      "Alternatives: FLUX.2-dev (32B, best quality, requires license), FLUX.1-schnell (fastest, free), " +
      "stabilityai/stable-diffusion-xl-base-1.0. Use list_models tool to see all options.",
  }, "black-forest-labs/FLUX.1-dev")
  .field("defaultEditModel", "string", {
    displayName: "Default Edit Model",
    subtitle:
      "HuggingFace model ID for image_edit (image-to-image). Must be an editing-native model: " +
      "black-forest-labs/FLUX.2-dev (default) or alternatives black-forest-labs/FLUX.1-Kontext-dev, " +
      "Qwen/Qwen-Image-Edit. Text-to-image base models (FLUX.1-dev, SDXL, Qwen-Image) do NOT work " +
      "for editing. Use list_models with source='image-edit' to see suitable models.",
  }, "black-forest-labs/FLUX.2-dev")
  .field("pollinationsApiKey", "string", {
    displayName: "Pollinations API Key (required)",
    subtitle:
      "Required for backend='pollinations' (since Sep 2026, anonymous access removed). " +
      "Get your key at https://enter.pollinations.ai/keys. " +
      "With key: higher limits, no watermark (nologo), access to paid models. " +
      "Never share secret keys (sk_…) — use your own key locally.",
  }, "")
  .field("outputDirectory", "string", {
    displayName: "Output Directory",
    subtitle:
      "Directory where generated images are saved. " +
      "Use ~ for home directory (e.g. ~/images). Created automatically if it does not exist.",
  }, "~/images")
  .field("rateLimitCooldown", "numeric", {
    displayName: "Generation Cooldown (ms)",
    subtitle:
      "Minimum milliseconds between image generations. " +
      "Prevents rapid credit consumption. Default: 5000 (5 seconds).",
  }, 5000)
  .field("rateLimitDailyCap", "numeric", {
    displayName: "Daily Generation Limit",
    subtitle:
      "Maximum number of images that can be generated per day. " +
      "Resets at midnight. Default: 75.",
  }, 75)
  .field("enableInclinationPrompts", "boolean", {
    displayName: "Enable Inclination Prompts",
    subtitle:
      "Master switch for the Neigungsprompt/Stimmungsprompt subsystem " +
      "(inclination_prompt_list, inclination_prompt_manage, inclination_prompt_library). " +
      "Off hides these tools and stops injecting active style profiles into the LLM context. " +
      "Previously active profiles stay stored and resume when re-enabled. Default: on.",
  }, true)
  .build();
