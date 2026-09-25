import {
  getPollinationsModelCapabilities,
  getPollinationsCatalogCacheInfo,
} from "./pollinations";

/**
 * Preise fuer Modell-Listen.
 *
 * Wichtig: die Pollinations-Preise kommen NICHT aus einem eigenen Request.
 * /image/models liefert pro Modell ein `pricing`-Feld mit — dieselbe Quelle,
 * dieselbe 12h-TTL, derselbe Platten-Cache wie die Multi-Image-Faehigkeiten.
 * Vorher stand hier ein zweiter Fetch auf /v1/models, der zwei Nachteile hatte:
 * zwei Requests mit zwei Uhren (die einander widersprechen koennen) und — schlimmer
 * — ensureCache() schrieb bei JEDEM Fehlschlag ein leeres Ergebnis mit frischem
 * Zeitstempel ins 12h-Fenster. Ein einziger Timeout kostete damit bis zu 12 Stunden
 * lang alle Pollinations-Preise.
 *
 * HuggingFace bleibt eine statische Tabelle: die HF-Preise sind nicht maschinenlesbar.
 */

export interface CostEntry {
  cost: string;
  rawTokens: number;
}

function formatCost(tokens: number): string {
  if (tokens === 0) return "free";
  if (tokens < 0.001) return `~${tokens.toExponential(1)} pollen`;
  return `~${tokens.toFixed(4)} pollen`;
}

const HF_COSTS: Record<string, CostEntry> = {
  "black-forest-labs/FLUX.1-dev": { cost: "free (license needed)", rawTokens: 0 },
  "black-forest-labs/FLUX.1-schnell": { cost: "free", rawTokens: 0 },
  "black-forest-labs/FLUX.1-Krea-dev": { cost: "free (license needed)", rawTokens: 0 },
  "krea/Krea-2-Turbo": { cost: "free", rawTokens: 0 },
  "Qwen/Qwen-Image-2512": { cost: "free", rawTokens: 0 },
  "stabilityai/stable-diffusion-xl-base-1.0": { cost: "free", rawTokens: 0 },
  "stabilityai/stable-diffusion-3.5-large": { cost: "free (gated)", rawTokens: 0 },
  "Tongyi-MAI/Z-Image-Turbo": { cost: "free", rawTokens: 0 },
  "black-forest-labs/FLUX.2-dev": { cost: "free (license needed)", rawTokens: 0 },
  "black-forest-labs/FLUX.1-Kontext-dev": { cost: "free (license needed)", rawTokens: 0 },
  "Qwen/Qwen-Image-Edit": { cost: "free", rawTokens: 0 },
};

/** Preise aus dem (gecachten) Live-Katalog. Wirft nie: HF-only bleibt nutzbar. */
async function pollinationsCosts(): Promise<Record<string, CostEntry>> {
  const costs: Record<string, CostEntry> = {};
  try {
    const capabilities = await getPollinationsModelCapabilities();
    for (const [key, model] of capabilities) {
      // Aliase zeigen auf dasselbe Objekt — nur kanonische Namen bekommen einen Preis.
      if (key !== model.name.toLowerCase()) continue;
      const endpoints = model.supported_endpoints ?? [];
      const isImageModel =
        endpoints.includes("/v1/images/generations") ||
        endpoints.some((e) => e.startsWith("/image/"));
      if (!isImageModel) continue;
      const raw = model.pricing?.completionImageTokens;
      const cost = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
      if (isNaN(cost)) continue;
      costs[model.name] = { cost: formatCost(cost), rawTokens: cost };
    }
  } catch {
    // Katalog nicht erreichbar — HF-Preise reichen, Pollinations-Kosten bleiben leer.
  }
  return costs;
}

export async function getCost(modelId: string): Promise<string | undefined> {
  const all = await getAllCosts();
  return all[modelId]?.cost;
}

export async function getAllCosts(): Promise<Record<string, CostEntry>> {
  return { ...HF_COSTS, ...(await pollinationsCosts()) };
}

export async function getCacheInfo(): Promise<{ fetchedAt: Date; expiresInMs: number; modelCount: number }> {
  const info = getPollinationsCatalogCacheInfo();
  return {
    fetchedAt: info.fetchedAt ?? new Date(0),
    expiresInMs: info.expiresInMs,
    modelCount: Object.keys(await getAllCosts()).length,
  };
}
