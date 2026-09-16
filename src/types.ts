export type ModelSource = "curated" | "provider" | "trending" | "downloads";

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
  parameters?: string;
  license?: string;
  compatible_loras?: LoRAInfo[];
  compatible_loras_count?: number;
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
