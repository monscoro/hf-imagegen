# HF Image Gen — Image Generation Plugin for LM Studio

> **Keywords:** lm studio plugin, image generation ai, text to image, flux lm studio, sdxl lm studio, hugging face image, lora support, ai image generator, stable diffusion

Generate images from text prompts using Hugging Face's Inference API — directly from your LM Studio chat. Supports FLUX, SDXL, Krea, Qwen-Image and other text-to-image models, plus LoRA adapters for style customization.

---

## Who This Is For

- Users wanting image generation without switching to a separate app or UI
- Developers testing text-to-image models alongside their LLM workflow
- Anyone wanting FLUX or SDXL output directly from their LM Studio chat session
- Creatives who want to iterate on image prompts in the same conversation they use for writing

---

## Installation

```bash
cd hf-image-gen
npm install
npx tsc
```

Load the built plugin in LM Studio.

---

## Configuration

| Field | Default | Description |
|---|---|---|
| HuggingFace API Token | _(blank)_ | **Required.** Your HF access token from huggingface.co/settings/tokens. Use a token with at least `read` scope. |
| Default Model | `black-forest-labs/FLUX.1-schnell` | HuggingFace model ID for generation. Overridable per call. |
| Output Directory | `~/hf-images` | Where generated images are saved. Created automatically. Supports `~/` prefix. |

---

## How It Works

1. You describe what you want in natural language
2. The plugin calls the HuggingFace Inference API with your prompt
3. The image is saved locally as a timestamped `.png` or `.jpeg` file
4. The file path is returned so LM Studio can display it

**Free tier note:** HuggingFace free accounts can use FLUX.1-schnell and SDXL. Cold-start on an inactive model may take 20-60 seconds on the first call. Subsequent calls are fast.

**Pro tier note:** FLUX.1-dev requires HuggingFace Pro credits. It produces noticeably higher quality output but costs credits per generation.

---

## Tools

### `generate_image` — Generate from text

Creates an image from a text prompt and saves it to disk.

```
generate_image(prompt, model_id?, negative_prompt?, lora_id?, lora_scale?)
```

| Parameter | Default | Description |
|---|---|---|
| `prompt` | _(required)_ | Text description. Be specific — subject, style, lighting, mood, quality terms. |
| `model_id` | _(config default)_ | Override the default model for this call. |
| `negative_prompt` | `""` | What to exclude (e.g. `"blurry, low quality, watermark"`). Not all models support this. |
| `lora_id` | `""` | HuggingFace model ID of a LoRA adapter. FLUX models only. Use `list_loras` to find IDs. |
| `lora_scale` | `1.0` | LoRA strength. `0.5-1.0` for subtle effects; `1.0-1.5` for strong. |

**Returns:**
- `file_path` — absolute path of the saved image
- `model_used` — which model was used
- `lora_used` — LoRA adapter applied, if any
- `file_size_bytes`, `mime_type`

**LoRA note:** LoRA generation routes through the `fal-ai` provider, which supports FLUX LoRA compositing. Pair FLUX LoRAs with a FLUX base model.

---

### `list_models` — Show available models

Returns available text-to-image models from different sources.

```
list_models(source?, provider?, limit?, include_loras?)
```

| Parameter | Default | Description |
|---|---|---|
| `source` | `"curated"` | Which model list to show: `curated`, `provider`, `trending`, or `downloads`. |
| `provider` | `""` | Inference provider name (required when `source="provider"`). Examples: `fal-ai`, `nscale`, `replicate`. |
| `limit` | `20` | Maximum number of models to return (5-50). Only for provider/trending/downloads. |
| `include_loras` | `false` | Include compatible LoRAs for each model. Slower, requires API calls. |

**Model Sources:**

| Source | Description |
|---|---|
| `curated` | 5 expert-verified models with detailed descriptions and LoRA compatibility info. |
| `provider` | Models from a specific inference provider. Useful when you have a preferred provider. |
| `trending` | Currently popular models on HuggingFace. Good for discovery, but can be unstable. |
| `downloads` | Most downloaded models. Established, battle-tested models. |

**Curated Models:**

| Model ID | Speed | Access | Notes |
|---|---|---|---|
| `black-forest-labs/FLUX.1-dev` | Medium | Pro | Cutting-edge quality, 12B params, non-commercial. |
| `black-forest-labs/FLUX.1-schnell` | Fast | Free | 1-4 steps, 12B params, Apache 2.0 (commercial). |
| `krea/Krea-2-Turbo` | Medium | Free | Photorealism-optimized, 13B params, 8 steps. |
| `Qwen/Qwen-Image` | Medium | Free | Best text rendering, 20B params, Apache 2.0. |
| `stabilityai/stable-diffusion-xl-base-1.0` | Medium | Free | 9,600+ LoRAs, 3B params, most ecosystem support. |

