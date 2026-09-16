# Prompt-Inclination-Techniques — Beeinflussung statt Direktbefehl

> **Ziel:** Die Tool-LLM *neigt* (`inclination`) statt zu befehlen. Ein aktiver Stimmungsprompt wird **indirekt** in `generate_image` Prompts verwoben — Mood, Kunststil, Ausrichtung, Inszenierung — ohne den Bildinhalt wortwörtlich zu präfixen. Methodik destilliert aus Webrecherche + eigener Plugin-Architektur (`curatedDirectives.ts:3`, `directiveStore.ts:60`, `promptPreprocessor.ts:32`).

---

## 1. Warum Inclination statt Direkt-Prompt?

Direkte Prompts (`"a cat, cinematic, neon"`) beschreiben **was** zu sehen ist. Inclination beschreibt **wie** die LLM das *Wie* wählen soll: Gewichtung, Auswahl, Weglassen. Vorteile:

- **Mittelbar:** Gleicher User-Wunsch `zeichne eine Werkstatt` wird mit `pose-action` anders als mit `narrative` — ohne dass die Directive `Werkstatt` nennt.
- **Kombinierbar:** Mehrere Neigungen orthogonal (siehe 2.) ohne Keyword-Salat.
- **Persistierbar:** Aktiviert via `inclination_prompt_set({name})`, in `promptPreprocessor` injiziert, via `[ro]/[rw]` in `customDirectives` (`src/config.ts:35`) schaltbar. Einheitlicher Prefix `inclination_prompt_` (`list`/`set`/`manage`).

Quellenprinzip: *Struktur + Ziel* vor *Syntax* — `HuggingFace Diffusers: subject>style>context`, `OpenAI gpt-image-2 Guide 2026-04-21: background/scene → subject → key details → constraints + intended use`.

---

## 2. Taxonomie – 4+1 Dimensionen (orthogonal)

In Anlehnung an `nodaroai/app.nodaro.ai` (`setting.ts`, `pose.ts`, `picker-catalogs.ts`) – jede Dimension hat eigene `promptHint`, wird mit `, ` verbunden:

| Dimension | Was sie steuert | Katalog-Beispiele | PromptHint-Muster |
|---|---|---|---|
| **Pose/Action** | Körperhaltung + Bewegung, nicht Kamera | `standing, walking mid-stride, dancing, fighting-stance, reaching, leaping, thinking` | `walking, caught mid-stride` |
| **Interaktion** | Relation zwischen Figuren | `simple: holding hands, sitting side by side` vs `complex: whispering, piggyback, carrying` (Neolemon 70+ Action Keywords 2026-02-24) | `reaching outward with one arm, gaze toward other figure` |
| **Setting** | Wo, nicht wer | `indoor|urban|nature|fantastical` – `coffee-shop, forest clearing, alien dunes` | `set in a sunlit forest clearing with moss-covered stones` |
| **Narrativ/Atmosphäre** | Woran es *riecht*, was gleich passiert | `clear, fog, rain, god rays` + `mood: calm, tense, mysterious` | `ethereal, dreamy, soft haze` |
| **Kameratechnik** | Wie gesehen, knapp halten | `85mm, shallow DOF, eye-level, soft bokeh, film grain` | `85mm lens, shallow depth of field, eye-level` |

**Exemplarisch kuratiert (nur Beispiele, read-only):**

- `pose-action` – dynamischer Moment, mitten in Bewegung
- `interaction` – subtile Beziehung zwischen Figuren  
- `setting` – Ort als Erzähler
- `narrative` – Moment vor Entscheidung
- `camera-intimate` – knapp, intim, fotorealistisch

Volle Details `src/curatedDirectives.ts:8`. Hauptbibliothek: eigene Einträge in `customDirectives` `[ro]` default locked, `[rw]` LLM-editierbar.

---

## 3. Bau-Methodik – destilliert

### 3.1 Strukturformel
Nach `Bildprompt.de / Brownz B001-500 (2026-09-03)` und `Scaler Prompt Framework`:

