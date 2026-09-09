# Image Generation Plugin for LM Studio — Text-to-Image via Hugging Face

> **Keywords:** lm studio plugin, image generation ai, text to image, flux lm studio, sdxl lm studio, hugging face image, lora support, ai image generator

Generate images from text prompts using Hugging Face's Inference API — directly from your LM Studio chat. Supports FLUX, SDXL, and other text-to-image models, plus LoRA adapters for style customization.

---

## Who This Is For

- Users wanting image generation without switching to a separate app or UI
- Developers testing text-to-image models alongside their LLM workflow
- Anyone wanting FLUX or SDXL output directly from their LM Studio chat session
- Creatives who want to iterate on image prompts in the same conversation they use for writing

---

## Installation

```bash
cd image
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

**Free tier note:** HuggingFace free accounts can use FLUX.1-schnell and SDXL. Cold-start on an inactive model may take 20–60 seconds on the first call. Subsequent calls are fast.

**Pro tier note:** FLUX.1-dev and FLUX.2-dev require HuggingFace Pro credits. They produce noticeably higher quality output but cost credits per generation.

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
| `lora_scale` | `1.0` | LoRA strength. `0.5–1.0` for subtle effects; `1.0–1.5` for strong. |

**Returns:**
- `file_path` — absolute path of the saved image
- `model_used` — which model was used
- `lora_used` — LoRA adapter applied, if any
- `file_size_bytes`, `mime_type`

**LoRA note:** LoRA generation routes through the `fal-ai` provider, which supports FLUX LoRA compositing. Pair FLUX LoRAs with a FLUX base model.

---

### `list_models` — Show available models

Returns the curated list of popular text-to-image models with speed, style, and access tier.

```
list_models()
```

Use when the user asks what models are available or wants to pick a different one.

**Available models:**

| Model ID | Speed | Access | Notes |
|---|---|---|---|
| `black-forest-labs/FLUX.1-schnell` | Fast | Free | State-of-the-art quality, free tier friendly |
| `black-forest-labs/FLUX.1-dev` | Medium | Pro | Higher quality than schnell, ~50 steps. Non-commercial. |
| `black-forest-labs/FLUX.2-klein` | Fast (<1s) | Free | Real-time generation. Apache 2.0, fully open. |
| `black-forest-labs/FLUX.2-dev` | Slow | Pro | 32B parameter flagship. Best quality. Non-commercial. |
| `stabilityai/stable-diffusion-xl-base-1.0` | Medium | Free | SDXL 1024px — stable and widely supported. |

You can also pass any HuggingFace text-to-image model ID directly to `generate_image` without it appearing in this list.

---

### `list_loras` — Search LoRA adapters

Searches HuggingFace for LoRA adapters compatible with FLUX base models.

```
list_loras(search?)
```

| Parameter | Default | Description |
|---|---|---|
| `search` | `""` | Keyword to filter (e.g. `"anime"`, `"portrait"`, `"watercolor"`). Blank returns popular FLUX LoRAs. |

**Returns** a list of LoRA model IDs sorted by downloads. Pass the `id` field as `lora_id` in `generate_image`.

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
> First: `list_loras("anime")` → find a LoRA ID
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
