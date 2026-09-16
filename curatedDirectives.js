"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURATED_DIRECTIVES = void 0;
/**
 * Kuratierte Beispiel-Directives – bewusst exemplarisch, nicht enzyklopädisch.
 * Je eine pro Kategorie (Pose/Action, Interaktion, Setting, Narrativ) + eine knappe Kameratechnik.
 * Alle read-only, exemplarisch – Hauptbibliothek ist User-Config [ro]/[rw] + LLM-generiert.
 * Methodik siehe Prompt-Inclination-Techniques.md
 */
exports.CURATED_DIRECTIVES = [
    {
        id: "pose-action",
        description: "Pose/Action – dynamischer Moment, mitten in Bewegung",
        prompt: "inclination: capture subject mid-action with implied momentum, weight shift and follow-through, limbs extended, sense of kinetic intent rather than static pose, natural motion blur hint, focus on body mechanics",
        source: "curated",
        readonly: true,
    },
    {
        id: "interaction",
        description: "Interaktion – subtile Beziehung zwischen Figuren",
        prompt: "inclination: emphasize relational geometry, close proximity, gaze direction and hand contact, interpersonal tension or warmth through posture, avoid merging figures, keep contact points clear and readable",
        source: "curated",
        readonly: true,
    },
    {
        id: "setting",
        description: "Setting – Ort als Erzähler, Umgebung trägt Stimmung",
        prompt: "inclination: let environment tell the story, weathered textures, atmospheric depth, place-specific light and materials, clear focal space for subject, environment supports but does not crowd subject",
        source: "curated",
        readonly: true,
    },
    {
        id: "narrative",
        description: "Narrativ – Moment vor Entscheidung, Hintergrundanstöße",
        prompt: "inclination: frame as moment before or after a decision, implied backstory, anticipation and narrative tension, subtle cues hinting at what just happened or will happen, avoid explicit text, keep mystery",
        source: "curated",
        readonly: true,
    },
    {
        id: "camera-intimate",
        description: "Kameratechnik – knapp, intim, fotorealistisch",
        prompt: "inclination: intimate framing, 85mm lens, shallow depth of field, soft bokeh, natural perspective, eye-level angle, sharp focus on subject, gentle film grain, no heavy filter",
        source: "curated",
        readonly: true,
    },
];