```
[Subject], [Handlung/Action], [Setting/Umgebung], [Stil/Medium], [Licht/Mood], [Kamera/Technik] [--Parameter]
```

- Früh gewichten: Wichtiges vorn, `nice-to-have` hinten (Modelle gewichten frühe Tokens stärker).
- Abstraktes benennen: Statt `moody` → `low-key lighting, high contrast, deep shadows, film noir`.

### 3.2 Metadata statt nur Text
Nach `hiro.solutions Prompt Library Governance 2026-05-13`, `AWS GENREL04-BP01`, `KevinRabun/prompt-catalog`:

```yaml
id: pose-action
version: 1.0.0
intent: generate / inclination
category: pose-action
tags: [movement, kinetic]
owner: curated
status: approved
modelCompatibility: [FLUX, SDXL]
```

Wir nutzen `ImageDirective{id,description,prompt,source,readonly}` (`src/types.ts:40`). Versionierung via Git, `directiveStore.ts:7` persistiert nur `user` Shadows.

### 3.3 Variable Templates
Nach `BDiopXV/AI-Visual-Prompt-Cookbook style.json`, `Shelly Palmer Workbook`:

```json
{
  "prompt_template": "inclination: {MOOD}, setting {SETTING}, camera {LENS}",
  "environment_variables": ["MOOD","SETTING","LENS"],
  "style_fidelity_anchors": ["keep focal space clear"],
  "negative_prompt": "extra fingers, watermark, text"
}
```

Für uns: `description` = Variable `MOOD`, `prompt` = Template. `inclination_prompt_manage` nutzt genau diese Felder (vereinheitlicht auch `list` via `action:"list"`).

### 3.4 Inclination-Anwendung im Plugin

- **Aktivierung:** `inclination_prompt_list` → `inclination_prompt_set({name:"pose-action"})` → `promptPreprocessor.ts:32` injiziert `== ACTIVE IMAGE SYSTEM PROMPT ==` bei jedem Turn (nicht stures Präfix, Anweisung: *stilistisch verweben*). `inclination_prompt_manage({action:"list"})` ist Alias für `list`.
- **Schutz:** `[ro]` → `update` reject, `[rw]` → Shadow in `tmp/directives.json` erlaubt (`directiveStore.ts`).
- **Qualität-Levers gezielt:** `photorealistic` direkt nennen aktiviert Photoreal-Modus (OpenAI Guide), technische Levers wie `film grain, subsurface scattering` nur wenn nötig.

---

## 4. Erweiterter Beispielsatz – zum Kopieren & Anpassen

> Alle via `inclination_prompt_manage({action:"create"})` erstellbar. LLM generiert automatisch passende id, description und prompt. Bewusst inklinationsartig formuliert (`inclination: ...`), damit LLM sie *auslegt* statt kopiert.

### Pose/Action (exemplarisch + erweitert)

| id | Beschreibung | PromptHint (inclination) |
|---|---|---|
| `pose-action` *(curated)* | dynamischer Moment | `inclination: capture subject mid-action with implied momentum, weight shift and follow-through, limbs extended` |
| `mid-leap-joy` | Sprung vor Freude | `inclination: jumping for joy, body airborne, arms open, celebratory lift` |
| `tiptoe-sneak` | schleichend, spannungsvoll | `inclination: tiptoeing, cautious, body leaned forward, secretive pacing` |
| `fighting-stance` | kampfbereit, angespannt | `inclination: in a combat-ready fighting stance, tensed and focused` |
| `thinking-pose` | nachdenklich | `inclination: in a thinking pose with hand on chin, gaze contemplative` |

*Quelle: Neolemon 70+ Action Keywords; nodaro pose.ts `walking, dancing, leaping, dramatic-action`*

### Interaktion

