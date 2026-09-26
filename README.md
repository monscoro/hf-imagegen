# Image Gen — Image Generation Plugin for LM Studio

> **Keywords:** lm studio plugin, image generation ai, text to image, image to image, flux lm studio, sdxl lm studio, hugging face image, pollinations, lora support, ai image generator, stable diffusion, flux kontext

Generate and edit images from your LM Studio chat — via **HuggingFace Inference Providers** or **Pollinations.ai**. Supports FLUX, SDXL, Krea, Qwen-Image and other models, LoRA adapters, instruction-based image editing (KEEP/CHANGE), persistent style profiles (Neigungsprompts), and paginated browsing of results.

---

## Who This Is For

- Users wanting image generation without switching to a separate app or UI
- Developers testing text-to-image models alongside their LLM workflow
- Anyone wanting FLUX or SDXL output directly from their LM Studio chat session
- Creatives iterating on image prompts — and on existing images — in the same conversation
- Editorial/fashion workflows: pose stays, material/light/details change (KEEP/CHANGE)

---

## Installation

```bash
cd image-gen
npm install
npx tsc
```

Load the built plugin in LM Studio. Rebuild (`npx tsc`) and reload the plugin after every source change.
Compiled `.js` files are build output and intentionally **not** tracked in git (see `.gitignore`).

---

## Configuration

| Field | Default | Description |
|---|---|---|
| HuggingFace API Token | _(blank)_ | **Required for backend `hf`.** Token from huggingface.co/settings/tokens, at least `read` scope. Not needed for `pollinations`. |
| Default Model | `black-forest-labs/FLUX.1-dev` | Text-to-image model for `generate_image` (backend `hf`). Overridable per call. |
| Default Edit Model | `black-forest-labs/FLUX.2-dev` | Image-to-image model for `image_edit`. Must be editing-native (FLUX.2-dev, Kontext-dev or Qwen-Image-Edit). |
| Pollinations API Key | _(blank)_ | **Required for backend `pollinations`** (since Sep 2026, anonymous access removed). Get one at enter.pollinations.ai/keys. Never share `sk_…` keys. |
| Output Directory | `~/images` | Where images are saved. Created automatically. Supports `~/` prefix. Also the search base for bare filenames in `image_edit` and the default scope of `list_image_directory`. |
| Generation Cooldown (ms) | `5000` | Minimum gap between generations (both backends). |
| Daily Generation Limit | `75` | Max images per day, resets at **local** midnight. This is the plugin's own guard — it does **not** track HF credits. |
| Enable Inclination Prompts | `true` | Master switch for the Neigungsprompt subsystem. Off hides `inclination_prompt_*` tools and stops style-profile injection (stored active profiles resume when re-enabled). |
| Enable Video | `true` | Master switch for video generation. Off hides `generate_video` from the LLM and strips its routing (`list_models source="video"` keeps working for browsing). Video renders bill per second — turn off to avoid accidental credit spend. |

---

## Backends

|  | `hf` (default) | `pollinations` |
|---|---|---|
| Provider | HuggingFace Inference Providers (auto + 7 sub-providers, see `list_models`) | Pollinations.ai |
| Token | HF token required | API key required (enter.pollinations.ai/keys) |
| Content filter | Provider-side moderation | Strict filter off by default (`safe=off`); illegal content still moderated |
| Negative prompt | ✅ supported | ❌ ignored (reported in response notes) |
| LoRA (`lora_id`) | ✅ FLUX via fal-ai | ❌ rejected with a clear error |
| Image editing | ✅ `image_edit` (editing-native HF models, one reference) | ✅ `image_edit` (single **or multi-reference** via `POST /v1/images/edits`, model-specific limits), `compose_images` (2+ references, enforced by the schema) |
| Rate limit | Config cooldown + daily cap | Same, plus 15s anon / 5s with-key tier gap |
| Best for | Quality, LoRAs, precise control | Quick tests, permissive fashion/editorial takes & edits |

**Rule of thumb:** HuggingFace IDs ↔ `backend="hf"`, Pollinations IDs ↔ `backend="pollinations"`, editing-native IDs ↔ `image_edit`. Mixing them fails — the tools say so explicitly. `compose_images` is always Pollinations; HF takes exactly one reference image.

---

## Tools (9)

### `generate_image` — Generate from text

```
generate_image(prompt, model_id?, backend?, negative_prompt?, lora_id?, lora_scale?, width?, height?, seed?, quality?, name?)
```

