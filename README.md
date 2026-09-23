# HF Image Gen — Image Generation Plugin for LM Studio

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
cd hf-image-gen
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
| Output Directory | `~/hf-images` | Where images are saved. Created automatically. Supports `~/` prefix. Also the search base for bare filenames in `image_edit` and the scope of `list_output_images`. |
| Generation Cooldown (ms) | `5000` | Minimum gap between generations (both backends). |
| Daily Generation Limit | `75` | Max images per day, resets at **local** midnight. This is the plugin's own guard — it does **not** track HF credits. |
| Enable Inclination Prompts | `true` | Master switch for the Neigungsprompt subsystem. Off hides `inclination_prompt_*` tools and stops style-profile injection (stored active profiles resume when re-enabled). |

---

## Backends

|  | `hf` (default) | `pollinations` |
|---|---|---|
| Provider | HuggingFace Inference Providers (auto/fal-ai/…) | Pollinations.ai |
| Token | HF token required | API key required (enter.pollinations.ai/keys) |
| Content filter | Provider-side moderation | Strict filter off by default (`safe=off`); illegal content still moderated |
| Negative prompt | ✅ supported | ❌ ignored (reported in response notes) |
| LoRA (`lora_id`) | ✅ FLUX via fal-ai | ❌ rejected with a clear error |
| Image editing | ✅ `image_edit` (editing-native HF models) | ✅ `image_edit` (`POST /v1/images/edits`, default grok) |
| Rate limit | Config cooldown + daily cap | Same, plus 15s anon / 5s with-key tier gap |
| Best for | Quality, LoRAs, precise control | Quick tests, permissive fashion/editorial takes & edits |

**Rule of thumb:** HuggingFace IDs ↔ `backend="hf"`, Pollinations IDs ↔ `backend="pollinations"`, editing-native IDs ↔ `image_edit`. Mixing them fails — the tools say so explicitly.

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

### `image_edit` — Edit a reference image (hf or pollinations)

```
image_edit(image, prompt, backend?, model_id?, provider?, negative_prompt?, lora_id?, lora_scale?, quality?, name?)
```

Reference image = **KEEP**, prompt = **CHANGE** (mirrors the Neigungsprompt gates). `image` prefers an **absolute** local path (the `file_path` returned by an earlier result — relative paths resolve against the plugin process working directory, not the chat directory); a bare filename (looked up in the output directory first) or a public URL also work.

| Parameter | Default | Description |
|---|---|---|
| `backend` | `"hf"` | `"hf"` (needs HF token) or `"pollinations"` (needs pollinationsApiKey, `POST /v1/images/edits`). |
| `model_id` | _(backend default)_ | hf: `defaultEditModel` (`FLUX.2-dev`). pollinations: blank = `x-ai/grok-imagine-image-quality` (few filters); edit-capable IDs with `/v1/images/edits` include grok-imagine-image/-quality, kontext (strict), flux.2-*, gpt-image-2*. |
| `provider` / `negative_prompt` / `lora_id` | | HF only — ignored or rejected with pollinations. |
| `quality` | unset | pollinations only; documented for gpt-image/grok-imagine-image-2.0. |
| `name` | `""` | Optional filename slug for the result — same sanitize/append rules as `generate_image`. |

**hf:** only editing-native models work — base T2I models (FLUX.1-dev, SDXL, Qwen-Image) have no image-to-image provider mapping and fail; the error message says exactly that. `lora_id` is passed through to fal-ai (I2I effectiveness under verification). **pollinations:** default is deliberately non-restrictive (`grok-imagine-image-quality`) — kontext/seedream strict filters flag fashion-editorial and burn credits on failed edits; use them only as explicit fallback. Returns `file_path`, `output_dir`, `backend`, the full `quota` block, and a clear warning when the plugin's daily limit is hit.

### `list_models` — Browse models per backend

```
list_models(source?, provider?, limit?, include_loras?)
```

| Source | For | Notes |
|---|---|---|
| `curated` (default) | `generate_image` + `hf` | 11 expert-verified HF IDs, always available offline. |
| `image-edit` | `image_edit` + `hf` | Editing-native IDs with verified I2I mapping (FLUX.2-dev, Kontext-dev, Qwen-Image-Edit). |
| `provider` | `generate_image` + `hf` | Needs `provider` (fal-ai, nscale, …). Never `pollinations` — use `source="pollinations"`. |
| `trending` / `downloads` | `generate_image` + `hf` | Live HF catalog. |
| `pollinations` | `generate_image`/`image_edit` + `pollinations` | 16 models (4 free, 12 paid). Requires API key. Aliases: `flux`, `kontext`, `seedream5`. |