You can also pass any HuggingFace text-to-image model ID directly to `generate_image` without it appearing in this list.

---

### `list_loras` — Search LoRA adapters

Searches HuggingFace for LoRA adapters, optionally filtered by compatible base model.

```
list_loras(base_model?, search?, limit?)
```

| Parameter | Default | Description |
|---|---|---|
| `base_model` | `""` | Filter by compatible base model (e.g. `"black-forest-labs/FLUX.1-dev"`). |
| `search` | `""` | Keyword to filter (e.g. `"anime"`, `"portrait"`, `"watercolor"`). |
| `limit` | `15` | Maximum number of results (5-30). |

**Returns** a list of LoRA model IDs sorted by downloads. Pass the `id` field as `lora_id` in `generate_image`.

---

## Design Decisions

### Why 4 Model Sources?

We decided to offer 4 different model sources to balance stability, freshness, and discoverability:

- **curated**: 5 expert-verified models with detailed descriptions. Always available, no API calls needed. Best for quick discovery and reliable recommendations.

- **provider**: Models from a specific inference provider (e.g., fal-ai, nscale). Useful when you have a preferred provider or need specific pricing/features.

- **trending**: Currently popular models on HuggingFace. Good for discovering what the community is using right now, but results can change frequently.

- **downloads**: Most downloaded models. Shows established, battle-tested models with proven track records.

### Why These 5 Curated Models?

Each model was selected for a specific use case based on quality, speed, license, and ecosystem support:

| Model | Why It's Here |
|-------|---------------|
| **FLUX.1-dev** | Best quality for non-commercial use. 12B parameters, cutting-edge output. |
| **FLUX.1-schnell** | Fastest generation (1-4 steps). Apache 2.0 license = commercially usable. |
| **Krea-2-Turbo** | Best for photorealistic output. Optimized for natural textures and lighting. |
| **Qwen-Image** | Best text rendering (especially Chinese). 20B params, strong allround quality. |
| **SDXL** | Largest LoRA ecosystem (9,600+ adapters). Small model (3B), resource-friendly. |

### LoRA Compatibility

LoRAs are not universally compatible. Each base model supports specific LoRA types:

- **FLUX models** → FLUX LoRAs
- **SDXL models** → SDXL LoRAs
- **Krea models** → Krea LoRAs
- **Qwen models** → Qwen LoRAs

When you specify a `base_model` in `list_loras`, we filter results to show only compatible adapters. This prevents the common error of applying a FLUX LoRA to an SDXL model (which would fail or produce artifacts).

### Dynamic vs. Hardcoded

The curated model list is hardcoded for reliability — it's always available even without API access. All other sources (provider, trending, downloads) are fetched dynamically from the HuggingFace API to ensure fresh results.

---

## Example Prompts

**Photorealistic portrait:**
> "A cinematic close-up portrait of a woman in golden hour light, soft bokeh background, 85mm lens, film grain"

**Concept art:**
> "A futuristic megacity at night, neon reflections in rain puddles, cyberpunk aesthetic, ultra-detailed, 4K"

**With negative prompt:**
> prompt: `"A peaceful mountain lake at sunrise"`
> negative_prompt: `"people, cars, buildings, text, watermark"`

**With LoRA style:**
> First: `list_loras(base_model="black-forest-labs/FLUX.1-dev", search="anime")`
> Then: `generate_image(prompt="...", lora_id="alvdansen/flux-koda", lora_scale=0.8)`

**Using a specific model:**
> `generate_image(prompt="...", model_id="stabilityai/stable-diffusion-xl-base-1.0")`

---

## Prompt Tips

- **Be specific** — vague prompts produce average results. Name the subject, lighting, style, mood.
- **Quality terms** work: `ultra-detailed`, `8K`, `cinematic`, `professional photography`, `sharp focus`
- **Style references** help: `in the style of Studio Ghibli`, `watercolor illustration`, `photorealistic`, `oil painting`
- **Negative prompts** clean up common issues: `blurry, low quality, deformed hands, text, watermark, oversaturated`
- **FLUX models** understand natural language well — you can write full sentences rather than comma-separated tags

---

## Accepting Model Licenses

Some models require accepting their license on HuggingFace before they can be used:

1. Go to the model's page on huggingface.co (e.g. `huggingface.co/black-forest-labs/FLUX.1-schnell`)
2. Click **"Access repository"** and accept the license
3. Make sure your API token has at least `read` scope

This only needs to be done once per model per account.
