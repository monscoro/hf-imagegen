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
    .field("exampleDirectivePicker", "select", {
    displayName: "Neigungsprompt-Katalog",
    subtitle: "Kuratierte Beispiele (Neigungsprompt, synonym Stimmungsprompt / Beeinflussungsprompt) – List-Button zum Auswählen. Nach Klick erscheint der Prompt im Textfeld direkt darunter – direkt editierbar und speicherbar. Format pro Eintrag (Leerzeile oder --- getrennt): Zeile 1: \"name: Kurzbeschreibung [ro|rw]\" | Zeile 2..n: Prompt. Flag [ro]=read-only (LLM kann nicht ändern, default), [rw]=RW (LLM darf via inclination_prompt_manage ändern). Quelle: src/curatedDirectives.ts (nur Beispiele, 5 Stück). Vollständige Liste via Tool inclination_prompt_list. Nach Auswahl per Copy in das Feld darunter übernehmen.",
    options: [
        { value: "none", displayName: "— bitte wählen —" },
        { value: "pose-action", displayName: "pose-action – Pose/Action dynamisch" },
        { value: "interaction", displayName: "interaction – Interaktion subtil" },
        { value: "setting", displayName: "setting – Ort als Erzähler" },
        { value: "narrative", displayName: "narrative – Moment vor Entscheidung" },
        { value: "camera-intimate", displayName: "camera-intimate – Kameratechnik intim" },
    ],
}, "none")
    .field("customDirectives", "string", {
    displayName: "Prompt",
    subtitle: "Textfeld direkt unter dem Katalog – zeigt nach Selektion den aktuellen Neigungsprompt (synonym Stimmungsprompt / Beeinflussungsprompt) – editierbar. Wird als aktives Inclination-Profil via inclination_prompt_set verwendet.",
    isParagraph: true,
}, "")
    .build();