LoRA lookup (`include_loras`) and `list_loras` are HF-only.

### `list_loras` — Search LoRA adapters (HF only)

```
list_loras(base_model?, search?, limit?)
```

Avoid `search` (HF search is strict, often empty) — filter by `base_model` only. Pass `id` as `lora_id` with `backend="hf"`.

### `list_output_images` — Browse results & inputs

```
list_output_images(sort?, limit?, offset?, filter?)
```

Paginated, compact listing of the output directory — generated results **and** input/reference images (`image_edit` resolves bare filenames against it first; newest first, `limit=1` = latest image). Use instead of reading large folders at once; for `image_edit`, pass the absolute `output_directory` + `filename` (preferred over a bare filename).

### `inclination_prompt_list` / `set` / `manage` / `action` — Style profiles (gated by Enable Inclination Prompts)

Persistent mood/style directives that indirectly guide how the LLM formulates image prompts (see below). `manage(action="create")` turns user descriptions into full profiles (LLM generates id/description/prompt — **the only way to add new ones**; `set` on an unknown name errors with a pointer back to `manage`); `set` adds a profile to the active stack (same name again removes just that one; empty/`none` clears all — **multiple profiles can be active at once**) and returns **activation confirmation only** (ids + descriptions — read full prompt text via `manage(action="get")`, not via `set`). `action` is the **Dominatrix-Skillset library lookup**: `action=''` lists the catalog (`A01`–`A33` + `switching-kenosis`/`faith-father`, ids + keywords), an exact id or keyword returns the full German technique record for the LLM to weave into the *next* image prompt (on-demand, not persisted — source: `kristina-lorebook-archive-layer.md` §D + TavernCard `character_book`). Gated by the `Enable Inclination Prompts` config switch (default on) — when off, these tools are not registered and no style profile is injected into the LLM context.

---

## Neigungsprompt System (Stimmungsprompts)

Active profiles are injected as system context every turn and act **indirectly**: the LLM weaves mood, style, and staging into `generate_image`/`image_edit` prompts instead of prefixing them. **Stacking:** several profiles can be active at once (e.g. visual layer + `voice-martha` + `dominatrix-lorebook`) — all are injected, separated by `---`. The whole subsystem can be switched off via the `Enable Inclination Prompts` config field.

**Sources:** `curated` (read-only examples in code) + `user` (LLM-created via `inclination_prompt_manage`, persisted in plugin storage `directives.json`).

**Curated layers:**

| Prompt | Layer | Answers |
|---|---|---|
| `pose-action`, `interaction`, `setting`, `narrative`, `camera-intimate` | Visual basics | Pose, relation, place, story, lens |
| `dark-fashion-editorial` (~119 words) | Aesthetic | Silhouette, materials, light-as-design, gates, designer anchor, intensity 6 |
| `power-spice-editorial` (~150 words) | Dynamics | Dominant/submissive as styling, exchange vector, editorial trance, power-read designers |
| `voice-martha` (~137 words) | Voice | How results are *talked about*: millennial, sharp, no AI filler — combinable with the visual layers (stacking) |
| `dominatrix-lorebook` (~136 words) | Craft/Character | Session arc (role → service → peak → ceremonial wind-down), Lorelei masks, Seven Realm Arts, tones (rage/cold/empathic/party), Kristina look, hard filters — source: `kristina-lorebook-archive-layer.md` + TavernCard |
| `dominatrix-skillset` (~127 words) | Library lookup | **Bibliotheksfunktion:** full distillation with explicit `A01`–`A33` index (thematic groups) → fetch records via `inclination_prompt_action` (keyword/`''`=catalog); always-on core keeps role posture, impact ladder/safe zones, circulation checks, deprivation order, exit record |

**Typical workflow:** user describes moods → LLM creates entries via `inclination_prompt_manage(action="create")` → activates via `inclination_prompt_set` → every generation/edit follows the style. Methodology and 20+ examples: `Prompt-Inclination-Techniques.md`.

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

