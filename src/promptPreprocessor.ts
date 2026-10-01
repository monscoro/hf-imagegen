import {
  type ChatMessage,
  type PromptPreprocessorController,
} from "@lmstudio/sdk";
import { getActiveDirectives, bindActiveScope as bindProfileScope } from "./directiveStore";
import { getActiveRecords, bindActiveScope as bindRecordScope } from "./libraryStore";
import { resolveWorkingDirKey, setPredictionScopeKey, NO_WORKING_DIR_KEY } from "./workspace";
import { isBallerinaBook, isBallerinaProfile } from "./curatedLibrary";
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
• User asks which images exist / result / input for image_edit  → list_image_directory (paginated; limit=1 + newest = latest; 'directories' for folders outside the output dir)
• User wants a still image animated into a video clip         → generate_video (image = start frame, motion or cuts; backend pollinations (default, tiers) or hf (token, model defaults))
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
- COST vs CAPABILITY (Pollinations bills FLAT per image — size never saves money): cheap models fail complex scenes, and a failed cheap call + retry costs MORE than one capable call. flux.1-schnell = simple/fast drafts only; multi-figure choreography, fine hands, dense fashion-editorial need FLUX.1-dev (hf), grok-imagine-image-quality or gpt-image-2. Every result reports 'estimated_cost' — budget sets before rendering.
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
- Neigungsprompts (Profile) und Bibliotheks-Records wirken INDIREKT und per scope: scope "image" (Default) gilt NUR für Standbilder —
  leite daraus ab wie du generate_image/image_edit/compose_images prompts formulierst (Mood, Stil, Ausrichtung, theatralische Inszenierung). Nicht wortwörtlich präfixen, sondern stilistisch einweben. Mehrere können gleichzeitig aktiv sein = Stacking.
  Für generate_video (motion/cuts) gelten Image-Einträge NICHT: motion beschreibt nur Kamera- + Subjektbewegung des Startframes, keine Still-Fotografie-Begriffe (Lens, DOF, Bokeh, Grain, etc.) übernehmen. Ausnahme: Einträge mit scope "video"/"both" stehen im separaten VIDEO-Block und sind motion-safe formuliert.
- Übersicht (was existiert, was ist aktiv): inclination_prompt_list — active.state "leer" = es wird nichts injiziert;
  active zuerst, dann profiles (aktive Einträge zuerst, source/readonly am Abschnittskopf), dann library mit Facetten pro Buch.
  detail:"full" liefert alle Texte.
  Startzustand ist IMMER leer: es ist kein Stimmungsprompt vorausgewählt, auch nicht aus früheren Chats. Aktivieren musst du selbst.
  Der aktive Stack hängt am Working Dir des Chats und gilt NUR dort — in einem anderen Verzeichnis ist wieder nichts aktiv.
  scope.applied = false (Chat ohne Arbeitsverzeichnis) heißt: Einträge werden gespeichert, aber NICHT injiziert —
  aktuell wirkt nichts, unabhängig davon wie viele Profile aktiv gemeldet werden. active.state steht dann auf "gespeichert, nicht aktiv".
  Ein nicht wirksamer Stack ist kein Fehler und braucht kein deactivate; er wird aktiv, sobald der Chat ein Working Dir hat.
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

