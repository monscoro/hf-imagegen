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
      "Current: black-forest-labs/FLUX.2-dev (32B, SOTA quality, non-commercial). " +
      "Alternatives: FLUX.2-klein-9B (fast), FLUX.1-schnell (free, fast, lower quality), " +
      "stabilityai/stable-diffusion-xl-base-1.0. Use list_models tool to see all options.",
  }, "black-forest-labs/FLUX.2-dev")
  .field("outputDirectory", "string", {
    displayName: "Output Directory",
    subtitle:
      "Directory where generated images are saved. " +
      "Use ~ for home directory (e.g. ~/hf-images). Created automatically if it does not exist.",
  }, "~/hf-images")
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
      "Resets at midnight. Default: 50.",
  }, 50)
  .build();
