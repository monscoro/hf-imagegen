import {
  type ChatMessage,
  type PromptPreprocessorController,
} from "@lmstudio/sdk";
import { getActiveDirective } from "./directiveStore";

const SYSTEM_RULES = `\
[System: Image Generation Plugin]

You have tools to generate images via Hugging Face.

== TOOL ROUTING ==
• User asks to generate/draw/create/paint/visualize something → generate_image (backend="hf" default, needs token; backend="pollinations" needs no token, filter off — use list_models source="pollinations" for its models)
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
- FLUX.1-dev: good quality, free via Inference Providers. FLUX.1-schnell: fastest free. FLUX.2-dev: best quality, requires license. SDXL: photorealistic, stable.
- First call to an inactive model may take 20-60s on HF free tier — this is normal.
- If you get a 403 on FLUX.2, tell the user to accept the model license at huggingface.co first.

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