/** Scope-Split: "both" steht in beiden Bloecken (muss motion-safe formuliert sein). */
function buildActiveDirectiveBlock(
  configText: string,
  includeBallerina = true,
  videoEnabled = true
): string {
  try {
    const rawActives = getActiveDirectives(configText);
    const rawRecords = getActiveRecords();
    // Experiment-Schalter aus: Ballerina-Eintraege wirken wie nicht aktiv
    // (Stack bleibt gespeichert und lebt bei Re-Enable wieder auf).
    const actives = includeBallerina ? rawActives : rawActives.filter((a) => !isBallerinaProfile(a.id));
    const activeRecords = includeBallerina ? rawRecords : rawRecords.filter((r) => !isBallerinaBook(r.book));
    const isVideo = (s?: string) => s === "video" || s === "both";
    const isImage = (s?: string) => s !== "video";
    // Video aus: der Choreografie-Block waere eine Einladung an ein Tool, das
    // dann nicht registriert ist. Scope "video" faellt ersatzlos weg, "both"
    // bleibt als Bild-Eintrag erhalten.
    const imageProfiles = actives.filter((a) => isImage(a.scope));
    const imageRecords = activeRecords.filter((r) => isImage(r.scope));
    const videoAll = videoEnabled
      ? {
          profiles: actives.filter((a) => isVideo(a.scope)),
          records: activeRecords.filter((r) => isVideo(r.scope)),
        }
      : { profiles: [], records: [] };
    // "both" steht bereits vollstaendig im Bild-Block. Im Video-Block genuegt
    // der Verweis — sonst steht jeder Text zweimal wortgleich im Prompt (bei
    // aktivem Ballerina-Set 15 Records, ~70 Woerter das). "video"-eigene
    // Eintraege kommen nur hier vor und brauchen den Volltext.
    const videoOnlyProfiles = videoAll.profiles.filter((a) => a.scope === "video");
    const videoOnlyRecords = videoAll.records.filter((r) => r.scope === "video");
    const bothProfiles = videoAll.profiles.filter((a) => a.scope === "both");
    const bothRecords = videoAll.records.filter((r) => r.scope === "both");
    const imageTotal = imageProfiles.length + imageRecords.length;
    const videoTotal = videoAll.profiles.length + videoAll.records.length;
    if (imageTotal === 0 && videoTotal === 0) return "";
    const fmtProfile = (a: (typeof actives)[number]) =>
      `Name: ${a.id} — ${a.description}\nStimmungsprompt: ${a.prompt}\nQuelle: ${a.source}${a.readonly ? " (read-only)" : ""}${a.scope ? ` (scope ${a.scope})` : ""}`;
    const fmtRecord = (r: (typeof activeRecords)[number]) =>
      `Name: ${r.book}/${r.id} (aspect ${r.aspect}) — ${r.keys.slice(0, 4).join(", ")}\nStimmungsprompt: ${r.content}\nQuelle: library/${r.book}${r.readonly ? " (read-only)" : ""}${r.scope ? ` (scope ${r.scope})` : ""}`;
    // Kurzform fuer scope="both": Identitaet + Ort des Volltexts. "Keys" bzw.
    // Stimmungsprompt fehlen bewusst — der Verweis traegt die Information.
    const fmtProfileRef = (a: (typeof actives)[number]) =>
      `Name: ${a.id} — ${a.description} (Stimmungsprompt: siehe IMAGE-Block, scope ${a.scope})`;
    const fmtRecordRef = (r: (typeof activeRecords)[number]) =>
      `Name: ${r.book}/${r.id} (aspect ${r.aspect}) — ${r.keys.slice(0, 4).join(", ")} (Stimmungsprompt: siehe IMAGE-Block, scope ${r.scope})`;
    let out = "";
    if (imageTotal > 0) {
      const sections = [...imageProfiles.map(fmtProfile), ...imageRecords.map(fmtRecord)].join("\n---\n");
      const stackingNote = imageTotal > 1 ? `(Stacking: ${imageTotal} Einträge aktiv — verwebe alle.)\n` : "";
      // Der motion-Satz hat nur Sinn, solange es generate_video gibt UND
      // unten tatsaechlich ein VIDEO-Block entsteht — sonst verweist er auf
      // etwas, das nicht da ist. (videoTotal>0 deckt beide Faelle ab.)
      const motionNote =
        videoEnabled && videoTotal > 0
          ? " Einträge mit scope 'video'/'both' sind unten im VIDEO-Block separat für motion/cuts aufgeführt — dort gelten sie als Bewegungsbeschreibung. Alle scope 'image'-Einträge bleiben Standbilder."
          : "";
      out += `\n\n== ACTIVE IMAGE SYSTEM PROMPT ==\n${stackingNote}${sections}\nAnweisung: Wende die aktiven Stimmungsprompts indirekt an wenn du generate_image/image_edit/compose_images prompts formulierst (Mood, Kunststil, Ausrichtung, Inszenierung). Verwebe sie stilistisch, nicht als stures Präfix.${motionNote}`;
    }
    if (videoTotal > 0) {
      const sections = [
        ...videoOnlyProfiles.map(fmtProfile),
        ...videoOnlyRecords.map(fmtRecord),
        ...bothProfiles.map(fmtProfileRef),
        ...bothRecords.map(fmtRecordRef),
      ].join("\n---\n");
      const stackingNote = videoTotal > 1 ? `(Stacking: ${videoTotal} Einträge aktiv — verwebe alle.)\n` : "";
      // "nur diese" waere wieder unbedingt und widersprueche dem IMAGE-Block:
      // die Verweise zaehlen mit, gelten aber inhaltlich nur fuer motion.
      // Der IMAGE-Block kann fehlen (rein scope-"video"-Eintraege) — dann darf
      // hier nicht auf ihn verwiesen werden.
      const bothRef =
        imageTotal > 0
          ? " — auch die im IMAGE-Block referenzierten (scope 'both')"
          : "";
      out += `\n\n== ACTIVE VIDEO CHOREOGRAPHY ==\n${stackingNote}${sections}\nAnweisung: Diese Einträge${bothRef} färben generate_video motion/cuts, als reine Bewegungsbeschreibung (Kamera + Subjekt, durationsskaliert). Übernehme daraus keine Still-Fotografie-Begriffe, Komposition oder Bildstil; die motion entsteht aus dem Startframe, nicht aus diesen Texten.`;
    }
    return out;
  } catch {
    return "";
  }
}

