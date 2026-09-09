import {
  type ChatMessage,
  type PromptPreprocessorController,
} from "@lmstudio/sdk";

const SYSTEM_RULES = `\
[System: Image Generation Plugin]

You have tools to generate images via Hugging Face.

== TOOL ROUTING ==
• User asks to generate/draw/create/paint/visualize something → generate_image
• User asks what models are available                        → list_models
• User asks about LoRAs, styles, or custom adapters          → list_loras

== GENERATION TIPS ==
- Descriptive prompts produce better results. Include: subject, style, lighting, mood, quality terms.
  Good: "a futuristic city at night, neon lights, rain reflections, cinematic, 4k, detailed"
  Bad: "city"
- Use negative_prompt to exclude unwanted elements: "blurry, low quality, text, watermark, distorted"
- FLUX.1-schnell / FLUX.2-klein: fastest free options. SDXL: photorealistic, stable, free.
- First call to an inactive model may take 20-60s on HF free tier — this is normal.
- If you get a 403 on FLUX.1, tell the user to accept the model license at huggingface.co first.

== AFTER GENERATION ==
Always report the full file path where the image was saved and the model used.`;

export async function promptPreprocessor(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const history = await ctl.pullHistory();
  if (history.length === 0) {
    if (await ctl.needsNaming()) {
      const text = userMessage.getText().trim();
      const name = text.length > 0 ? text.slice(0, 60).replace(/\s+/g, " ") : "Session";
      ctl.suggestName(name);
    }
    return `${SYSTEM_RULES}\n\n${userMessage.getText()}`;
  }
  return userMessage;
}