| id | Beschreibung | PromptHint |
|---|---|---|
| `interaction` *(curated)* | subtile Beziehung | `inclination: relational geometry, close proximity, gaze and hand contact, keep contact points clear` |
| `whisper-pair` | Flüstern | `inclination: one leaning in, hand near mouth, other listening, intimate distance` |
| `side-by-side` | Nebeneinander, zuverlässig | `inclination: sitting side by side, relaxed, shoulders aligned` |
| `piggyback-play` | komplex, mehrfach generieren | `inclination: piggyback ride, one carrying other, playful, expect regen` |

*Hinweis: simple Interaktionen `holding hands` zuverlässig, `piggyback` braucht mehrere Generationen – Neolemon.*

### Setting/Umgebung

| id | Beschreibung | PromptHint |
|---|---|---|
| `setting` *(curated)* | Ort als Erzähler | `inclination: let environment tell the story, weathered textures, atmospheric depth, clear focal space` |
| `coffee-shop` | gemütlich indoor | `inclination: set in a cozy coffee shop interior with warm pendant lights, exposed brick` |
| `forest-clearing` | natürlich | `inclination: set in a sunlit forest clearing with moss-covered stones, dappled light` |
| `ruin-industrial` | verfall, erzählerisch | `inclination: ruin-space terrain, decay, overgrown ivy, texture and story space` |
| `neon-alley` | urban, theatral | `inclination: set in neon-lit alley at night, rain reflections, cinematic haze` |

*Quelle: nodaro setting.ts `indoor|urban|nature|fantastical`, ai-prompt.acltracks.com Theme Library*

### Narrativ/Atmosphäre

| id | Beschreibung | PromptHint |
|---|---|---|
| `narrative` *(curated)* | Moment vor Entscheidung | `inclination: frame as moment before or after a decision, implied backstory, anticipation` |
| `before-storm` | Anspannung | `inclination: air heavy before storm, low pressure, distant thunder mood, anticipation` |
| `arrival-stranger` | Hintergrundanstöße | `inclination: arrival of a stranger, gazes turned, subtle shift in room` |
| `golden-interior` | warm, geborgen | `inclination: warm atmosphere and design balance, golden interior shell, inviting` |
| `stormfront` | Welt-Preset | `inclination: stormfront world preset, weather, mood, and pressure, dramatic clouds` |

### Kameratechnik (knapp halten!)

| id | Beschreibung | PromptHint |
|---|---|---|
| `camera-intimate` *(curated)* | intim, fotoreal | `inclination: intimate framing, 85mm lens, shallow depth of field, soft bokeh, eye-level` |
| `macro-detail` | Detail | `inclination: macro photography, visible texture, shallow DOF, focus on material` |
| `wide-cinematic` | episch | `inclination: wide-angle, 35mm, volumetric light, epic composition, depth of field` |
| `tilt-shift` | Spielzeug-Effekt | `inclination: tilt-shift, miniature look, selective focus` |

*Quelle: Brownz AInauten Redaktion B201-225 Fotografie/Licht, PromptForge CAMERA.json*

---

## 5. Eigene Inclination bauen – Checkliste

1. **Kategorie wählen:** Nur eine Dimension pro Directive (orthogonal) – nicht `setting+pose+camera` mischen.
2. **Beschreibung = Absicht, Prompt = Hinweis:** `id: Kurzbeschreibung [ro|rw]` Zeile1, dann `inclination: ...` – LLM legt aus.
3. **Konkret benennen:** Medium/Licht nennen (`85mm, low-key, Kodak Portra 400`) statt `schön`.
4. **Fokalraum freihalten:** `clear focal space where subject can be placed` – Settings ohne Menschenbeschreibung.
5. **Gewichtung vorn:** Wichtiges Substantiv/Verb an Anfang des finalen `generate_image` Prompts stellen.
6. **Iterieren klein:** Eine Dimension ändern, Seed halten wenn möglich.

---

## 6. Referenzen (Auszug)

