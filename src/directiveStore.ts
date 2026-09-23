import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ImageDirective, DirectiveSource } from "./types";
import { CURATED_DIRECTIVES } from "./curatedDirectives";

const PROJECT_TMP = path.join(__dirname, "tmp");
const CACHE_DIR = path.join(os.homedir(), ".cache", "hf-image-gen");
const STORE_FILE = (() => {
  // Try project-local tmp/ first (dev/test), fall back to ~/.cache/ (production)
  try {
    fs.mkdirSync(PROJECT_TMP, { recursive: true });
    return path.join(PROJECT_TMP, "directives.json");
  } catch {
    return path.join(CACHE_DIR, "directives.json");
  }
})();

interface PersistedStore {
  activeIds: string[];
  directives: ImageDirective[];
}

function loadPersisted(): PersistedStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as PersistedStore & { activeId?: string | null };
      if (
        parsed &&
        ("activeIds" in parsed || "activeId" in parsed || "directives" in parsed) &&
        Array.isArray(parsed.directives)
      ) {
        // sanitize
        const dirs: ImageDirective[] = parsed.directives
          .filter((d) => d && typeof d.id === "string" && typeof d.prompt === "string")
          .map((d) => ({
            id: String(d.id).trim().toLowerCase(),
            description: String(d.description ?? ""),
            prompt: String(d.prompt ?? ""),
            source: "user" as DirectiveSource,
            readonly: false,
          }));
        const fromArray = Array.isArray(parsed.activeIds)
          ? parsed.activeIds.filter((id): id is string => typeof id === "string" && !!id.trim())
          : [];
        const legacy = typeof parsed.activeId === "string" && parsed.activeId.trim()
          ? [parsed.activeId]
          : [];
        const activeIds = [...new Set([...(fromArray.length ? fromArray : legacy)].map((id) => id.trim().toLowerCase()))];
        return { activeIds, directives: dirs };
      }
    }
  } catch {
    // ignore corrupt file
  }
  return { activeIds: [], directives: [] };
}

function savePersisted(store: PersistedStore): void {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(
      STORE_FILE,
      // activeId als Mirror für Abwärtskompatibilität (ältere Plugin-Versionen lesen nur dieses Feld)
      JSON.stringify({ activeId: store.activeIds[0] ?? null, ...store }, null, 2),
      "utf-8"
    );
  } catch {
    // best-effort
  }
}

// In-memory cache, initialized once per plugin lifecycle
let cache: PersistedStore = loadPersisted();

function reloadCache(): void {
  cache = loadPersisted();
}

/**
 * Parse customDirectives config string.
 * Format pro Eintrag, getrennt durch Leerzeile(n) (\n\n) oder "---" Zeile:
 *   Zeile 1: "id: Kurzbeschreibung [ro|rw]"  (id = slug, Beschreibung = Rest, Flag optional)
 *   Zeile 2..n: Stimmungsprompt (kann mehrere Zeilen, werden mit ", " verbunden)
 *
 * Flag pro Eintrag (am Ende von Zeile 1, in eckigen Klammern):
 *   [ro], [read-only], [readonly], [lock], [locked]  -> read-only (LLM kann nicht ändern)
 *   [rw], [write], [writable], [rw+]                  -> RW (LLM darf via Tool ändern)
 *   Ohne Flag: default = read-only (sicher). Mit [rw] explizit RW schalten.
 *
 * Beispiele:
 *   cinematic: Episch-kinoreif, dramatisch [ro]
 *   cinematic volumetric lighting, 35mm film, dramatic shadows
 *
 *   my-experiment: Zum Testen [rw]
 *   dreamy pastel haze, soft pink
 *
 *   noir: Düster Film Noir
 *   low-key lighting, rain reflections, high contrast
 *
 * Einzeiler geht auch:
 *   cozy: Gemütlich warm | warm cozy lighting, soft tones [rw]
 */
