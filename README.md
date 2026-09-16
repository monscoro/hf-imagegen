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
| Default Edit Model | `black-forest-labs/FLUX.1-Kontext-dev` | Image-to-image model for `image_edit`. Must be editing-native (Kontext-dev or Qwen-Image-Edit). |
| Pollinations API Key | _(blank)_ | **Optional.** From enter.pollinations.ai. Blank = anonymous (1 req/15s, possible watermark). With key: higher limits, no watermark, paid models. Never share `sk_…` keys. |
| Output Directory | `~/hf-images` | Where images are saved. Created automatically. Supports `~/` prefix. Also the search base for bare filenames in `image_edit` and the scope of `list_output_images`. |
| Generation Cooldown (ms) | `5000` | Minimum gap between generations (both backends). |
| Daily Generation Limit | `50` | Max images per day, resets at midnight. |

---

## Backends

|  | `hf` (default) | `pollinations` |
|---|---|---|
| Provider | HuggingFace Inference Providers (auto/fal-ai/…) | Pollinations.ai |
| Token | HF token required | None (optional key for limits + no watermark) |
| Content filter | Provider-side moderation | Strict filter off by default (`safe=off`); illegal content still moderated |
| Negative prompt | ✅ supported | ❌ ignored (reported in response notes) |
| LoRA (`lora_id`) | ✅ FLUX via fal-ai | ❌ rejected with a clear error |
| Image editing | ✅ `image_edit` tool | ❌ (deferred) |
| Rate limit | Config cooldown + daily cap | Same, plus 15s anon / 5s with-key tier gap |
| Best for | Quality, LoRAs, editing, precise control | No-setup start, permissive fashion/editorial takes |

**Rule of thumb:** HuggingFace IDs ↔ `backend="hf"`, Pollinations IDs ↔ `backend="pollinations"`, editing-native IDs ↔ `image_edit`. Mixing them fails — the tools say so explicitly.

---

## Tools (9)

### `generate_image` — Generate from text

```
generate_image(prompt, model_id?, backend?, negative_prompt?, lora_id?, lora_scale?, width?, height?, seed?)
```

| Parameter | Default | Description |
|---|---|---|
| `prompt` | _(required)_ | Specific description — subject, style, lighting, mood, quality terms. |
| `model_id` | _(config default)_ | HF ID (backend `hf`) or Pollinations model (backend `pollinations`, blank = `klein`). |
| `backend` | `"hf"` | `"hf"` or `"pollinations"`. |
| `negative_prompt` | `""` | Exclusions. HF only — ignored on Pollinations. |
| `lora_id` | `""` | HF LoRA adapter ID. HF + FLUX only. |
| `lora_scale` | `1.0` | 0.5–1.0 subtle, higher = stronger. |
| `width` / `height` | `0` (= default) | Pollinations only (0–2048). Portrait e.g. 768×1152 for fashion editorial. |
| `seed` | `0` (= random) | Pollinations only, for reproducible results. |

Returns `file_path`, `backend`, `model_used`, sizes, remaining quota, and `notes` (ignored params, watermark hints).

### `image_edit` — Edit a reference image (HF only)

```
image_edit(image, prompt, model_id?, provider?, negative_prompt?, lora_id?, lora_scale?)
```

Reference image = **KEEP**, prompt = **CHANGE** (mirrors the Neigungsprompt gates). `image` accepts a local path, a bare filename (looked up in the output directory first), or a public URL. Default model is `defaultEditModel` (Kontext-dev). **Important:** only editing-native models work — base T2I models (FLUX.1-dev, SDXL, Qwen-Image) have no image-to-image provider mapping and fail; the error message says exactly that. `lora_id` is passed through to fal-ai (I2I effectiveness under verification — report observations).

### `list_models` — Browse models per backend

```
list_models(source?, provider?, limit?, include_loras?)
```

| Source | For | Notes |
|---|---|---|
| `curated` (default) | `generate_image` + `hf` | 10 expert-verified HF IDs, always available offline. |
| `image-edit` | `image_edit` | Editing-native IDs with verified I2I mapping (Kontext-dev, Qwen-Image-Edit). |
| `provider` | `generate_image` + `hf` | Needs `provider` (fal-ai, nscale, …). Never `pollinations` — use `source="pollinations"`. |
| `trending` / `downloads` | `generate_image` + `hf` | Live HF catalog. |
| `pollinations` | `generate_image` + `pollinations` | 8 models, no token. Response includes `pollinations_default_model`. |

LoRA lookup (`include_loras`) and `list_loras` are HF-only.

### `list_loras` — Search LoRA adapters (HF only)

```
list_loras(base_model?, search?, limit?)
```

Avoid `search` (HF search is strict, often empty) — filter by `base_model` only. Pass `id` as `lora_id` with `backend="hf"`.