| Parameter | Default | Description |
|---|---|---|
| `prompt` | _(required)_ | Specific description — subject, style, lighting, mood, quality terms. |
| `model_id` | _(config default)_ | HF ID (backend `hf`) or Pollinations model (backend `pollinations`, blank = `flux.1-schnell`). |
| `backend` | `"hf"` | `"hf"` or `"pollinations"`. |
| `negative_prompt` | `""` | Exclusions. HF only — ignored on Pollinations. |
| `lora_id` | `""` | HF LoRA adapter ID. HF + FLUX only. |
| `lora_scale` | `1.0` | 0.5–1.0 subtle, higher = stronger. |
| `width` / `height` | `0` (= default) | Pollinations only (0–2048). Portrait e.g. 768×1152 for fashion editorial. |
| `seed` | `0` (= random) | Pollinations only, for reproducible results. |
| `quality` | unset (=`medium`) | Pollinations only; documented for gpt-image/grok-imagine-image-2.0. |
| `name` | `""` | Optional filename slug — sanitized to lowercase `a-z0-9-` (max 40) and appended after the timestamp (`hf-2026-09-23_12-00-00_red-cat.png`). Blank = timestamp only. |

Returns `file_path`, `output_dir`, `backend`, `model_used`, sizes, a `quota` block (plugin daily limit → `remaining`, `used`, `limit`, `resets_in_hours` — *plugin guard, not HF credits*), and `notes` (ignored params, watermark hints). Use `file_path` as-is when handing images to other tools — other plugins may not find bare filenames.

### `image_edit` — Edit one or many reference images (hf or pollinations)

```
image_edit(image, images?, prompt, backend?, model_id?, provider?, negative_prompt?, lora_id?, lora_scale?, quality?, width?, height?, name?)
```

