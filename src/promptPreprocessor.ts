import {
  type ChatMessage,
  type PromptPreprocessorController,
} from "@lmstudio/sdk";
import { getActiveDirective } from "./directiveStore";

const SYSTEM_RULES = `\
[System: Image Generation Plugin]

You have tools to generate images via Hugging Face or Pollinations.ai.

== TOOL ROUTING ==
• User asks to generate/draw/create/paint/visualize something → generate_image
  - backend="hf" (default): needs HF token, BEST QUALITY, LoRA support
    Recommended for: complex prompts, production use, fashion-editorial, detailed scenes
  - backend="pollinations": needs pollinationsApiKey in config (required since Sep 2026)
    LOWER QUALITY than HF — use for testing/quick iterations
    ALIASES: only "flux" (= flux.1-schnell), "kontext" (= flux.1-kontext-pro),
    "seedream5" (= seedream-5.0-lite). Use FULL IDs for all other models.
    FREE: flux.1-schnell, flux.1-kontext-pro, flux.2-klein-4b, z-image-turbo.
    PAID (cost pollen — USE FREELY, user has balance):
          flux.2-pro (~0.034), grok-imagine-image-2.0 (~0.07), ideogram-v4-turbo (~0.03),
          wan-2.7-image (~0.03), qwen-image-3 (~0.04), gemini-3.1-flash-image (~0.07).
    Content filter: kontext/seedream5 flag fashion-editorial as "Sexual_Prompt".
    DECISION: Choose BEST model for task, not cheapest. User WANTS paid models for quality.
• User provides a reference image + change instruction            → image_edit (HF only; reference = KEEP, prompt = CHANGE; suitable models → list_models source="image-edit")
• User asks which images exist / wants the latest result        → list_output_images (paginated; limit=1 + newest = latest)
• User asks what models are available                        → list_models
• User asks about LoRAs, styles, or custom adapters          → list_loras
• User asks about moods/styles, Neigung/Stimmung, Systemprompt→ inclination_prompt_list / inclination_prompt_set / inclination_prompt_manage

== GENERATION TIPS ==
- Descriptive prompts produce better results. Include: subject, style, lighting, mood, quality terms.
  Good: "a futuristic city at night, neon lights, rain reflections, cinematic, 4k, detailed"
  Bad: "city"
- Use negative_prompt to exclude unwanted elements: "blurry, low quality, text, watermark, distorted"
- HF backend: FLUX.1-dev (good quality, free), FLUX.1-schnell (fastest free), FLUX.2-dev (best, license needed), SDXL (stable).
- FIRST CHOICE for complex prompts: use backend="hf" with FLUX.1-dev — best quality.
- Pollinations is for quick tests only — quality is lower than HF for detailed scenes.
- First call to an inactive model may take 20-60s on HF free tier — this is normal.
- If you get a 403 on FLUX.2, tell the user to accept the model license at huggingface.co first.

== POLLINATIONS.AI ==
- Requires pollinationsApiKey in plugin config (since Sep 2026, anonymous access removed).
- Get key at https://enter.pollinations.ai/keys.
- Uses gen.pollinations.ai API with Bearer auth (POST) or ?key= (GET).
- LOWER QUALITY than HF — use for quick tests, not production.
- ALIASES: only "flux" (= flux.1-schnell), "kontext" (= flux.1-kontext-pro),
  "seedream5" (= seedream-5.0-lite). Use FULL IDs for all other models.
- FREE: flux.1-schnell, flux.1-kontext-pro, flux.2-klein-4b, z-image-turbo.
- PAID (cost pollen — USE FREELY, user has balance and expects quality):
  flux.2-pro (~0.034), grok-imagine-image-2.0 (~0.07), ideogram-v4-turbo (~0.03),
  wan-2.7-image (~0.03), qwen-image-3 (~0.04), gemini-3.1-flash-image (~0.07).
- RECOMMENDED: flux.2-pro or grok-imagine-image-2.0 for best quality (PAID).
- seed: model-specific (flux.1-schnell, z-image-turbo, seedream-4.0, flux.2-klein-4b). POST ignores seed.
- quality: only for gptimage/grok-imagine-image-2.0 family.
- Content filter: kontext/seedream5 have STRICT filters — fashion-editorial often flagged.

== IMAGE SYSTEM PROMPT / STIMMUNG ==
- Ein aktiver Neigungsprompt (Stimmungsprompt / Beeinflussungsprompt, synonym) soll INDIREKT wirken: leite daraus ab wie du generate_image prompts formulierst
  (Mood, Stil, Ausrichtung, theatralische Inszenierung). Nicht wortwörtlich präfixen, sondern stilistisch einweben.
- Eigene Prompts: Userbeschreibungen in vollständige Neigungsprompts umwandeln via inclination_prompt_manage(action:create).
  LLM generiert automatisch passende id, description und prompt.
- Aktivierung/Deaktivierung: inclination_prompt_set({name}). Liste: inclination_prompt_list.

== AFTER GENERATION ==
Always report the full file path where the image was saved and the model used.`;

function buildActiveDirectiveBlock(configText: string): string {
  try {
    const active = getActiveDirective(configText);
    if (!active) return "";
    return `\n\n== ACTIVE IMAGE SYSTEM PROMPT ==\nName: ${active.id} — ${active.description}\nStimmungsprompt: ${active.prompt}\nAnweisung: Wende diesen Stil/Mood indirekt an wenn du generate_image prompts formulierst (Mood, Kunststil, Ausrichtung, Inszenierung). Verwebe ihn stilistisch, nicht als stures Präfix. Quelle: ${active.source}${active.readonly ? " (read-only)" : ""}.`;
  } catch {
    return "";
  }
}

export async function promptPreprocessor(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const history = await ctl.pullHistory();
  const activeBlock = buildActiveDirectiveBlock("");
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
    return `${fullRules}\n\n${msgText}`;
  }
  // Even without active directive, re-inject routing on follow-ups to avoid loss after turn 1
  return `${SYSTEM_RULES}\n\n${msgText}`;
}