export async function promptPreprocessor(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  // Der aktive Stack haengt am Working Dir des Chats. Muss VOR jedem Lesen
  // passieren — sonst wuerde ein Turn im Verzeichnis B die Prompts aus A
  // weiterinjizieren, weil der Modul-Cache noch auf A steht.
  // setPredictionScopeKey macht den Key zudem fuer die Inclination-Tools
  // verfuegbar: der SDK gibt ihnen den Working Dir nicht mit (workspace.ts).
  const scopeKey = resolveWorkingDirKey(ctl);
  setPredictionScopeKey(scopeKey);
  bindProfileScope(ctl);
  bindRecordScope(ctl);
  // (none)-Bucket: es gibt kein Working Dir, an das die Aktivierung gehoerte.
  // Die Stack-Datei wird gefuehrt (die Tools melden sie), aber nicht angewandt —
  // sonst stunde in einem Chat ohne Ordner dauerhaft ein Prompt, den niemand
  // fuer diesen Kontext aktiviert hat.
  const hasScope = scopeKey !== NO_WORKING_DIR_KEY;
  const history = await ctl.pullHistory();
  // Config-Schalter für das Neigungsprompt-Subsystem (default an).
  let inclinationsEnabled = true;
  // Config-Schalter für Video (default an): ohne generate_video kein Routing.
  let videoEnabled = true;
  // Experiment-Schalter fürs Ballerina-Lorebook (default an).
  let ballerinaEnabled = true;
  try {
    const cfg = ctl.getPluginConfig(pluginConfigSchematics);
    inclinationsEnabled = cfg.get("enableInclinationPrompts") !== false;
    videoEnabled = cfg.get("enableVideo") !== false;
    ballerinaEnabled = cfg.get("enableBallerinaLorebook") !== false;
  } catch {
    // Config nicht lesbar → bisheriges Verhalten (an) beibehalten.
  }
  const activeBlock =
    inclinationsEnabled && hasScope ? buildActiveDirectiveBlock("", ballerinaEnabled, videoEnabled) : "";
  let rules = inclinationsEnabled ? SYSTEM_RULES : stripInclinationRules(SYSTEM_RULES);
  if (!videoEnabled) {
    // Video-Routing raus (Tool ist dann nicht registriert) — eine Zeile,
    // kein Sektions-Strip noetig.
    rules = rules
      .split("\n")
      .filter((line) => !line.includes("generate_video"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
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
