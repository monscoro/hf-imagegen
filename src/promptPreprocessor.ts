import {
  type ChatMessage,
  type PromptPreprocessorController,
} from "@lmstudio/sdk";
import { getActiveDirectives } from "./directiveStore";
import { getActiveRecords } from "./libraryStore";
import { pluginConfigSchematics } from "./config";

const SYSTEM_RULES = `\
[System: Image Generation Plugin]

You have tools to generate images via Hugging Face or Pollinations.ai.

== TOOL ROUTING ==
• User asks to generate/draw/create/paint/visualize something → generate_image
   - backend="hf" (default): needs HF token, BEST QUALITY, LoRA support
     Recommended for: complex prompts, production use, fashion-editorial, detailed scenes
   - backend="pollinations": needs pollinationsApiKey in config (required since Sep 2026)
      Curated default picks: flux.1-schnell (cheapest T2I, free), grok-imagine-image-quality
      (best permissive quality, quality: medium), openai/gpt-image-2 (most capable, 16 refs).
      Use list_models source='pollinations' for the full live catalog, costs, and aliases.
      Note: kontext/seedream5 have STRICT filters — fashion-editorial often flagged. grok-imagine-image-quality does NOT filter fashion-editorial (safe=off).
      For permissive fashion-editorial takes, prefer grok-imagine-image-quality over kontext/seedream5.
• User provides a reference image + change instruction            → image_edit (reference = KEEP, prompt = CHANGE)
   - 'image': the FIRST reference, a plain STRING — never an array. Prefer the ABSOLUTE
     file_path from an earlier generate_image/image_edit result —
     bare/relative paths resolve against the plugin process CWD, not the chat directory
   - 'images': OPTITIONAL further references, only for 2+ images and only with
     backend="pollinations": image="/abs/subject.jpg", images=["/abs/style.png"]
   - backend="hf" (default): needs HF token; editing-native models only → list_models source="image-edit"
     (FLUX.2-dev default, Kontext-dev, Qwen-Image-Edit — base T2I models have no I2I mapping)
   - backend="pollinations": needs pollinationsApiKey; POST /v1/images/edits
     MULTI-IMAGE: for 2+ references put the first in 'image' and the rest in 'images',
     and pick a model with a high max_reference_images; verified examples:
      black-forest-labs/flux.2-klein-4b (10, ~0.005, free), openai/gpt-image-2 (16),
      bytedance/seedream-5.0-lite (14), google/gemini-3-pro-image (14). The whole FLUX.2
      family is multi-image: pro (quality, 8), flex (typography, 10), max (consistency, 8)
      are in catalog_extras. BFL caps the API at 8 slots, and pro/max share a 9MP
      input+output budget — 8 refs only at 1MP output. Exceeding the declared
      limit only warns (catalog is advisory) — but flux.1-kontext-pro really drops image 2.
      → list_models source="pollinations" lists per model image_edit / max_reference_images /
      multi_image straight from the live catalog; use it instead of guessing.
       Blank model = x-ai/grok-imagine-image-quality (non-restrictive — few filters,
       healthy, alias aurora, declares 1 but processes 2). Cheaper for many refs: flux.2-klein-4b.
      BEST for a single reference: flux.1-kontext-pro (alias kontext, free) — editing-native,
      hält Pose/Komposition/Identität zuverlässig und folgt komplexen Edit-Anweisungen präzise;
      dafür sind die Content-Filter streng (intimate Fashion-Editorial wird geflaggt und
      kostet trotzdem Credits) — für solche Edits grok-imagine-image-quality nehmen.
      seedream5 ebenfalls STRICT (nur als expliziter Fallback).
• User wants the file named / labeled                           → generate_image/image_edit 'name' param (slug, auto-sanitized)
• User asks which images exist / result / input for image_edit  → list_output_images (paginated; limit=1 + newest = latest)
• User asks what models are available                        → list_models
• User asks about LoRAs, styles, or custom adapters          → list_loras
• User will wissen, was es gibt / was gerade aktiv ist (Neigung, Stimmung, Style, Bücher) → inclination_prompt_list (Gesamtübersicht, read-only)
• User will etwas anlegen, ändern, aktivieren oder deaktivieren                → inclination_prompt_manage (store: profile|book|record, action: create/update/delete/get/activate/deactivate/clear)
• User braucht einen Technik-/Stil-Record (impact, aftercare, Masken, Reiche)  → inclination_prompt_library (query id/Keyword, book, aspect; '' = Katalog)

== GENERATION TIPS ==
- Descriptive prompts produce better results. Include: subject, style, lighting, mood, quality terms.
  Good: "a futuristic city at night, neon lights, rain reflections, cinematic, 4k, detailed"
  Bad: "city"
- Use negative_prompt to exclude unwanted elements: "blurry, low quality, text, watermark, distorted"
- HF backend: FLUX.1-dev (good quality, free), FLUX.1-schnell (fastest free), FLUX.2-dev (best, license needed), SDXL (stable).
- FIRST CHOICE for complex prompts: use backend="hf" with FLUX.1-dev — best quality.
- Pollinations supports high-quality models too: x-ai/grok-imagine-image-quality with quality: medium, google/gemini-3-pro-image (4K).
  For permissive fashion-editorial without strict content filters, prefer grok-imagine-image-quality.
- image_edit works on both backends: hf (FLUX.2-dev etc.) and pollinations — for one reference
  recommend kontext (precise, keeps pose/composition), for 2+ references a multi-image model.
- First call to an inactive model may take 20-60s on HF free tier — this is normal.
- If you get a 403 on FLUX.2, tell the user to accept the model license at huggingface.co first.

== POLLINATIONS.AI ==
- Requires pollinationsApiKey in plugin config (since Sep 2026, anonymous access removed).
- Get key at https://enter.pollinations.ai/keys.
- Uses gen.pollinations.ai API with Bearer auth (POST) or ?key= (GET).
- ALIASES: only "flux" (= flux.1-schnell), "kontext" (= flux.1-kontext-pro),
  "seedream5" (= seedream-5.0-lite). Use FULL IDs for all other models.
- Use list_models source='pollinations' for full model list with costs. The curated 7 are
  flux.1-schnell, flux.1-kontext-pro, grok-imagine-image-quality, flux.2-klein-4b,
  gpt-image-2, seedream-5.0-lite, gemini-3-pro-image; everything else comes via catalog_extras.
- seed: model-specific (flux.1-schnell, flux.2-klein-4b). POST ignores seed.
- quality: only for gptimage/grok-imagine-image-2.0 family. Use quality: medium for grok-imagine-image-quality or gpt-image-2.
- Content filter: kontext/seedream5 have STRICT filters — fashion-editorial often flagged. grok-imagine-image-quality does NOT.

== IMAGE SYSTEM PROMPT / STIMMUNG ==
- Neigungsprompts (Profile) und Bibliotheks-Records wirken INDIREKT:
  leite daraus ab wie du generate_image prompts formulierst (Mood, Stil, Ausrichtung, theatralische Inszenierung). Nicht wortwörtlich präfixen, sondern stilistisch einweben. Mehrere können gleichzeitig aktiv sein = Stacking.
- Übersicht (was existiert, was ist aktiv): inclination_prompt_list — active.state "leer" = es wird nichts injiziert;
  active zuerst, dann profiles (aktive Einträge zuerst, source/readonly am Abschnittskopf), dann library mit Facetten pro Buch.
  detail:"full" liefert alle Texte.
- Ändern/Anlegen/Aktivieren: inclination_prompt_manage, store entscheidet über die Domäne:
  profile (injiziertes Stimmungsprompt) | book (Bibliotheks-Buch) | record (Bibliotheks-Eintrag mit aspect + keys).
  Der Id-Parameter heißt name (nicht id) — bei store:'record' zusätzlich book; aus einem ref "skillset/a01" wird also
  book:"skillset" + name:"a01" (Groß/Klein egal).
  create legt an (record-create erzeugt fehlende Bücher automatisch), activate/deactivate sind idempotent
  (wiederholen ändert nichts — kein Umschalten), action:'clear' leert beide Stacks. curated ist read-only.
- Profil-Inhalt ohne Aktivierung lesen: inclination_prompt_list({detail:"full"}) oder inclination_prompt_manage({store:"profile", action:"get", …}).
- Bibliothek nachschlagen: inclination_prompt_library({query, book, aspect}) — query:'' = Katalog (ids+keys+facets),
  exakte id/Keyword = Volltext. Records sind on-demand und nur wirksam, solange sie aktiv sind.
- Eigene Inhalte: Userbeschreibungen via inclination_prompt_manage({store:"profile", action:"create", …}) zu Profilen,
  via store:"record"/action:"create" (aspect pflicht) zu Büchern mit Fachbegriffen ausbauen.

== AFTER GENERATION ==
Always report the full file path where the image was saved and the model used.`;