| Model | Alias | Access | Notes |
|---|---|---|---|
| `flux.1-schnell` | `flux` | free | Default model, fast |
| `flux.1-kontext-pro` | `kontext` | free | Instruction editing (`/v1/images/edits`), **strict filter** — flags fashion-editorial |
| `flux.2-klein-4b` | — | free | Fast, small, for quick tests |
| `z-image-turbo` | — | free | API default model |
| `flux.2-pro` | — | paid | Highest quality FLUX-2 |
| `flux.2-flex` | — | paid | Fast FLUX-2 variant |
| `grok-imagine-image-2.0` | — | paid | Very high quality, supports quality param |
| `grok-imagine-image-quality` | `aurora` | paid | Grok Pro, **pollinations edit default** (`/v1/images/edits`), few filters |
| `grok-imagine-image` | — | paid | Fast xAI model, edit-capable, few filters |
| `ideogram-v4-turbo` | — | paid | Best for text-in-image, logos |
| `wan-2.7-image` | — | paid | Good for detailed scenes |
| `qwen-image-3` | — | paid | Strong prompt adherence |
| `gemini-3.1-flash-image` | — | paid | Fast Gemini |
| `seedream-5.0-lite` | `seedream5` | paid | Very high quality, strict filter |
| `seedream-5.0-pro` | — | paid | Highest ByteDance quality |
| `gemini-3-pro-image` | — | paid | 4K, slow, highest quality |

---

## Workflows

**Generate:** describe → `generate_image` → file path. Use `backend="pollinations"` for quick iterations or permissive takes (requires API key).

**Edit (KEEP/CHANGE):** reference (prior result's absolute `file_path`, bare filename, or URL) + change instruction → `image_edit`. Example: *"same pose, latex dress instead of silk, keep everything else monochrome."* Backend `hf` (FLUX.2-dev etc.) or `pollinations` (default `grok-imagine-image-quality` — non-restrictive; via `/v1/images/edits`).

**Own style library:** *"Create these Neigungsprompts: cinematic-noir, dreamy-pastel"* → LLM builds entries → `inclination_prompt_set` activates one.

**Community-alpha fallback (Pollinations):** if a `community/*` model fails, retry with `klein` or `flux`.

**Find results:** `list_output_images({limit:1})` → `output_directory` + `filename` (absolute path) → straight into `image_edit`.

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

**Base T2I models have no image-to-image mapping.** Verified per HF provider API: FLUX.1-dev, SDXL, Qwen-Image map to `text-to-image` only on every provider — retries are doomed, which a live reasoning trace confirmed. `image_edit` therefore defaults to editing-native `FLUX.2-dev` (I2I on fal-ai/replicate), with `FLUX.1-Kontext-dev` and `Qwen-Image-Edit` as alternatives; the error names all three. `list_models source="image-edit"` keeps the two worlds apart.

**Pollinations as second backend.** Filter off by default; API key required since Sep 2026 (anonymous access removed). 15 models available: 4 free (flux.1-schnell, kontext, klein-4b, z-image-turbo), 11 paid (cost pollen). Use `list_models source="pollinations"` for current model list with costs. No negative prompt, no LoRAs, community alphas as fallback chain.

**LoRAs via fal-ai.** `generate_image` routes LoRA calls to `fal-ai`; I2I LoRA passthrough exists and is honestly marked "under verification". Curated prompts stay under ~150 words to bound token cost on every-turn injection.

**Output browsing instead of directory dumps.** LLMs choke on large folders — `list_output_images` paginates the single output directory (the only place the plugin reads: generated results and input/reference images alike), and bare filenames resolve against it first (then the process CWD). Tools return the absolute `output_dir`/`file_path`, explicitly telling the LLM *not* to strip paths to bare filenames when handing results to other plugins — absolute paths are preferred everywhere, since relative paths resolve against the plugin process CWD, not the chat directory.

**Daily guard is local, and it's not HF credits.** The quota block (`limit/used/remaining/resets_in_hours`) reflects the config'd `Daily Generation Limit`. After a live-test confusion ("0 remaining despite HF credits!"), the counter was rebuilt on the **local calendar day** (ready to reset at local midnight) and the response now labels itself a *plugin guard*, names the reset, and appends a clear warning at `remaining: 0`.

**Accepting model licenses:** some models (FLUX.1-dev/-Kontext-dev, SD3.5) need a one-time license accept on their huggingface.co page (e.g. `huggingface.co/black-forest-labs/FLUX.1-dev`) with a `read`-scope token. Once per model per account.
