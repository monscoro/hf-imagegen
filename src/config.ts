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
      "Examples: black-forest-labs/FLUX.1-schnell, black-forest-labs/FLUX.1-dev, " +
      "stabilityai/stable-diffusion-xl-base-1.0. Use list_models tool to see all options.",
  }, "black-forest-labs/FLUX.1-schnell")
  .field("outputDirectory", "string", {
    displayName: "Output Directory",
    subtitle:
      "Directory where generated images are saved. " +
      "Use ~ for home directory (e.g. ~/hf-images). Created automatically if it does not exist.",
  }, "~/hf-images")
  .build();