export function parseConfigDirectives(text: string): ImageDirective[] {
  if (!text || !text.trim()) return [];
  const raw = text.trim();

  // Split by "---" separator or blank line (two newlines)
  // Normalize "---" lines to double newline
  const normalized = raw.replace(/^\s*---\s*$/gm, "\n\n");
  const blocks = normalized
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const result: ImageDirective[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let first = lines[0];
    let id = "";
    let description = "";
    let promptLines = lines.slice(1);
    let readonly = true; // default: read-only (sicher), [rw] schaltet auf RW

    // Detect trailing [ro]/[rw] flag on first line
    const flagMatch = first.match(/\s*\[(ro|rw|read-only|readonly|locked?|writable|write|rw\+)\]\s*$/i);
    if (flagMatch) {
      const flag = flagMatch[1].toLowerCase();
      readonly = /^(ro|read-only|readonly|locked?)$/.test(flag);
      // strip flag from first line
      first = first.slice(0, flagMatch.index).trim();
    }

    // Try to split first line into id + description/prompt
    // Supported separators: ":" , "|" , " - "
    let sepIdx = first.indexOf(":");
    let sep = ":";
    if (sepIdx === -1) {
      sepIdx = first.indexOf("|");
      sep = "|";
    }
    if (sepIdx === -1 && first.includes(" - ")) {
      sepIdx = first.indexOf(" - ");
      sep = " - ";
    }

    if (sepIdx !== -1) {
      id = first.slice(0, sepIdx).trim().toLowerCase();
      const rest = first.slice(sepIdx + sep.length).trim();
      // If promptLines empty and rest contains prompt-like content after "|",
      // rest is description. If rest contains "," and promptLines empty, treat rest as prompt? Heuristic:
      // First line after separator is always description. Prompt is remaining lines.
      // For single-line entries "id: desc | prompt", allow second separator
      if (rest.includes("|") && promptLines.length === 0) {
        const pipeIdx = rest.indexOf("|");
        description = rest.slice(0, pipeIdx).trim();
        const inlinePrompt = rest.slice(pipeIdx + 1).trim();
        if (inlinePrompt) promptLines = [inlinePrompt];
        // flag could be inside description part before pipe, e.g. "Desc [rw] | prompt"
        const descFlag = description.match(/\s*\[(ro|rw|read-only|readonly|locked?|writable|write|rw\+)\]\s*$/i);
        if (descFlag) {
          const flag = descFlag[1].toLowerCase();
          readonly = /^(ro|read-only|readonly|locked?)$/.test(flag);
          description = description.slice(0, descFlag.index).trim();
        }
      } else {
        description = rest;
        // flag could be at end of description when no inline prompt
        const descFlag2 = description.match(/\s*\[(ro|rw|read-only|readonly|locked?|writable|write|rw\+)\]\s*$/i);
        if (descFlag2) {
          const flag = descFlag2[1].toLowerCase();
          readonly = /^(ro|read-only|readonly|locked?)$/.test(flag);
          description = description.slice(0, descFlag2.index).trim();
        }
      }
    } else {
      // No separator: use slug of first line as id (flag already stripped from first)
      id = slugify(first);
      description = first;
    }

    if (!id) continue;
    // Normalize id: if not valid, slugify; then re-check for collisions (handles "my test" vs "my-test")
    let normalizedId = id;
    if (!/^[a-z0-9_-]{1,64}$/.test(normalizedId)) {
      normalizedId = slugify(normalizedId);
      if (!normalizedId) continue;
    }
    if (seen.has(normalizedId)) continue;
    seen.add(normalizedId);
    id = normalizedId;

    // If still no promptLines, try to use description as prompt fallback? No, need prompt.
    // If block was single line with "id: description", prompt is empty -> use description as prompt? Instead keep empty and skip if empty.
    const prompt = promptLines.join(", ").trim();
    // Allow single-line entry where prompt omitted -> treat description as prompt as well? Better require prompt.
    // If prompt empty but description non-empty, use description as prompt to avoid empty entries
    const finalPrompt = prompt || description;
    if (!finalPrompt) continue;

    result.push({
      id,
      description: description || id,
      prompt: finalPrompt,
      source: "config",
      readonly,
    });
  }
  return result;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function getAllDirectives(configText: string): ImageDirective[] {
  const curated = CURATED_DIRECTIVES;
  const fromConfig = parseConfigDirectives(configText);
  const fromFile = cache.directives;

  const map = new Map<string, ImageDirective>();
  for (const d of curated) map.set(d.id, d);
  for (const d of fromConfig) {
    if (!map.has(d.id)) map.set(d.id, d);
    // if curated already has id, config is ignored (curated readonly has priority)
  }
  for (const d of fromFile) {
    // user file overrides config but not curated
    if (curated.some((c) => c.id === d.id)) continue;
    map.set(d.id, d);
  }
  return Array.from(map.values());
}

export function getActiveIds(): string[] {
  return [...cache.activeIds];
}

export function getActiveDirectives(configText: string): ImageDirective[] {
  if (cache.activeIds.length === 0) return [];
  const all = getAllDirectives(configText);
  const kept: string[] = [];
  for (const id of cache.activeIds) {
    if (all.some((d) => d.id === id) && !kept.includes(id)) kept.push(id);
  }
  if (kept.length !== cache.activeIds.length) {
    // Dangling ids (z.B. gelöschter Config-Eintrag) prUNEN
    cache.activeIds = kept;
    savePersisted(cache);
  }
  return kept
    .map((id) => all.find((d) => d.id === id))
    .filter((d): d is ImageDirective => d !== undefined);
}

export function addActiveDirective(id: string, configText: string): ImageDirective {
  const norm = id.trim().toLowerCase();
  const all = getAllDirectives(configText);
  const found = all.find((d) => d.id === norm);
  if (!found) throw new Error(`Stimmungsprompt "${id}" nicht gefunden. Nutze inclination_prompt_list für Namen oder inclination_prompt_manage({action:"create", …}) für ein neues Profil.`);
  if (!cache.activeIds.includes(found.id)) {
    cache.activeIds.push(found.id);
    savePersisted(cache);
  }
  return found;
}

export function removeActiveDirective(id: string): boolean {
  const norm = id.trim().toLowerCase();
  if (!cache.activeIds.includes(norm)) return false;
  cache.activeIds = cache.activeIds.filter((i) => i !== norm);
  savePersisted(cache);
  return true;
}

export function clearActiveDirectives(): void {
  if (cache.activeIds.length === 0) return;
  cache.activeIds = [];
  savePersisted(cache);
}

export function createDirective(
  id: string,
  description: string,
  prompt: string,
  configText: string
): ImageDirective {
  const norm = id.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(norm))
    throw new Error(`Ungültiger Name "${id}". Erlaubt: a-z, 0-9, -, _ (1-64 Zeichen), z.B. "my-noir".`);
  if (!prompt.trim()) throw new Error("Prompt darf nicht leer sein.");
  const all = getAllDirectives(configText);
  if (all.some((d) => d.id === norm)) throw new Error(`Name "${norm}" existiert bereits (curated/config/user). Wähle einen anderen Namen oder nutze update.`);
  const dir: ImageDirective = {
    id: norm,
    description: description.trim() || norm,
    prompt: prompt.trim(),
    source: "user",
    readonly: false,
  };
  cache.directives.push(dir);
  savePersisted(cache);
  return dir;
}

