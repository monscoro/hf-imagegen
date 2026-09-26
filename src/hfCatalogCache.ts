import * as fs from "fs";
import * as path from "path";
import { getCatalogCacheDir } from "./pollinationsCache";

/**
 * Persistenter Cache fuer die HF-Provider-Zuordnung.
 *
 * Warum ein eigener Cache und nicht der vorhandene 12h-Speichercache aus
 * modelCache.ts: die Provider-Zuordnung ist die einzige HF-Information, die
 * sich nicht pro Request abfragen laesst, sondern einmal fuer den ganzen
 * Katalog gilt. Ohne Platte waere sie nach jedem Plugin-Reload weg, und die
 * 1000er-Seiten muessten neu geladen werden.
 *
 * Bewusst schmal gespeichert: nur id, Task, Likes und die Provider-Meldung.
 * Grund ist eine Eigenheit der API — `expand=inferenceProviderMapping`
 * schaltet die Antwort auf eine Minimalprojektion um und liefert dann nur noch
 * _id, id, likes und das Mapping. Die Felder fuer Ranking und Parameter
 * (downloads, trendingScore, safetensors, cardData) fehlen dort. Sie werden
 * deshalb gar nicht erst gespeichert, sondern bleiben beim server-seitigen
 * Ranking der Listenquellen. Das haelt die Datei bei ~180 KB fuer 2000 Modelle
 * und erspart einen Join.
 *
 * Ablage neben dem Pollinations-Katalog in ~/.cache/image-gen/;
 * IMAGE_GEN_CACHE_DIR gilt fuer beide Caches.
 *
 * Der Cache enthaelt ausschliesslich oeffentliche, unauthentifiziert abrufbare
 * Daten. Ein HF-Token wird nie hier abgelegt.
 *
 * Jede Funktion in diesem Modul ist fehlertolerant und wirft nie: ein kaputter
 * Cache darf keinen Tool-Aufruf scheitern lassen, er ist nur ein Cache.
 */
const HF_CATALOG_VERSION = 1;

const HF_API_BASE = "https://huggingface.co/api";

/** Nur Felder, die expand=inferenceProviderMapping tatsaechlich liefert. */
interface RawProviderMapping {
  provider?: unknown;
  status?: unknown;
  task?: unknown;
  performance?: { requestLatencyMs?: unknown } | null;
}

export type HFTask = "text-to-image" | "image-to-image";

export interface HFCatalogProvider {
  provider: string;
  /** live | error | staging — die einzige Verfuegbarkeitsangabe der API. */
  status: string;
  /** Gemessene Anfrage-Latenz in ms, 0 wenn die API nichts gemeldet hat. */
  latencyMs: number;
}

export interface HFCatalogEntry {
  id: string;
  task: HFTask;
  likes: number;
  providers: HFCatalogProvider[];
}

export interface HFCatalogEnvelope {
  version: number;
  fetchedAt: number;
  models: HFCatalogEntry[];
}

export function getHfCatalogCacheFile(): string {
  return path.join(getCatalogCacheDir(), "huggingface-catalog.json");
}

export function readHfCatalogCache(): HFCatalogEnvelope | null {
  try {
    const file = getHfCatalogCacheFile();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<HFCatalogEnvelope> | null;
    if (!parsed || typeof parsed !== "object") return null;
    // Version mismatch = andere Feldstruktur als der Parser erwartet: verwerfen.
    if (parsed.version !== HF_CATALOG_VERSION) return null;
    if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.models)) return null;
    return {
      version: parsed.version,
      fetchedAt: parsed.fetchedAt,
      models: parsed.models as HFCatalogEntry[],
    };
  } catch {
    return null;
  }
}

/** Schreibt atomar: erst in eine PID-spezifische Temp-Datei, dann rename. */
export function writeHfCatalogCache(models: HFCatalogEntry[], fetchedAt?: number): boolean {
  try {
    const file = getHfCatalogCacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const envelope: HFCatalogEnvelope = {
      version: HF_CATALOG_VERSION,
      fetchedAt: fetchedAt ?? Date.now(),
      models,
    };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(envelope), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Das Mapping kommt in zwei Formen und beide muessen gelesen werden:
 *   - Detail-Endpoint `/api/models/{id}?expand=…` liefert ein Objekt, das nach
 *     Providernamen aufgeschluesselt ist (`{ "fal-ai": { status, task, … } }`).
 *   - Listen-Endpoint `?…&expand=…` liefert ein Array mit `provider`-Feld je
 *     Eintrag. Genau diese Form sehen wir hier, das Objekt wird aber der
 *     Vollstaendigkeit halber mitgenommen.
 */
export function normalizeProviderMapping(raw: unknown): HFCatalogProvider[] {
  const providers: HFCatalogProvider[] = [];
  const push = (name: unknown, entry: RawProviderMapping) => {
    if (typeof name !== "string" || !name) return;
    if (!entry || typeof entry !== "object") return;
    const latency = entry.performance?.requestLatencyMs;
    providers.push({
      provider: name,
      status: typeof entry.status === "string" ? entry.status : "unknown",
      latencyMs: typeof latency === "number" && latency > 0 ? latency : 0,
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const entry = item as RawProviderMapping;
      push(entry.provider, entry);
    }
    return providers;
  }
  if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      push(name, value as RawProviderMapping);
    }
  }
  return providers;
}

/** Wirft Eintraege ohne brauchbare id weg, projiziert den Rest auf die Cache-Felder. */
export function projectHfModel(raw: unknown, task: HFTask): HFCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { id?: unknown; likes?: unknown; inferenceProviderMapping?: unknown };
  if (typeof m.id !== "string" || !m.id) return null;
  return {
    id: m.id,
    task,
    likes: typeof m.likes === "number" ? m.likes : 0,
    providers: normalizeProviderMapping(m.inferenceProviderMapping),
  };
}

const CATALOG_TASKS: HFTask[] = ["text-to-image", "image-to-image"];

/**
 * Laedt beide Katalogseiten in einem Durchgang. Der Server lieert hoechstens
 * 1000 Modelle je Seite, was fuer die Provider-Menge deutlich ueber der
 * tatsaechlichen Groesse liegt (226 text-to-image, 244 image-to-image mit
 * Mapping) — deshalb genuegen zwei Requests ohne Paginierung.
 *
 * `sort=likes` statt `createdAt`: nach Aktualitaet sortiert liefert Modelle
 * ohne jegliche Nutzung, die Liste ist dann unbrauchbar. Eine vollstaendige
 * Abfrage ueber alle 110k T2I-Modelle waere nur mit Cursor-Paginierung moeglich
 * und waere fuer die Auswahl sinnlos.
 */
export async function fetchHfCatalog(): Promise<HFCatalogEntry[]> {
  const collected: HFCatalogEntry[] = [];
  for (const task of CATALOG_TASKS) {
    const url =
      `${HF_API_BASE}/models?pipeline_tag=${task}` +
      `&sort=likes&direction=-1&limit=1000&expand=inferenceProviderMapping`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`HF catalog error for ${task}: ${response.status} ${response.statusText}`);
    }
    const raw = (await response.json()) as unknown;
    if (!Array.isArray(raw)) {
      throw new Error(`HF catalog response for ${task} was not an array.`);
    }
    for (const item of raw) {
      const entry = projectHfModel(item, task);
      if (entry) collected.push(entry);
    }
  }
  if (collected.length === 0) {
    throw new Error("HF catalog contained no usable model entries.");
  }
  return collected;
}