### `list_output_images` — Browse results

```
list_output_images(sort?, limit?, offset?, filter?)
```

Paginated, compact listing of the output directory (newest first; `limit=1` = latest image). Use instead of reading large folders at once; feed `filename` into `image_edit`.

### `inclination_prompt_list` / `set` / `manage` — Style profiles

Persistent mood/style directives that indirectly guide how the LLM formulates image prompts (see below). `manage(action="create")` turns user descriptions into full profiles (LLM generates id/description/prompt); `set` activates; empty/`none` deactivates.

---

## Neigungsprompt System (Stimmungsprompts)

Active profiles are injected as system context every turn and act **indirectly**: the LLM weaves mood, style, and staging into `generate_image`/`image_edit` prompts instead of prefixing them.

**Sources:** `curated` (read-only examples in code) + `user` (LLM-created via `inclination_prompt_manage`, persisted in plugin storage `directives.json`).

**Curated layers:**

| Prompt | Layer | Answers |
|---|---|---|
| `pose-action`, `interaction`, `setting`, `narrative`, `camera-intimate` | Visual basics | Pose, relation, place, story, lens |
| `dark-fashion-editorial` (~119 words) | Aesthetic | Silhouette, materials, light-as-design, gates, designer anchor, intensity 6 |
| `power-spice-editorial` (~150 words) | Dynamics | Dominant/submissive as styling, exchange vector, editorial trance, power-read designers |
| `voice-martha` (~137 words) | Voice | How results are *talked about*: millennial, sharp, no AI filler — combinable with the visual layers |

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
| `black-forest-labs/FLUX.1-Kontext-dev` | **Edit default**: instruction-based I2I (fal/replicate/wavespeed verified) | pro (license) |
| `Qwen/Qwen-Image-Edit` | Precise edits, Apache 2.0 | free |

**Pollinations models** (via `list_models source="pollinations"`): `klein` (FLUX.2, default), `kontext`, `flux`, `uncensored-image-v2`, `anima`, `animagine` (anime/Pony-adjacent), `phoenix-1.0`, `klein-9b`.

---

## Workflows

**Generate:** describe → `generate_image` → file path. Try `backend="pollinations"` for zero-setup or permissive takes.

**Edit (KEEP/CHANGE):** reference (prior result, bare filename, or URL) + change instruction → `image_edit`. Example: *"same pose, latex dress instead of silk, keep everything else monochrome."*

**Own style library:** *"Create these Neigungsprompts: cinematic-noir, dreamy-pastel"* → LLM builds entries → `inclination_prompt_set` activates one.

**Community-alpha fallback (Pollinations):** if a `community/*` model fails, retry with `klein` or `flux`.

**Find results:** `list_output_images({limit:1})` → latest file → straight into `image_edit`.

---

## Example Prompts

**Photorealistic portrait:**
> "A cinematic close-up portrait of a woman in golden hour light, soft bokeh background, 85mm lens, film grain"

**Selective edit (B/W poster, two accents):**
> image: `"x-video-…-poster.jpg"`, prompt: `"Do not colorize the image, keep everything monochrome except: crimson red leather boots (matte, catching light) and an ornate golden mask emitting a soft radiant glow"`

**Pollinations, no token, portrait format:**
> `generate_image(prompt="...", backend="pollinations", model_id="klein", width=768, height=1152)`

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

**Base T2I models have no image-to-image mapping.** Verified per HF provider API: FLUX.1-dev, SDXL, Qwen-Image map to `text-to-image` only on every provider — retries are doomed, which a live reasoning trace confirmed. `image_edit` therefore defaults to editing-native `FLUX.1-Kontext-dev` (I2I on fal-ai/replicate/wavespeed), with `Qwen-Image-Edit` as alternative; the error names both. `list_models source="image-edit"` keeps the two worlds apart.

**Pollinations as second backend.** Filter off by default, no token, anonymous 1 req/15s (5s with free Seed key) — covers permissive fashion/editorial takes the HF pool filters. Limits are explicit: no negative prompt, no LoRAs, community alphas as fallback chain, optional key for watermark-free. Strength was deliberately omitted (not in the generic I2I spec; provider-specific and unverified).

**LoRAs via fal-ai.** `generate_image` routes LoRA calls to `fal-ai`; I2I LoRA passthrough exists and is honestly marked "under verification". Curated prompts stay under ~150 words to bound token cost on every-turn injection.

**Output browsing instead of directory dumps.** LLMs choke on large folders — `list_output_images` paginates the single output directory (the only place the plugin reads), and bare filenames resolve against it.

**Accepting model licenses:** some models (FLUX.1-dev/-Kontext-dev, SD3.5) need a one-time license accept on their huggingface.co page (e.g. `huggingface.co/black-forest-labs/FLUX.1-dev`) with a `read`-scope token. Once per model per account.
