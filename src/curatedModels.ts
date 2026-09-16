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
    id: "Qwen/Qwen-Image-2512",
    description:
      "Qwen-Image-2512 — Neuere Version von Qwen-Image. 20B Parameter. Exzellente Textdarstellung, " +
      "präzise Bildbearbeitung, multimodales Verständnis. " +
      "Starke Allround-Qualität mit Apache 2.0 Lizenz.",
    style: "photorealistic, artistic, text-rendering",
    speed: "medium",
    access: "free",
    source: "curated",
    parameters: "20B",
    license: "Apache 2.0",
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
  {
    id: "black-forest-labs/FLUX.1-Krea-dev",
    description:
      "FLUX.1-Krea-dev — FLUX.1-dev mit Fashion-Tuning (BFL × Krea). " +
      "Stärke bei Editorial-Looks: Stoff, Haut, Glamour-Licht. " +
      "Erste Wahl für dark-fashion-editorial, power-spice und Fetish-Glamour-Hommagen " +
      "(Suzan-Randall-Ästhetik: Latex, Pin-up, Bondage-Couture). Non-Commercial, Freischaltung nötig.",
    style: "fashion-editorial, photorealistic, glamour",
    speed: "medium",
    access: "pro",
    source: "curated",
    parameters: "12B",
    license: "Non-Commercial",
  },
  {
    id: "stabilityai/stable-diffusion-3.5-large",
    description:
      "SD3.5-Large — 8B Parameter. Alternative Basis mit eigenem Stil-Repertoire. " +
      "Interessant für stilisierte Pin-up- und Anime-Crossover-Looks via LoRAs " +
      "(nächste HF-nahbare Route Richtung Pony-Hommage). Gated — Freischaltung nötig.",
    style: "artistic, illustration, stylized",
    speed: "medium",
    access: "pro",
    source: "curated",
    parameters: "8B",
    license: "Stability Community",
  },
  {
    id: "Tongyi-MAI/Z-Image-Turbo",
    description:
      "Z-Image-Turbo — Schnelle Turbo-Variante, Apache 2.0 (kommerziell nutzbar). " +
      "Gute Wahl für iterative Sessions: viele Takes in kurzer Zeit, " +
      "z.B. Posen- und Styling-Varianten für dark-fashion/power-spice durchprobieren.",
    style: "photorealistic, artistic",
    speed: "fast",
    access: "free",
    source: "curated",
    license: "Apache 2.0",
  },
];