- `nodaroai/app.nodaro.ai` – `setting.ts`, `pose.ts`, `picker-catalogs.ts`, `atmosphere.ts` – orthogonale Katalogarchitektur, `promptHint` Pattern
- `Neolemon AI Character Action Prompts 2026-02-24` – 70+ Action Keywords, `pose vs action` Unterscheidung
- `Bildprompt.de / Brownz Top 500 B001-500 2026-09-03` – Formel `Subject > Environment > Light > Parameter`
- `HuggingFace Diffusers Prompting / OpenAI gpt-image-2 Guide 2026-04-21` – `background→subject→details→constraints`
- `hiro.solutions Prompt Library Governance 2026-05-13`, `AWS GENREL04-BP01 Implement a prompt catalog`, `KevinRabun/prompt-catalog YAML Schema` – Metadata, Versioning, Rollback
- `BDiopXV/AI-Visual-Prompt-Cookbook style.json`, `tyjean AI Visual Prompt Gallery 40k`, `PromptForge UI` – variable Templates, visuelle Kataloge

---

## 7. 17 Inclination-Prompts in Fließtextform – vom Vertrauten zum Unkonventionellen

> So wie ein Endnutzer sie selbst schreiben würde: `name: Kurzbeschreibung [ro|rw]` in Zeile 1, dann ein kurzer Fließtext der **neigt** statt befiehlt. Zum Direkt-Kopieren in `customDirectives` (`src/config.ts:35`). Alle `inclination:`-artig – die LLM webt sie ein, egal ob du danach `zeichne eine Werkstatt` oder `einen Hund` verlangst. Steigerung: 1–6 vertraut, 7–12 anspruchsvoll, 13–17 bewusst unkonventionell.

