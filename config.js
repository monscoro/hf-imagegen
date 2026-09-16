"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluginConfigSchematics = void 0;
const sdk_1 = require("@lmstudio/sdk");
exports.pluginConfigSchematics = (0, sdk_1.createConfigSchematics)()
    .field("hfApiToken", "string", {
    displayName: "HuggingFace API Token",
    subtitle: "Your Hugging Face access token from huggingface.co/settings/tokens. " +
        "Required for image generation. Use a token with at least 'read' scope.",
}, "")
    .field("defaultModel", "string", {
    displayName: "Default Model",
    subtitle: "HuggingFace model ID for text-to-image generation. " +
        "Examples: black-forest-labs/FLUX.1-schnell, black-forest-labs/FLUX.1-dev, " +
        "stabilityai/stable-diffusion-xl-base-1.0. Use list_models tool to see all options.",
}, "black-forest-labs/FLUX.1-schnell")
    .field("outputDirectory", "string", {
    displayName: "Output Directory",
    subtitle: "Directory where generated images are saved. " +
        "Use ~ for home directory (e.g. ~/hf-images). Created automatically if it does not exist.",
}, "~/hf-images")
    .field("rateLimitCooldown", "numeric", {
    displayName: "Generation Cooldown (ms)",
    subtitle: "Minimum milliseconds between image generations. " +
        "Prevents rapid credit consumption. Default: 5000 (5 seconds).",
}, 5000)
    .field("rateLimitDailyCap", "numeric", {
    displayName: "Daily Generation Limit",
    subtitle: "Maximum number of images that can be generated per day. " +
        "Resets at midnight. Default: 50.",
}, 50)
    .field("customDirectives", "string", {
    displayName: "Eigene Stimmungsprompts (Profile)",
    subtitle: "Eigene ImageGen-Stimmungsprompts – leicht selbst zu schreiben/warten. Format pro Eintrag (Leerzeile oder --- getrennt): " +
        "Zeile 1: \"name: Kurzbeschreibung [ro|rw]\"  |  Zeile 2..n: Stimmungsprompt. " +
        "Flag [ro] = read-only (LLM kann nicht ändern, default), [rw] = RW (LLM darf via manage_image_directive ändern). " +
        "Beispiel:\n" +
        "my-cinematic: Episch-kinoreif, dramatisch [ro]\n" +
        "cinematic volumetric lighting, 35mm film, dramatic shadows\n\n" +
        "my-test: Zum Experimentieren [rw]\n" +
        "dreamy pastel haze, soft pink\n\n" +
        "Vordefinierte Beispiele (curated, read-only) liefert das Plugin via list_image_directives – nur Beispiele, nicht editierbar.",
    isParagraph: true,
}, "")
    .build();
