import * as fs from "fs";
import * as path from "path";
import { getCacheDir, getCacheFile } from "./cachePaths";

/**
 * Persistenter Cache fuer den Pollinations-Modellkatalog (/image/models).
 *
 * Warum auf Platte und nicht nur im Speicher: die Caches in modelCache.ts sind
 * prozesslokale `let`-Variablen. In LM Studio stirbt der Prozess bei jedem
 * Plugin-Reload, danach waere der 12h-TTL wertlos — jeder Reload holt den
 * Katalog neu. Auf Platte ueberlebt der Cache Reloads und Plugin-Updates.
 *
 * Ablage in ~/.cache/image-gen/ (neben rateLimit.json und directives.json)
 * und bewusst NICHT in tmp/ neben dem Plugin: ein Plugin-Update loescht das
 * tmp/-Verzeichnis, der Home-Cache nicht. Ueberschreiben laesst sich der Pfad
 * per IMAGE_GEN_CACHE_DIR, damit Tests und Probes die echte Datei nicht
 * anfassen.
 *
 * Der Cache enthaelt ausschliesslich den oeffentlichen, unauthentifiziert
 * abrufbaren Katalog. Der Pollinations-API-Key wird nie hier abgelegt.
 *
 * Jede Funktion in diesem Modul ist fehlertolerant und wirft nie: ein kaputter
 * Cache darf keinen Tool-Aufruf scheitern lassen, er ist nur ein Cache.
 */
const CACHE_VERSION = 1;

export interface CatalogCacheEnvelope {
  version: number;
  fetchedAt: number;
  models: unknown[];
}

export function getCatalogCacheDir(): string {
  return getCacheDir();
}

export function getCatalogCacheFile(): string {
  return getCacheFile("pollinations-catalog.json");
}

export function readCatalogCache(): CatalogCacheEnvelope | null {
  try {
    const file = getCatalogCacheFile();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<CatalogCacheEnvelope> | null;
    if (!parsed || typeof parsed !== "object") return null;
    // Version mismatch = andere Feldstruktur als der Parser erwartet: verwerfen.
    if (parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.models)) return null;
    return {
      version: parsed.version,
      fetchedAt: parsed.fetchedAt,
      models: parsed.models,
    };
  } catch {
    // korrupte Datei, kein Leserecht, … — alles ist fuer uns "kein Cache"
    return null;
  }
}

/**
 * Schreibt den Katalog atomar: erst in eine PID-spezifische Temp-Datei, dann
 * rename. Bricht der Prozess mitten im Schreiben ab, bleibt die alte Datei
 * intakt statt zur Haelfte beschrieben zu werden. Wird der Schreibvorgang
 * blockiert (read-only Plugin-Verzeichnis o. Ae.), meldet die Funktion false
 * und der Aufgeber faellt auf reinen Speicher-Cache zurueck.
 */
export function writeCatalogCache(models: unknown[], fetchedAt?: number): boolean {
  try {
    const file = getCatalogCacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const envelope: CatalogCacheEnvelope = {
      version: CACHE_VERSION,
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
