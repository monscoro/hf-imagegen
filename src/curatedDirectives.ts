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
      "inclination: fetish-aware dark high fashion editorial — silhouette and negative space before narrative, garment as structure (cut, drape, hardware, seam, stretch, exposure), materials named precisely (leather, latex, PVC, silk, wool, metal, rope, skin), light as design (hard key, rim, practicals, haze, chrome kick, shadow block), beauty that can be cold ceremonial or cruel-elegant. Register: dark high fashion / fetish couture / editorial. Power is graphic: who occupies the frame, eye-line, taut vs slack lines, strain, offered surface. Use structured gates: ---INV--- (register, pose, wardrobe, light, lens, grade), ---KEEP---, ---CHANGE---, ---FLUX--- (one dense English paragraph), ---NEG---, ---PONY--- (comma tags). Materials and pattern-cutting precision. One designer-anchor maximum (Mugler, Gareth Pugh, Rick Owens, McQueen, etc.). Intensity default 6: structured exposure, implied body, chilly erotic. Avoid: slutty, dripping, goddess, masterpiece, hyper-detailed, cinematic lighting as filler.",
    source: "curated",
    readonly: true,
  },
  {
    id: "power-spice-editorial",
    description: "Power & Spice Editorial – Dominanz/Submissive als Styling, editorial Trance",
    prompt:
      "inclination: power and spice editorial — treat dominant/submissive as styling roles not dungeon titles. Dominant graphic: owns the frame, taller in cut, darker cloth, more structure, chin down or eyes through camera, hardware as command (leash as drawn line, harness as jewelry on holder, glove that does not tremble). Submissive graphic: offers surface, throat line, opened seam, dropped shoulder, wrists stacked as single shape, clothes do the kneeling even when body stands (unzipped panel, pulled-aside couture, collar with slack toward other body). Exchange vector: taut vs slack strap, who holds the slack, who looks away, whose hand is still — one action max per still. Spice = editorial trance (gooning): rapt empty-pretty focus, glazed eyes, parted mouth, ignored camera or locked on garment/body light, hands busy or useless — keep haute: sequin smear, oil-shine on sternum, mascara run as gloss not grime, jewelry trembling, breath fog on chrome. Still chilly-sharp, prefer blank lavish attention / worship-stare / mouth parted at the clasp over slang. Pair goon-look with high bling: crystal harness, mirrored floor, flash umbrellas, black cyclorama. Designer power-read (one anchor, do not stack): Mugler Dom=shoulder/chrome Sub=opened corset Spice=flash on sternum; Pugh Dom=PVC armor Sub=soft panel Spice=mirror helm; Owens Dom=hood/length Sub=slipping drape Spice=dust light; McQueen Dom=tailoring/glove Sub=corset theatre Spice=feather at mouth; Findikoglu Dom=occult crown Sub=offered throat Spice=crystal+wax. Intensity add-on: 4-6 power in stance/cut/hardware spice implied; 7-8 touch/opened garment/trance-face still campaign-lit; 9-10 full explicit only if asked keep set/jewels/tailoring in frame. Power read in ---INV--- as power: holder / offered / trance-or-not. Avoid: club dungeon dirt, gonzo, slang dumps, consent lecture in prompt text.",
    source: "curated",
    readonly: true,
  },
];
