import { type ModelInfo } from "./types";

export const CURATED_MODELS: ModelInfo[] = [
  {
    id: "black-forest-labs/FLUX.1-dev",
    description:
      "FLUX.1 Dev — Cutting-edge Qualität, exzellentes Prompt-Following. " +
      "12B Parameter. Zweitbestes FLUX-Modell nach FLUX.1-pro. " +
      "Guidance Distillation für bessere Effizienz. " +
      "Non-Commercial License.",
    style: "photorealistic, artistic",
    speed: "medium",
    access: "pro",
    source: "curated",
    parameters: "12B",
    license: "Non-Commercial",
    compatible_loras_count: 42672,
  },
  {
    id: "black-forest-labs/FLUX.1-schnell",
    description:
      "FLUX.1 Schnell — Extrem schnell (1-4 Steps) durch Latent Adversarial Diffusion Distillation. " +
      "12B Parameter. Apache 2.0 = kommerziell nutzbar. " +
      "Überraschend gute Qualität für die Geschwindigkeit.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "curated",
    parameters: "12B",
    license: "Apache 2.0",
    compatible_loras_count: 280,
  },
  {
    id: "krea/Krea-2-Turbo",
    description:
      "Krea 2 Turbo — Speziell für realistische Bilder optimiert. " +
      "13B Parameter. Hervorragende Texturen und natürliche Darstellung. " +
      "Nur 8 Steps für schnelle Generierung.",
    style: "photorealistic",
    speed: "medium",
    access: "free",
    source: "curated",
    parameters: "13B",
    license: "Krea 2 Community",
    compatible_loras_count: 1505,
  },
  {
    id: "Qwen/Qwen-Image",
    description:
      "Qwen-Image — 20B Parameter. Exzellente Textdarstellung (besonders Chinesisch!), " +
      "präzise Bildbearbeitung, multimodales Verständnis. " +
      "Starke Allround-Qualität mit Apache 2.0 Lizenz.",
    style: "photorealistic, artistic, text-rendering",
    speed: "medium",
    access: "free",
    source: "curated",
    parameters: "20B",
    license: "Apache 2.0",
    compatible_loras_count: 502,
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    description:
      "SDXL — Bewährtes Ökosystem mit 9.600+ Adapters/LoRAs. " +
      "3B Parameter. Ressourcenschonend, breite Community-Unterstützung. " +
      "Ideal für Einstieg und Experimente.",
    style: "photorealistic, artistic, illustration",
    speed: "medium",
    access: "free",
    source: "curated",
    parameters: "3B",
    license: "OpenRAIL++",
    compatible_loras_count: 9694,
  },
];
