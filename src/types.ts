export type ModelSource =
  | "curated"
  | "provider"
  | "trending"
  | "downloads"
  | "pollinations"
  | "image-edit";

export interface LoRAInfo {
  id: string;
  downloads: number;
  likes: number;
  base_model: string;
  tags: string[];
}

export interface ModelInfo {
  id: string;
  description: string;
  style: string;
  speed: "fast" | "medium" | "slow";
  access: "free" | "pro";
  source: ModelSource;
  cost?: string;
  parameters?: string;
  license?: string;
  compatible_loras?: LoRAInfo[];
  compatible_loras_count?: number;
  /** Kann das Modell ueberhaupt /v1/images/edits? (Pollinations aus /image/models, HF aus dem Curated-Set) */
  image_edit?: boolean;
  /** Empfohlene Referenzanzahl fuer image_edit. HF = immer 1, Pollinations = Katalogwert (nur Hinweis). */
  max_reference_images?: number;
  /** Kurzlabel fuer list_models, damit Multi-Image-Faehigkeit ohne Nachrechnen sichtbar ist. */
  multi_image?: string;
  /**
   * HF-Provider mit Status live, aus dem Katalog-Cache. Nur gesetzt, wenn das
   * Modell im Katalog steht — die API-Abfrage fuer die Liste deckt nicht alle
   * Modelle ab, dann bleibt das Feld weg statt auf leere Liste zu zeigen.
   */
  hf_providers?: string[];
  /** Von Hugging Face gemessene Anfrage-Latenz des schnellsten live-Providers in ms. */
  hf_latency_ms?: number;
}

export interface ModelListResult {
  source: ModelSource;
  models: ModelInfo[];
  current_default_model: string;
  note?: string;
}

export interface LoRAListResult {
  query: string;
  base_model_filter?: string;
  results: LoRAInfo[];
  count: number;
  usage: string;
  note?: string;
}

export type DirectiveSource = "curated" | "config" | "user";

export interface ImageDirective {
  id: string;
  description: string;
  prompt: string;
  source: DirectiveSource;
  readonly: boolean;
}