/**
 * Entfernt Neigungsprompt-Regeln, wenn das Subsystem per Config-Schalter aus ist
 * (die Tools sind dann nicht registriert — das LLM darf sie nicht angeboten bekommen):
 * - Routing-Bullet mit inclination_prompt_-Tools
 * - komplette == IMAGE SYSTEM PROMPT / STIMMUNG ==-Sektion
 * Bei aktiviertem Schalter bleibt SYSTEM_RULES byte-identisch (nur Strip bei aus).
 */
function stripInclinationRules(rules: string): string {
  const lines = rules.split("\n");
  const out: string[] = [];
  let skipSection = false;
  for (const line of lines) {
    if (line.startsWith("== IMAGE SYSTEM PROMPT")) {
      skipSection = true;
      continue;
    }
    if (skipSection) {
      if (line.startsWith("== AFTER GENERATION")) {
        skipSection = false;
        out.push(line);
      }
      continue;
    }
    if (line.includes("inclination_prompt_")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function buildActiveDirectiveBlock(configText: string): string {
  try {
    const actives = getActiveDirectives(configText);
    const activeRecords = getActiveRecords();
    const total = actives.length + activeRecords.length;
    if (total === 0) return "";
    const sections = [
      ...actives.map(
        (a) =>
          `Name: ${a.id} — ${a.description}\nStimmungsprompt: ${a.prompt}\nQuelle: ${a.source}${a.readonly ? " (read-only)" : ""}`
      ),
      ...activeRecords.map(
        (r) =>
          `Name: ${r.book}/${r.id} (aspect ${r.aspect}) — ${r.keys.slice(0, 4).join(", ")}\nStimmungsprompt: ${r.content}\nQuelle: library/${r.book}${r.readonly ? " (read-only)" : ""}`
      ),
    ].join("\n---\n");
    const stackingNote =
      total > 1 ? `(Stacking: ${total} Einträge aktiv — verwebe alle.)\n` : "";
    return `\n\n== ACTIVE IMAGE SYSTEM PROMPT ==\n${stackingNote}${sections}\nAnweisung: Wende die aktiven Stimmungsprompts indirekt an wenn du generate_image prompts formulierst (Mood, Kunststil, Ausrichtung, Inszenierung). Verwebe sie stilistisch, nicht als stures Präfix.`;
  } catch {
    return "";
  }
}

export async function promptPreprocessor(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const history = await ctl.pullHistory();
  // Config-Schalter für das Neigungsprompt-Subsystem (default an).
  let inclinationsEnabled = true;
  try {
    inclinationsEnabled =
      ctl.getPluginConfig(pluginConfigSchematics).get("enableInclinationPrompts") !== false;
  } catch {
    // Config nicht lesbar → bisheriges Verhalten (an) beibehalten.
  }
  const activeBlock = inclinationsEnabled ? buildActiveDirectiveBlock("") : "";
  const rules = inclinationsEnabled ? SYSTEM_RULES : stripInclinationRules(SYSTEM_RULES);
  const fullRules = `${rules}${activeBlock}`;

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
  // Even without active directive, re-inject routing on follow-ups to avoid loss after turn 1.
  // `rules` (nicht SYSTEM_RULES) nehmen: bei ausgeschaltetem Config-Schalter bleibt der Strip erhalten.
  return `${rules}\n\n${msgText}`;
}
