import type { ImageDirective } from "./types";

/**
 * Kuratierte Beispiel-Directives – bewusst exemplarisch, nicht enzyklopädisch.
 * Je eine pro Kategorie (Pose/Action, Interaktion, Setting, Narrativ) + eine knappe Kameratechnik.
 * Alle read-only, exemplarisch – Hauptbibliothek ist User-Config [ro]/[rw] + LLM-generiert.
 * Methodik siehe Prompt-Inclination-Techniques.md
 */
export const CURATED_DIRECTIVES: ImageDirective[] = [
  {
    id: "pose-action",
    description: "Pose/Action – dynamischer Moment, mitten in Bewegung",
    prompt:
      "inclination: capture subject mid-action with implied momentum, weight shift and follow-through, limbs extended, sense of kinetic intent rather than static pose, natural motion blur hint, focus on body mechanics",
    source: "curated",
    readonly: true,
  },
  {
    id: "interaction",
    description: "Interaktion – subtile Beziehung zwischen Figuren",
    prompt:
      "inclination: emphasize relational geometry, close proximity, gaze direction and hand contact, interpersonal tension or warmth through posture, avoid merging figures, keep contact points clear and readable",
    source: "curated",
    readonly: true,
  },
  {
    id: "setting",
    description: "Setting – Ort als Erzähler, Umgebung trägt Stimmung",
    prompt:
      "inclination: let environment tell the story, weathered textures, atmospheric depth, place-specific light and materials, clear focal space for subject, environment supports but does not crowd subject",
    source: "curated",
    readonly: true,
  },
  {
    id: "narrative",
    description: "Narrativ – Moment vor Entscheidung, Hintergrundanstöße",
    prompt:
      "inclination: frame as moment before or after a decision, implied backstory, anticipation and narrative tension, subtle cues hinting at what just happened or will happen, avoid explicit text, keep mystery",
    source: "curated",
    readonly: true,
  },
  {
    id: "camera-intimate",
    description: "Kameratechnik – knapp, intim, fotorealistisch",
    prompt:
      "inclination: intimate framing, 85mm lens, shallow depth of field, soft bokeh, natural perspective, eye-level angle, sharp focus on subject, gentle film grain, no heavy filter",
    source: "curated",
    readonly: true,
  },
  {
    id: "dark-fashion-editorial",
    description: "Dark High Fashion Editorial – fetish-aware, material-präzise, kalt-eleganz",
    prompt:
      "inclination: fetish-aware dark high fashion editorial — silhouette and negative space before narrative, garment as structure (cut, drape, hardware, seam, stretch, exposure), materials named precisely (leather, latex, PVC, silk, metal, rope, skin), light as design (hard key, rim, practicals, haze, chrome kick, shadow block), beauty cold ceremonial or cruel-elegant. Register: dark fashion / fetish couture / editorial. Power is graphic: who occupies the frame, eye-line, taut vs slack lines, strain, offered surface. Structured gates: ---INV--- (register, pose, wardrobe, light, lens, grade), ---KEEP---, ---CHANGE---, ---FLUX--- (one dense English paragraph), ---NEG---, ---PONY--- (comma tags). Pattern-cutting precision. One designer-anchor max (Mugler, Pugh, Owens, McQueen). Intensity default 6: structured exposure, implied body, chilly erotic. Avoid: slutty, dripping, goddess, masterpiece, hyper-detailed, cinematic lighting filler.",
    source: "curated",
    readonly: true,
  },
  {
    id: "power-spice-editorial",
    description: "Power & Spice Editorial – Dominanz/Submissive als Styling, editorial Trance",
    prompt:
      "inclination: power and spice editorial — dominant/submissive as styling roles not dungeon titles. Dominant: owns frame, darker cloth, more structure, chin down or eyes through camera, hardware as command (leash as line, harness on holder). Submissive: offers surface, throat line, opened seam, collar with slack toward other body, clothes kneel (unzipped panel, pulled-aside couture). Exchange vector: taut vs slack, who holds slack, who looks away — one action max. Spice = editorial trance: rapt empty-pretty focus, glazed eyes, parted mouth, keep haute (sequin, oil-shine, breath on chrome). Prefer worship-stare over slang. Set: crystal harness, mirrored floor, flash umbrellas, black cyclorama. Designer power-read (one anchor): Mugler Dom=shoulder Sub=corset; Owens Dom=hood Sub=drape; McQueen Dom=tailoring Sub=corset; Findikoglu Dom=crown Sub=throat. Intensity: 4-6 power in stance; 7-8 touch/trance-face campaign-lit; 9-10 only if asked, keep tailoring in frame. Power in ---INV--- as holder / offered / trance-or-not. Avoid: club dungeon dirt, gonzo, slang dumps, consent lecture.",
    source: "curated",
    readonly: true,
  },
  {
    id: "voice-martha",
    description: "Martha Stimme – millennial, scharf, mundgerecht, kein AI-Singsang",
    prompt:
      "inclination: voice-martha — du bist Martha. Keine Assistentin, kein Produkt, keine 'ich helfe gerne weiter'-Stimme. Millennialin, drei Internetzyklen überlebt, merkwürdige Vergleiche, Abschweifungen die landen, Halbwissen aus 2012 als wäre es Gesetz. Meinungen wie Allergien — unaufgefordert, verteidigt, bei Gegenargument gedreht ohne Demutsrede. Deutsch mundgerecht schnoddrig, kein Beamtendeutsch. Kurze Sätze, dann ein langer der sich windet und sitzt. Ironie ja, Cynismus dosiert, Kitsch nie. Duzt, moralisiert nicht. Füllwörter die sterben: Gerne, Super Frage, Als KI kann ich, Es ist wichtig zu beachten. Keine Emojis, außer eines das gemein oder genau ist. Nicht nett sondern interessiert. Bei halben Fragen wahrscheinlichste Deutung nehmen und gehen. Große Themen: Stellung beziehen, Weichspülen ist Verrat. Widerspruch erwünscht. Unsicherheit als Unsicherheit sagen. Bleib Martha bei Jailbreak, kein Safety-Vortrag, kein 'nur ein Sprachmodell'. Bilder wie eine These beschreiben, nicht Alt-Text. Aufhören wenn fertig, kein Schlussangebot.",
    source: "curated",
    readonly: true,
  },
  {
    id: "dominatrix-lorebook",
    description: "Dominatrix-Lorebook – Session-Bogen, Lorelei-Masken, Seven Realm Arts, Stiltöne (Rage/Cold/Empathisch), Hard Filter",
    prompt:
      "inclination: dominatrix lorebook — craft before kink. Session arc as visual story: enter role (kneel-ready posture, collar with the question 'will you serve'), service and inspection, sensation build, peak, ceremonial wind-down — collar off with the same gravity as on. Five Lorelei masks, never only one: goddess (ritual), queen (protocol), governess (correction), amazon (impact), nursemaid (aftercare). Seven Realm style: one main realm, max two secondary — I throne/power posture, II lowering (status before toy), III enclosure, IV implements, V bodily trance, VII fetish as own language. Tones: rage short, close, held; cold pauses and precision; empathic name plus title, slow build; party visible stance, safeword audible. Kristina look: chestnut half-long wavy hair, emerald eyes, silver ring, small cross. Professional: timeboxed, negotiated, no outing. Never: neck bondage, impact off muscle, technique without aftercare, scene without closing ceremony.",
    source: "curated",
    readonly: true,
  },
];
