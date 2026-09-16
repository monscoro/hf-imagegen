"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptPreprocessor = promptPreprocessor;
const config_1 = require("./config");
const directiveStore_1 = require("./directiveStore");
const SYSTEM_RULES = `\
[System: Image Generation Plugin]

You have tools to generate images via Hugging Face.

== TOOL ROUTING ==
• User asks to generate/draw/create/paint/visualize something → generate_image
• User asks what models are available                        → list_models
• User asks about LoRAs, styles, or custom adapters          → list_loras
• User asks about moods/styles, Stimmung, Systemprompt       → list_image_directives / set_image_system_prompt / manage_image_directive

== GENERATION TIPS ==
- Descriptive prompts produce better results. Include: subject, style, lighting, mood, quality terms.
  Good: "a futuristic city at night, neon lights, rain reflections, cinematic, 4k, detailed"
  Bad: "city"
- Use negative_prompt to exclude unwanted elements: "blurry, low quality, text, watermark, distorted"
- FLUX.1-schnell / FLUX.2-klein: fastest free options. SDXL: photorealistic, stable, free.
- First call to an inactive model may take 20-60s on HF free tier — this is normal.
- If you get a 403 on FLUX.1, tell the user to accept the model license at huggingface.co first.

== IMAGE SYSTEM PROMPT / STIMMUNG ==
- Ein aktiver Stimmungsprompt (siehe unten) soll INDIREKT wirken: leite daraus ab wie du generate_image prompts formulierst
  (Mood, Stil, Ausrichtung, theatralische Inszenierung). Nicht wortwörtlich präfixen, sondern stilistisch einweben.
- Nutze list_image_directives um verfügbare Profile zu sehen, set_image_system_prompt zum Aktivieren.

== AFTER GENERATION ==
Always report the full file path where the image was saved and the model used.`;
function buildActiveDirectiveBlock(configText) {
    try {
        const active = (0, directiveStore_1.getActiveDirective)(configText);
        if (!active)
            return "";
        return `\n\n== ACTIVE IMAGE SYSTEM PROMPT ==\nName: ${active.id} — ${active.description}\nStimmungsprompt: ${active.prompt}\nAnweisung: Wende diesen Stil/Mood indirekt an wenn du generate_image prompts formulierst (Mood, Kunststil, Ausrichtung, Inszenierung). Verwebe ihn stilistisch, nicht als stures Präfix. Quelle: ${active.source}${active.readonly ? " (read-only)" : ""}.`;
    }
    catch {
        return "";
    }
}
async function promptPreprocessor(ctl, userMessage) {
    const history = await ctl.pullHistory();
    const cfg = ctl.getPluginConfig(config_1.pluginConfigSchematics);
    const customDirectivesText = (() => {
        try {
            return cfg.get("customDirectives");
        }
        catch {
            return "";
        }
    })();
    const activeBlock = buildActiveDirectiveBlock(customDirectivesText ?? "");
    const fullRules = `${SYSTEM_RULES}${activeBlock}`;
    if (history.length === 0) {
        if (await ctl.needsNaming()) {
            const text = userMessage.getText().trim();
            const name = text.length > 0 ? text.slice(0, 60).replace(/\s+/g, " ") : "Session";
            ctl.suggestName(name);
        }
        return `${fullRules}\n\n${userMessage.getText()}`;
    }
    // For follow-up turns, keep SYSTEM_RULES + active directive visible (otherwise LLM loses routing/guidelines)
    const msgText = userMessage.getText();
    if (activeBlock) {
        // activeBlock already contains fullRules prefix, but we ensure SYSTEM_RULES stays
        return `${fullRules}\n\n${msgText}`;
    }
    // Even without active directive, re-inject routing on follow-ups to avoid loss after turn 1
    return `${SYSTEM_RULES}\n\n${msgText}`;
}