export function updateDirective(
  id: string,
  description: string | undefined,
  prompt: string | undefined,
  configText: string
): ImageDirective {
  const norm = id.trim().toLowerCase();
  const curated = CURATED_DIRECTIVES.find((d) => d.id === norm);
  if (curated) throw new Error(`"${norm}" ist ein kuratiertes Beispiel-Profil (read-only) und kann nicht verändert werden.`);
  const fromConfig = parseConfigDirectives(configText).find((d) => d.id === norm);
  if (fromConfig) {
    if (fromConfig.readonly) {
      throw new Error(`"${norm}" ist in der Config als read-only markiert ([ro]). Entferne [ro] oder setze [rw] in der Config, um LLM-Änderungen zu erlauben.`);
    }
    // RW config entry: allow shadowing via user store (LLM darf ändern)
    let idx = cache.directives.findIndex((d) => d.id === norm);
    if (idx === -1) {
      // create shadow copy
      const shadow: ImageDirective = {
        id: norm,
        description: description?.trim() || fromConfig.description,
        prompt: prompt?.trim() || fromConfig.prompt,
        source: "user",
        readonly: false,
      };
      cache.directives.push(shadow);
      savePersisted(cache);
      return shadow;
    }
    // update existing shadow
    if (description !== undefined && description !== null) {
      const d = description.trim();
      if (d) cache.directives[idx].description = d;
    }
    if (prompt !== undefined && prompt !== null) {
      const p = prompt.trim();
      if (p) cache.directives[idx].prompt = p;
    }
    savePersisted(cache);
    return cache.directives[idx];
  }

  const idx = cache.directives.findIndex((d) => d.id === norm);
  if (idx === -1) throw new Error(`Profil "${norm}" nicht gefunden oder nicht editierbar. Nur per Tool erstellte Profile (user) oder Config mit [rw] können geändert werden.`);

  if (description !== undefined && description !== null) {
    const d = description.trim();
    if (d) cache.directives[idx].description = d;
  }
  if (prompt !== undefined && prompt !== null) {
    const p = prompt.trim();
    if (p) cache.directives[idx].prompt = p;
  }
  savePersisted(cache);
  return cache.directives[idx];
}

export function deleteDirective(id: string, configText: string): void {
  const norm = id.trim().toLowerCase();
  if (CURATED_DIRECTIVES.some((d) => d.id === norm))
    throw new Error(`"${norm}" ist kuratiertes Beispiel (read-only) und kann nicht gelöscht werden.`);
  const fromConfig = parseConfigDirectives(configText).find((d) => d.id === norm);
  if (fromConfig) {
    // Config entry: only deletable via Config UI, unless it's a RW shadow that can be reverted
    const shadowIdx = cache.directives.findIndex((d) => d.id === norm);
    if (shadowIdx !== -1) {
      // Delete only the shadow, revert to config base
      cache.directives.splice(shadowIdx, 1);
      cache.activeIds = cache.activeIds.filter((i) => i !== norm);
      savePersisted(cache);
      return;
    }
    if (fromConfig.readonly) {
      throw new Error(`"${norm}" ist in der Config als read-only [ro] und muss dort entfernt werden.`);
    }
    throw new Error(`"${norm}" stammt aus der Config und muss dort entfernt werden (auch bei [rw] nur Update via Tool, kein Löschen des Basis-Eintrags).`);
  }
  const idx = cache.directives.findIndex((d) => d.id === norm);
  if (idx === -1) throw new Error(`Profil "${norm}" nicht gefunden.`);
  cache.directives.splice(idx, 1);
  cache.activeIds = cache.activeIds.filter((i) => i !== norm);
  savePersisted(cache);
}

export function getDirectiveById(id: string, configText: string): ImageDirective | null {
  const norm = id.trim().toLowerCase();
  return getAllDirectives(configText).find((d) => d.id === norm) ?? null;
}

// For testing / reload
export function _reload(): void {
  reloadCache();
}

export function _getStoreFile(): string {
  return STORE_FILE;
}