Reference image(s) = **KEEP**, prompt = **CHANGE** (mirrors the Neigungsprompt gates). `image` is the **first** reference and is always a plain string. Absolute local paths are preferred (the `file_path` returned by an earlier result); bare filenames, relative paths and public URLs also work. Leave `images` unset for a single-image edit. If the result has to **merge two or more images** rather than change one, use [`compose_images`](#compose_images--combine-two-or-more-images-pollinations) — it shares this implementation and requires at least 2 references.

**Multi-image editing is supported by the `pollinations` backend:** put the first reference in `image` and up to 15 more in `images` — all are uploaded together in one `POST /v1/images/edits` request, order preserved, so the prompt can address them by position. (An earlier version accepted an array in `image`; models that stringified that array into a single string caused "Reference image not found" errors, so `image` is string-only and a stringified array is still auto-recovered for compatibility.) The tool reads `max_reference_images` from the live model catalog and puts a note in the result when the count exceeds it — it does **not** block, because the catalog is only advisory (`x-ai/grok-imagine-image-quality` declares 1 but processes 2, `flux.1-kontext-pro` declares 1 and silently drops the second image). Models verified to combine several references: `black-forest-labs/flux.2-klein-4b` (10), `openai/gpt-image-2` (16), `bytedance/seedream-5.0-lite` (14), `google/gemini-3-pro-image` (14). HF remains single-reference only.

| Parameter | Default | Description |
|---|---|---|
| `image` | _(required)_ | The first reference image as a string. An array here is rejected/auto-recovered — use `images` instead. |
| `images` | unset | Optional further references (1–15, ordered) for 2+ image edits; requires `backend="pollinations"`. |
| `backend` | `"hf"` | `"hf"` (needs HF token, exactly one image) or `"pollinations"` (needs pollinationsApiKey, single or multi-reference). |
| `model_id` | _(backend default)_ | hf: `defaultEditModel` (`FLUX.2-dev`). pollinations: blank = `x-ai/grok-imagine-image-quality` (few filters, declares 1 reference but does process 2); for 2+ references pick a model with a higher `max_reference_images`, e.g. `flux.2-klein-4b` or `seedream5`. |
| `provider` / `negative_prompt` / `lora_id` | | HF only — ignored or rejected with pollinations. |
| `quality` | unset | pollinations only; documented for gpt-image/grok-imagine-image-2.0. |
| `width` / `height` | `0` (= default) | pollinations only (0–2048), sent as POST `size=WIDTHxHEIGHT`. Both required — a single dimension is ignored with a note. |
| `name` | `""` | Optional filename slug for the result — same sanitize/append rules as `generate_image`. |

**hf:** only editing-native models work — base T2I models (FLUX.1-dev, SDXL, Qwen-Image) have no image-to-image provider mapping and fail; the error message says exactly that. `lora_id` is passed through to fal-ai (I2I effectiveness under verification). **pollinations:** default is deliberately non-restrictive (`grok-imagine-image-quality`) — kontext/seedream strict filters flag fashion-editorial and burn credits on failed edits. For a single reference that still needs precise KEEP/CHANGE work, `flux.1-kontext-pro` is the recommended pick (free, editing-native, holds pose/composition/identity and follows complex instructions); only intimate fashion-editorial edits need the permissive default. Returns `file_path`, `output_dir`, `backend`, the full `quota` block, and a clear warning when the plugin's daily limit is hit.

### `compose_images` — Combine two or more images (pollinations)

```
compose_images(images, prompt, model_id?, auto_model?, quality?, width?, height?, name?)
```

**Same implementation as `image_edit`, one different contract.** The core lives once in `runImageEdit`; `image_edit` and `compose_images` both call it. The only difference is schema validation: `image_edit` takes a required `image` string plus optional `images`, `compose_images` takes **only** `images` with `.min(2)`. So the two-image minimum is enforced by the schema, not by a sentence in a description — a single-image call cannot get through. `compose_images` maps its first entry to `image` and the rest to `images` and then runs the identical code path: same reference resolution, same multipart upload, same `max_reference_images` advisory, same quota, same result fields.

Use it when the result has to **merge** sources — "image 1 is the subject, image 2 only the garment, image 3 as the style" — which is a different task from "change this one image". For a single reference, `image_edit` is the right tool.

| Parameter | Default | Description |
|---|---|---|
| `images` | _(required, 2–15)_ | Ordered reference images. 15 max. Absolute `file_path` from an earlier result preferred; bare filenames, relative paths and public URLs also work. |
| `prompt` | _(required)_ | How the images combine. Address them by position — the order here is the order the prompt refers to. |
| `model_id` | _(blank)_ | Override — always wins. Blank + `auto_model` on = automatic pick by count (see below). Blank + `auto_model` off = configured Pollinations edit default. Never `flux.1-kontext-pro` for 2+ — it drops image 2 silently. |
| `auto_model` | `true` | Automatic model selection by reference count (only when `model_id` is blank): 2 → configured default (non-restrictive), 3–10 → `flux.2-klein-4b` (cheapest verified multi-image), 11–16 → `gpt-image-2` (highest count). The pick is reported in the result `notes`. |
| `quality` | unset | Documented for gpt-image/grok-imagine-image-2.0; ignored elsewhere with a note. |
| `width` / `height` | `0` (= default) | Output size in pixels, sent as POST `size=WIDTHxHEIGHT`. Both required — a single dimension is ignored with a note. E.g. portrait `768`/`1152` for fashion editorial. |
| `name` | `""` | Optional filename slug, same rules as `generate_image`. |

`backend` is deliberately **not** a parameter. HF Inference accepts exactly one reference and rejects the rest, so a second image is impossible there — exposing the switch would only offer a guaranteed error. The tool is Pollinations by construction and needs `pollinationsApiKey`. That also means `provider`, `negative_prompt` and `lora_id` are absent: all three are HF-only, and HF cannot do this task.

### `generate_video` — Animate a still into a clip (pollinations)

```
generate_video(image, end_image?, motion?, cuts?, model_id?, tier?, duration?, aspect_ratio?, resolution?, audio?, name?)
```

Still → Startframe-Upload (unlisted Media-URL) → `GET /video/{motion}` → MP4 nach `~/images` (`pv-…mp4`). Ein Clip pro Call oder ein Explorations-Satz: `cuts` (2–6 Motion-Varianten desselben Stills, sequenziell, Einzelfehler killen den Satz nicht). `motion` leer = LLM schreibt Kamera+Subjekt-Bewegung, dauer-skaliert. `tier` bei leerer `model_id`: `draft` (`seedance-1-pro-fast`, billigste Exploration), `standard` (`h3-max-turbo`, Sweet Spot mit Audio), `final` (`grok-imagine-video`, toleranteste Filter) — Wahl steht in den Notes. `duration`/`resolution`/`aspect_ratio`/`audio` werden gegen den Live-Katalog validiert (fail fast statt abgerechnetem Fehlcall; statische Tabellen als Offline-Fallback). Browse: `list_models source="video"`. Jeder Clip zählt eine Daily-Guard-Einheit, abgerechnet wird pro Sekunde (Pollinations) bzw. Provider-Credit (HF). Backend `pollinations` (Default, volle Features) oder `hf` (Token nötig, Default `Wan2.2-TI2V-5B`, Provider `auto`/fal-ai/replicate/wavespeed; v1 nutzt Modell-Defaults für Länge/Größe, Video-LoRAs brauchen erst einen live-verifizierten Provider-Pfad).

### `list_models` — Browse models per backend

```
list_models(source?, provider?, limit?, include_loras?, include_catalog?, filter?)
```

| Source | For | Notes |
|---|---|---|
| `curated` (default) | `generate_image` + `hf` | 11 expert-verified HF IDs, always available offline. |
| `image-edit` | `image_edit` + `hf` | Every HF model with `pipeline_tag=image-to-image` that a provider currently serves (~110), curated first. |
| `provider` | `generate_image` + `hf` | Needs `provider` (fal-ai, replicate, wavespeed, …). Never `pollinations` — use `source="pollinations"`. |
| `trending` / `downloads` | `generate_image` + `hf` | Live HF catalog, ranked by `trendingScore` or `downloads`. |
| `pollinations` | `generate_image`/`image_edit` + `pollinations` | 7 curated models plus `catalog_extras` with the full live catalog (77 entries). Requires API key. Aliases: `flux`, `kontext`, `seedream5`. |
| `video` | `generate_video` + `pollinations` (HF rows: future backend) | Pollinations live rows first (durations, resolutions, caps, pollen/s per row), then HF live rows (`text-to-video` + `image-to-video` tags, provider-enriched). No curated list — both sides live, never stale. |

`include_catalog` and `filter` apply to `source="pollinations"` (`catalog_extras`); `filter` has no effect on any other source. `limit` applies to every source except `curated`.

**The response only contains what the requested source needs.** Diagnostic blocks appear per source rather than always: `catalog_cache` only for `pollinations`, `hf_catalog_cache` for the HF sources (including `video`), `video_catalog_cache` only for `video`, `model_cache` only for `provider`/`trending`/`downloads`/`video`. Consequently a `curated` call reads no cache file at all, a `trending` call reads only the HF catalog, and a `pollinations` call only the Pollinations one. Before, every call read both (~357 KB of JSON parsed per call, ~5.5 ms warm); now it is 0 / 228 / 65 KB and 0.1 / 2.7 / 2.0 ms respectively. Costs are source-specific for the same reason: HF rows get the static `HF_COSTS` table, Pollinations rows the live catalog. Mixing them could have shown a Pollinations price on a model the caller was about to run through `backend='hf'`. (`video` additionally reads the small video catalog — 18 models — for its Pollinations half; the KB/ms figures above predate it.)

**`default_not_in_list` warns when the configured default is filtered out.** The artifact and pre-SDXL filters can exclude a configured `defaultModel` or `defaultEditModel` — a LoRA or a pre-2023 checkpoint, or simply a model that no provider serves. In that case no row is flagged `is_default` and the field names the missing model plus the likely cause, instead of the response quietly pointing at a default that is not in the list. (`video` is exempt: it has no configured default, image defaults never appear in a video list.)

LoRA lookup (`include_loras`) and `list_loras` are HF-only.

**Four filters, so every list is callable.** All model lists drop what fails as a `model_id`:

| Filter | What it removes | Why |
|---|---|---|
| Quantizations | GGUF/GPTQ/AWQ/EXL2/FP8/INT8/… | 26 % of the trending top 100. Same weights, different format. |
| LoRAs | anything with `lora` in the repo name | 53 % of usable `image-to-image` models — including the most-liked entry of all (`fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`, 1549 likes). |
| Pre-SDXL | repo `createdAt` before July 2023, plus the official `stable-diffusion-v1/2` repos | SD 1.x/1.5/2.x and their finetunes. SDXL and SD 3.x stay. |
| No live provider | models no provider serves with status `live` | `backend='hf'` would fail on them. |

Only the repo name is checked, never the author — otherwise someone called "lora-collective" would vanish. `list_loras` is deliberately not filtered.

The pre-SDXL cutoff is **date-based, not name-based**, and that was a measurement: SD-1.5 finetunes like `dreamshaper-7` or `Realistic_Vision_V5.1` carry neither "stable-diffusion" in their name nor a `base_model` tag — both signals checked, both absent. A deny-list of community names would just be the hand-maintenance this plugin removed elsewhere. The one blind spot: a pre-SDXL checkpoint re-uploaded under a neutral name after July 2023 survives.

Two deliberate exceptions. For `source="provider"` the provider filter is skipped, because the query `?inference_provider=fal-ai` is itself the proof and the catalog only covers the 1000 most-liked models per task. And if the catalog is unreachable, the provider filter is skipped too — a catalog outage must not empty every list exactly when something is already broken.

**HF rows carry measured data, not guesses.** `hf_providers` lists the inference providers currently serving the model (status `live`), `hf_latency_ms` is the measured latency of the fastest one, and `speed` is derived from that. A missing `image_edit` means the model is outside the 1000 most-liked per task, so HuggingFace simply does not say; it is not a `false`. Two things HF does not publish stay static and are not derived from the catalog: `max_reference_images` (always 1 for the HF backend, a plugin constraint) and per-call cost (HF gates its provider price list behind a login, `/api/inference-providers` answers `401` anonymously).

**Model catalog caching.** Two independent 12-hour caches, both under `~/.cache/image-gen/` and both surviving plugin reloads and LM Studio restarts. Set `IMAGE_GEN_CACHE_DIR` to relocate them; neither ever holds a token or API key.

**What the rename changes on disk.** The plugin was `hf-image-gen` until revision 17 and wrote everything to `~/.cache/hf-image-gen/`. `directives.json`, `library.json` and `rateLimit.json` are read from the old directory if the new one doesn't have them yet, then written to (and removed from) `~/.cache/image-gen/` on the next change. The two model catalogs are disposable and simply refetch. Note that the stores used to be written to the plugin's own `tmp/` directory when that was creatable — that silently depended on a `mkdir` succeeding, and a plugin update would have wiped them; they now always live in the home cache.

**The default output directory moved from `~/hf-images` to `~/images`.** Nothing migrates: images already generated stay in `~/hf-images` and are invisible to `list_image_directory` (default scope) and to `image_edit` with a bare filename, until you either point *Output Directory* back at `~/hf-images`, move the files — or pass the old folder in `list_image_directory({directories:[…]})`.

- **Pollinations** (`/image/models`) → `pollinations-catalog.json`. Pollinations prices come from that same file — the endpoint returns them per model, so no second request is made. Reported in `catalog_cache`.
- **Pollinations video** (`/video/models`) → `video-catalog.json`: prices per tier, durations, resolutions, capabilities, health. Reported in `video_catalog_cache` (only `source="video"`); `generate_video` validates live against it.
- **HuggingFace** (`/api/models?…&expand=inferenceProviderMapping`, one request per task) → `huggingface-catalog.json`, ~400 KB for 4000 models across text-to-image, image-to-image, text-to-video and image-to-video. This is the source of `hf_providers`, `hf_latency_ms` and `image_edit`. Reported in `hf_catalog_cache` for HF sources.

Both serve the last known catalog if the endpoint is unreachable, and never cache a failed fetch — one timeout cannot cost you the prices or the mapping for 12 hours.

### `list_loras` — Search LoRA adapters (HF only, images + video)

```
list_loras(base_model?, search?, limit?)
```

Avoid `search` (HF search is strict, often empty) — filter by `base_model` only. Pass `id` as `lora_id` with `backend="hf"`. Results are process-cached for 12h (same TTL as `list_models`, keyed by base_model+search+limit) — repeated lookups cost no API call. Video base models from `list_models source="video"` work too (wan/ltx/hunyuan/cogvideo/minimax query branches); each hit carries a `description` line (likes/downloads + notable tags) for picking. Video LoRAs are NOT a `generate_video` parameter — use them locally (ComfyUI/Diffusers, e.g. character LoRAs for a consistent muse); server-side video LoRA support is Phase-3 work.

### `list_image_directory` — Browse results & inputs, anywhere

```
list_image_directory(directories?, sort?, limit?, offset?, filter?)
```

Paginated, compact listing of the output directory by default — generated results **and** input/reference images (`image_edit` resolves bare filenames against it first; newest first, `limit=1` = latest image). Pass `directories` (up to 10, absolute or `~/` paths) to browse other folders — e.g. two folders to combine one image each with `compose_images`. `sort`/`limit`/`offset`/`filter` apply per directory; a missing folder returns an empty list, not an error. For `image_edit` / `compose_images`, pass the absolute `directory` + `filename` (preferred over a bare filename).

### `inclination_prompt_list` / `manage` / `library` — Neigungsprompts & Bibliothek (gated by Enable Inclination Prompts)

Three tools, three intentions (hard cut: `inclination_prompt_set` and `inclination_prompt_action` no longer exist):

| Tool | Intention | Parameters |
|---|---|---|
| `inclination_prompt_list` | **read** — Gesamtübersicht (Dashboard): Profile, Bücher, beide aktiven Stacks | `filter?`, `detail: "compact"` (default) \| `"full"` (alle Texte) |
| `inclination_prompt_manage` | **write** — das einzige Mutations-Tool, beide Domänen | `store: "profile"` (default) \| `"book"` \| `"record"`, `action: create\|update\|delete\|get\|activate\|deactivate\|clear`, `name`, `book`, `aspect`, `description`, `prompt`, `content`, `keys` |
| `inclination_prompt_library` | **lookup** — Records on-demand (read-only, nicht injiziert) | `query?`, `book?`, `aspect?` |

**Two stores, two stacks.** `profile` = Stimmungsprompt in `directives.json`, injiziert solange aktiv. `book`/`record` = Bibliothek in `library.json`: kuratiert und read-only sind `skillset` (A01–A33, gefacettet über 12 Aspekte) und `lorebook` (`session-arc`, `mask-*` ×5, `realm-*` ×8, `tone-*` ×6, `kristina-filter`); eigene Bücher/Records entstehen per `_manage({store:"record", action:"create", …})` — ein fehlendes Buch wird automatisch angelegt, `aspect` ist Pflicht (curated-Facetten oder freier Slug). Aktive Profile (`directives.json.activeIds`) **und** aktive Record-Refs (`library.json.activeRecords`) injiziert `promptPreprocessor` in `== ACTIVE IMAGE SYSTEM PROMPT ==`.

**Idempotente Aktionen, kein Toggle.** `activate`/`deactivate` melden „bereits aktiv / war nicht aktiv — keine Änderung" statt umzuschalten (das war der alte Fehler von `inclination_prompt_set`); jede Mutation gibt `active_profiles` + `active_records` zurück. `action:"clear"` leert beide Stacks, `store:"book"` aktiviert alle Records eines Buchs (mit Wort-Schätzung der Injektion). Curated-Einträge lehnen `update`/`delete` ab. `library` liefert bei `query:""` den Katalog (`ref`, `book`, `aspect`, `keys` + `facets` + `books`), bei exakter id/Keyword den Volltext — der ist Staging-Guidance und wird in den nächsten `generate_image`-Prompt verwoben, nicht wörtlich kopiert.

Gated by the `Enable Inclination Prompts` config switch (default on) — when off, these tools are not registered and no style profile is injected into the LLM context.

---

## Neigungsprompt System (Stimmungsprompts)

Active profiles are injected as system context every turn and act **indirectly**: the LLM weaves mood, style, and staging into `generate_image`/`image_edit` prompts instead of prefixing them. **Stacking:** several profiles can be active at once (e.g. visual layer + `voice-martha` + `dominatrix-lorebook`) — all are injected, separated by `---`. The whole subsystem can be switched off via the `Enable Inclination Prompts` config field.

**Sources:** `curated` (read-only examples in code) + `user` (LLM-created via `inclination_prompt_manage({store:"profile"})`, persisted in `directives.json`) + `library` (Bücher/Records in `library.json`, kuratiert oder per `_manage({store:"record"})` angelegt).

**Curated layers:**

| Prompt | Layer | Answers |
|---|---|---|
| `pose-action`, `interaction`, `setting`, `narrative`, `camera-intimate` | Visual basics | Pose, relation, place, story, lens |
| `dark-fashion-editorial` (~119 words) | Aesthetic | Silhouette, materials, light-as-design, gates, designer anchor, intensity 6 |
| `power-spice-editorial` (~150 words) | Dynamics | Dominant/submissive as styling, exchange vector, editorial trance, power-read designers |
| `voice-martha` (~137 words) | Voice | How results are *talked about*: millennial, sharp, no AI filler — combinable with the visual layers (stacking) |
| `dominatrix-lorebook` (~136 words) | Craft/Character | Session arc (role → service → peak → ceremonial wind-down), Lorelei masks, Seven Realm Arts, tones (rage/cold/empathic/party), Kristina look, hard filters |
| `dominatrix-skillset` (~127 words) | Library lookup | **Bibliotheksfunktion:** full distillation with explicit `A01`–`A33` index (thematic groups) → fetch records via `inclination_prompt_library` (id/Keyword, `''`=Katalog, `book`/`aspect`-Filter); always-on core keeps role posture, impact ladder/safe zones, circulation checks, deprivation order, exit record |

**Typical workflow:** user describes moods → LLM creates a profile via `inclination_prompt_manage({store:"profile", action:"create"})` → activates via `inclination_prompt_manage({action:"activate"})` → every generation/edit follows the style. Technik-/Stil-Records: `inclination_prompt_library({query:…})` nachschlagen, ggf. per `_manage({store:"record", action:"create"})` anlegen und aktivieren. Methodology and 20+ examples: `Prompt-Inclination-Techniques.md`.

---

## Curated Models (HF)

| Model ID | Role | Access |
|---|---|---|
| `black-forest-labs/FLUX.1-dev` | Default T2I: quality + prompt adherence (12B) | pro (license) |
| `black-forest-labs/FLUX.1-schnell` | Fast + Apache 2.0 | free |
| `krea/Krea-2-Turbo` | Photorealism specialist | free |
| `black-forest-labs/FLUX.1-Krea-dev` | Fashion-tuned FLUX — first choice for editorial/glamour | pro (license) |
| `Qwen/Qwen-Image-2512` | Allround + text rendering, Apache 2.0 (20B) | free |
| `stabilityai/stable-diffusion-xl-base-1.0` | Largest LoRA ecosystem, permissive base (OpenRAIL) | free |
| `stabilityai/stable-diffusion-3.5-large` | Stylized alternative base | pro (gated) |
| `Tongyi-MAI/Z-Image-Turbo` | Fast iteration, Apache 2.0 | free |
| `black-forest-labs/FLUX.2-dev` | **Edit default**: instruction-based I2I, 32B (fal/replicate verified) | pro (license) |
| `black-forest-labs/FLUX.1-Kontext-dev` | Edit alternative: instruction-based I2I (fal/replicate/wavespeed verified) | pro (license) |
| `Qwen/Qwen-Image-Edit` | Precise edits, Apache 2.0 | free |

**Pollinations models** (via `list_models source="pollinations"`, requires API key):

Seven curated picks, each with its own role — cheapest per role rather than "everything":

| Model | Alias | Access | ~Cost/image | Role |
|---|---|---|---|---|
| `flux.1-schnell` | `flux` | free | 0.002 | T2I default, most used of all models |
| `flux.1-kontext-pro` | `kontext` | free | 0.03 | most precise `image_edit`, 1 ref, **strict filter** |
| `grok-imagine-image-quality` | `aurora` | paid | 0.053 | edit default, few filters, `quality` param |
| `flux.2-klein-4b` | — | free | 0.005 | cheapest multi-reference, 10 refs |
| `gpt-image-2` | — | free | token-based | most capable, 16 refs, best prompt adherence |
| `seedream-5.0-lite` | `seedream5` | paid | 0.035 | high-res from 1920², 14 refs, **strict filter** |
| `gemini-3-pro-image` | `nanobanana-pro` | paid | token-based | up to 4K, 14 refs, fine detail |

Everything else (e.g. `flux.2-pro`, `ideogram-v4-turbo` for text-in-image, `qwen-image-3`, `wan-2.7-image`, `z-image-turbo`) is **not** curated, but still reachable: `list_models source="pollinations"` returns the full live catalog under `catalog_extras` with `max_reference_images` and cost. The curated list stays short because the live one doesn't need manual upkeep.

**The FLUX.2 family is multi-image throughout** — all four variants edit several references at once, so the family covers a lot of ground even though only `klein` is curated:

| Model | Refs | ~Cost/image | Role |
|---|---|---|---|
| `flux.2-klein-4b` | 10 | 0.005 | cheap mass edits, free, curated |
| `flux.2-pro` | 8 | 0.011 | BFL's default for quality, up to 4MP |
| `flux.2-flex` | 10 | 0.0375 | typography and small-detail preservation |
| `flux.2-max` | 8 | 0.03 | strongest edit consistency and prompt following |

Two limits the catalog number doesn't show, so they are carried in a `note` field on the affected rows: Black Forest Labs caps the **API at 8 slots** (`input_image` … `input_image_8`) — the "up to 10" figure is the playground UI. And `[pro]`/`[max]` share a **9MP input+output budget**: 8 references only fit at 1MP output, at 2MP only 7. `flux.2-flex` and `flux.2-max` also show 0 requests on Pollinations, i.e. they are listed but unproven.

---

## Workflows

**Generate:** describe → `generate_image` → file path. Use `backend="pollinations"` for quick iterations or permissive takes (requires API key).

**Edit (KEEP/CHANGE):** reference (prior result's absolute `file_path`, bare filename, or URL) + change instruction → `image_edit`. Example: *"same pose, latex dress instead of silk, keep everything else monochrome."* Backend `hf` (FLUX.2-dev etc.) or `pollinations` (default `grok-imagine-image-quality` — non-restrictive; via `/v1/images/edits`).

**Multi-reference edit:** `image_edit({backend:"pollinations", model_id:"black-forest-labs/flux.2-klein-4b", image:"/abs/subject.jpg", images:["/abs/style.png"], prompt:"Use image 1 as the subject and image 2 only as the visual style."})` sends both ordered references in one request. Result: `input_image` is the array, plus `input_image_count`, `input_sources` and `max_reference_images`; a too-high count relative to the catalog limit shows up as a note.

**Own style library:** *"Create these Neigungsprompts: cinematic-noir, dreamy-pastel"* → LLM builds entries → `inclination_prompt_manage({action:"activate"})` activates them.

**Community-alpha fallback (Pollinations):** if a `community/*` model fails, retry with `klein` or `flux`.

**Animate:** still (`file_path` aus `generate_image`/`compose_images`) + motion → `generate_video`. Exploration: `cuts` mit 3–4 Motion-Ideen in `480p`/`tier:"draft"` (Cent-Bereich pro Clip, Preise: `GET /video/models`), sichten, dann Final mit `tier:"final"` in `720p`/`1080p`.

**Full chain (still → composite → cuts → final):**
1. `generate_image({prompt:"editorial portrait, golden hour", backend:"pollinations", model_id:"flux.1-schnell", width:768, height:1152})` → `…/pl-…png`
2. `compose_images({images:["<still>", "<style.png>"], prompt:"use image 1 as the subject, image 2 only as the visual style"})` → composite
3. `generate_video({image:"<composite>", cuts:["slow dolly-in, fabric sways","static camera, hair moves in wind","orbit right, gaze follows lens"], tier:"draft", resolution:"480p"})` → 4 × ~0.05–0.08 Pollen sichten
4. `generate_video({image:"<composite>", motion:"<winning cut, refined>", tier:"final", resolution:"720p", aspect_ratio:"9:16"})` → Final

**Find results:** `list_image_directory({limit:1})` → `output_directory` + `filename` (absolute path) → straight into `image_edit`. Images outside the output dir: `list_image_directory({directories:["<folderA>","<folderB>"]})`, then `compose_images` with one absolute path per folder.

---

## Example Prompts

**Photorealistic portrait:**
> "A cinematic close-up portrait of a woman in golden hour light, soft bokeh background, 85mm lens, film grain"

**Selective edit (B/W poster, two accents):**
> image: `"x-video-…-poster.jpg"`, prompt: `"Do not colorize the image, keep everything monochrome except: crimson red leather boots (matte, catching light) and an ornate golden mask emitting a soft radiant glow"`

**Pollinations, portrait format:**
> `generate_image(prompt="...", backend="pollinations", model_id="black-forest-labs/flux.1-schnell", width=768, height=1152)`

**With LoRA (HF):**
> First: `list_loras(base_model="black-forest-labs/FLUX.1-dev")`
> Then: `generate_image(prompt="...", lora_id="alvdansen/flux-koda", lora_scale=0.8)`

---

## Prompt Tips

- **Be specific** — subject, lighting, style, mood. Vague prompts produce average results.
- **Quality terms** work: `ultra-detailed`, `8K`, `cinematic`, `sharp focus`.
- **Negative prompts** (HF): `blurry, low quality, deformed hands, text, watermark, oversaturated`.
- **FLUX models** understand natural language — full sentences beat tag soup.
- **Edits**: describe only the CHANGE; everything unmentioned tends to stay (KEEP).

---

## Design Decisions (Background)

**Config is read-only from plugin code.** The LM Studio SDK exposes `get()` but no setter — a catalog picker therefore *cannot* populate a text field. Consequence: no picker UI at all; all style management runs through LLM tools (`inclination_prompt_*`). The store lives in plugin storage (`directives.json`).

**Default model = FLUX.1-dev, not FLUX.2-dev.** FLUX.2 (32B, SOTA) needs a license accepted and is absent from the free inference pool; FLUX.1-dev works license-free via Inference Providers. FLUX.2 remains documented as the quality upgrade path.

**Base T2I models have no image-to-image mapping.** Verified per HF provider API: FLUX.1-dev, SDXL, Qwen-Image map to `text-to-image` only on every provider — retries are doomed, which a live reasoning trace confirmed. `image_edit` therefore defaults to editing-native `FLUX.2-dev` (I2I on fal-ai/replicate), with `FLUX.1-Kontext-dev` and `Qwen-Image-Edit` as alternatives; the error names all three. `list_models source="image-edit"` keeps the two worlds apart, and derives that list from the cached `pipeline_tag=image-to-image` catalog rather than three hand-kept IDs — so a new editing model shows up within 12 hours instead of never. The curated three stay pinned to the front and keep their hand-written descriptions.

**`sort=trending` is not an API parameter.** The `/api/models` endpoint accepts `trendingScore`, `likes`, `downloads`, `createdAt`, `lastModified` — `trending` returns `400 {"error":"Invalid sort parameter: trending"}`. It is the parameter the HF *website* uses, which is what makes it look plausible. `list_models source="provider"` and `source="trending"` used it and therefore failed with `tool_error` on every single call; both are fixed to `trendingScore`. Also worth knowing: `direction=1` is rejected (descending only, and it is the default) and `limit` is silently capped at 1000 per page.

**Pollinations as second backend.** Filter off by default; API key required since Sep 2026 (anonymous access removed). The live catalog carries 77 models; 7 are curated (see table above), the rest come from `list_models source="pollinations"` under `catalog_extras` with costs. No negative prompt, no LoRAs, community alphas as fallback chain.

**LoRAs via fal-ai.** `generate_image` routes LoRA calls to `fal-ai`; I2I LoRA passthrough exists and is honestly marked "under verification". Curated prompts stay under ~150 words to bound token cost on every-turn injection.

**Output browsing instead of directory dumps.** LLMs choke on large folders — `list_image_directory` paginates (per directory, up to 10 at once): by default the output directory (generated results and input/reference images alike), or any folders passed in `directories`. Bare filenames resolve against the output dir first (then the process CWD). Tools return the absolute `output_dir`/`file_path`, explicitly telling the LLM *not* to strip paths to bare filenames when handing results to other plugins — absolute paths are preferred everywhere, since relative paths resolve against the plugin process CWD, not the chat directory.

**Daily guard is local, and it's not HF credits.** The quota block (`limit/used/remaining/resets_in_hours`) reflects the config'd `Daily Generation Limit`. After a live-test confusion ("0 remaining despite HF credits!"), the counter was rebuilt on the **local calendar day** (ready to reset at local midnight) and the response now labels itself a *plugin guard*, names the reset, and appends a clear warning at `remaining: 0`.

**Accepting model licenses:** some models (FLUX.1-dev/-Kontext-dev, SD3.5) need a one-time license accept on their huggingface.co page (e.g. `huggingface.co/black-forest-labs/FLUX.1-dev`) with a `read`-scope token. Once per model per account.