```text
morgenlicht-werkstatt: Warme Werkstatt am frühen Morgen, einladend [ro]
inclination: warmes Morgenlicht fällt schräg durch leicht staubige Fenster, Holz duftet dezent, weiche Schatten und klare Luft, Stimmung hoffnungsvoll aber ohne Kitsch, viel freier Raum für die eigentliche Handlung im Vordergrund

regen-nachtmarkt: Nächtlicher Markt im Nieselregen, lebendig [ro]
inclination: Neon spiegelt sich in nassen Pflastersteinen, leiser Dampf steigt von Ständen auf, Menschen dicht aber nicht gedrängt, leichte Unschärfe in der Ferne, Ort erzählt von Alltag und Ferne zugleich

dach-tanz: Tanz auf dem Dach, mitten in Bewegung [rw]
inclination: Körper mitten im Sprung mit spürbarem Schwung, Gewichtsverlagerung und Nachziehen der Glieder, kein statisches Posieren, leichte Bewegungsandeutung, Standpunkt so gewählt dass Dynamik lesbar bleibt

fluestern-regal: Zwei flüstern zwischen hohen Regalen, nah [ro]
inclination: relationaler Fokus auf Nähe und Blick, einer neigt sich leicht, Hand nah am Mund, der andere hört zu, Kontaktpunkte klar und zart, Hintergrund bleibt ruhig damit Beziehung trägt

bahnsteig-warten: Warten am Bahnsteig, gleich geht es los [rw]
inclination: Moment kurz vor Abfahrt, Koffer stehen bereit, Blicke gehen in verschiedene Richtungen, leichte Anspannung in Schultern, Licht flackert kühl, Geschichte liegt in dem was gleich passiert

kinder-turm: Kinder bauen gemeinsam einen wackligen Turm [ro]
inclination: kleine Hände, Konzentration und leises Lachen, verteilte Aufmerksamkeit, einer hält, einer legt auf, Interaktion über gemeinsames Ziel, Proportionen natürlich, kein Verschmelzen der Figuren

runder-tisch: Verhandlung am runden Tisch, angespannt [ro]
inclination: gegenüberliegende Haltungen, Hände auf Holz, Blicke messen ab, Raum wirkt eng und bedeutungsschwer, Licht hart und gerichtet, Spannung entsteht aus Haltung nicht aus Requisiten

verlassene-schule: Verlassene Schule am Nachmittag, still [rw]
inclination: Ort als Erzähler, abgeblätterte Farbe, Staub in Sonnenstreifen, Stille die laut wirkt, klare Fokusfläche vorne, Umgebung trägt Melancholie ohne Figuren zu beschreiben

schatten-theater: Schattentheater an heller Wand, theatralisch [ro]
inclination: große, weiche Schatten als zweite Ebene, Lichtquelle niedrig und warm, Gesten werden über Schatten überhöht, Inszenierung wirkt wie Bühne, aber intim und lesbar

umkehr-schwerkraft: Werkstatt mit umgekehrter Schwerkraft, spielerisch unlogisch [rw]
inclination: leichte Gegenstände schweben knapp über dem Boden als wäre Schwerkraft nur halb an, Staub schwebt langsam, Neigung zur Schwerelosigkeit, aber Erzählung bleibt bodenständig, Physik nur angedeutet

erinnerungs-palast: Erinnerungspalast, Dinge schweben geordnet [rw]
inclination: Raum wirkt wie ein begehbares Gedächtnis, Objekte stehen in stiller Ordnung leicht versetzt in der Luft, weiches diffuses Licht, Atmosphäre ruhig und bedeutungsvoll, Ort lädt zum Verweilen ein

zeitlupe-glas: Glas zerspringt in Zeitlupe, entscheidender Augenblick [ro]
inclination: Moment unmittelbar nach dem Aufprall, Splitter halten kurz in der Luft, Licht bricht in Facetten, Zeit wirkt gedehnt, Fokus hält die Spannung zwischen vorher und nachher

spiegel-identitaet: Spiegelkabinett, Identität vervielfacht [rw]
inclination: mehrere Spiegel reflektieren dieselbe Figur leicht versetzt, Identität wirkt vervielfacht aber jede Spiegelung bleibt klar, Licht sauber und gleichmäßig, Verwirrung nur durch Wiederholung nicht durch Unschärfe

zwei-zeiten-eine-bank: Eine Bank, zwei Zeiten gleichzeitig [rw]
inclination: dieselbe Bank im selben Bild von zwei Zeitebenen bewohnt, Kleidung und Licht deuten unterschiedliche Jahrzehnte an, beide Ebenen teilen sich den Ort aber nicht den Blick, poetische Überlagerung statt Collage

fliegender-markt: Fliegender Markt über den Wolken, leicht surreal [ro]
inclination: Stände schweben ruhig über einer Wolkendecke, Stoffbahnen wehen träge, Licht weit und hell, Ort ist fantastisch aber alltäglich inszeniert, Fokusraum bleibt frei für deine Figuren

stiller-chor: Stiller Chor aus Statuen, die zuhören [rw]
inclination: Reihe verwitterter Statuen leicht zueinander geneigt als würden sie zuhören, Stille wird hörbar, weicher Dunst, steinerne Gesichter wirken aufmerksam, Stimmung feierlich und leicht unheimlich

brief-schreibt-sich: Brief der sich selbst schreibt, unkonventionell final [rw]
inclination: Feder führt sich wie von selbst über Papier, Tinte fließt ohne Hand, Buchstaben entstehen in Echtzeit, Licht eng und warm auf dem Blatt, Handlung und Setting verschmelzen, Moment wirkt magisch aber glaubwürdig inszeniert
```

**Lesehilfe:** 1–6 sind sofort nutzbar für `generate_image("...")` jeder Art, 7–12 verlangen bewusste Setzung (Licht/Ort), 13–17 brechen bewusst mit Physik/Logik – als Inclination funktioniert gerade das: die LLM übernimmt die *Neigung* (z.B. `schweben`, `Zeitdehnung`, `Identitätsverdopplung`) und wendet sie auf deinen konkreten Wunsch an, ohne ihn zu überschreiben.

> Pflege: Eigene Directives in `tmp/test-images` testen, dann `customDirectives` `[rw]` zum Experimentieren, `[ro]` zum Schützen. Curated bleiben Beispiele – nicht erweitern, sondern user-seitig wachsen lassen.
