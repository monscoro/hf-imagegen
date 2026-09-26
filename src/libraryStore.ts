import * as fs from "fs";
import * as path from "path";
import { getCacheFile, resolveExistingCacheFile, dropLegacyCacheFile } from "./cachePaths";
import {
  CURATED_BOOKS,
  CURATED_RECORDS,
  LIBRARY_ASPECTS,
  type LibraryBook,
  type LibraryRecord,
} from "./curatedLibrary";

/**
 * Bibliotheks-Store (Bücher + Records + aktive Record-Refs), Pendant zu directiveStore.
 * Persistenz in library.json unter ~/.cache/image-gen/ (siehe cachePaths.ts),
 * damit der Stand ein Plugin-Update und den Namenswechsel ueberlebt. Curated-Bücher (skillset/lorebook) bleiben read-only.
 *
 * Aktivierung lebt in einem eigenen Array (activeRecords) statt als Kopie im Profil-Store:
 * kein Inhalts-Duplikat, kein Auseinanderlaufen bei update.
 */

/** Altes project-lokales Verzeichnis, nur noch als Lese-Fallback (siehe cachePaths). */
const LEGACY_PROJECT_TMP = path.join(__dirname, "tmp");
const STORE_FILE = getCacheFile("library.json");

interface PersistedLibrary {
  books: LibraryBook[];
  records: LibraryRecord[];
  activeRecords: string[];
}

const ID_RE = /^[a-z0-9_-]{1,64}$/;

function isValidId(s: string): boolean {
  return ID_RE.test(s);
}

/** Kanonische Ref-Form (lowercase), damit kuratierte Groß-IDs wie "A08" matchen. */
export function refOf(book: string, id: string): string {
  return `${book.trim().toLowerCase()}/${id.trim().toLowerCase()}`;
}

export function parseRef(ref: string): { book: string; id: string } | null {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) return null;
  return { book: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

function sanitizeBook(raw: unknown): LibraryBook | null {
  const b = raw as Partial<LibraryBook>;
  if (!b || typeof b.id !== "string") return null;
  const id = b.id.trim().toLowerCase();
  if (!isValidId(id)) return null;
  return {
    id,
    description: String(b.description ?? ""),
    source: "user",
    readonly: false,
  };
}

function sanitizeRecord(raw: unknown): LibraryRecord | null {
  const r = raw as Partial<LibraryRecord>;
  if (!r || typeof r.id !== "string" || typeof r.book !== "string") return null;
  const id = r.id.trim().toLowerCase();
  const book = r.book.trim().toLowerCase();
  if (!isValidId(id) || !isValidId(book)) return null;
  if (typeof r.content !== "string" || !r.content.trim()) return null;
  const keys = Array.isArray(r.keys)
    ? r.keys.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim())
    : [];
  return {
    id,
    book,
    aspect: String(r.aspect ?? "").trim().toLowerCase() || "general",
    keys,
    content: r.content.trim(),
    source: "user",
    readonly: false,
  };
}

function loadPersisted(): PersistedLibrary {
  try {
    const file = resolveExistingCacheFile("library.json", [path.join(LEGACY_PROJECT_TMP, "library.json")]);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedLibrary>;
      if (parsed && (Array.isArray(parsed.books) || Array.isArray(parsed.records))) {
        const books = (parsed.books ?? [])
          .map(sanitizeBook)
          .filter((b): b is LibraryBook => b !== null);
        const records = (parsed.records ?? [])
          .map(sanitizeRecord)
          .filter((r): r is LibraryRecord => r !== null);
        const activeRecords = Array.isArray(parsed.activeRecords)
          ? parsed.activeRecords
              .filter((r): r is string => typeof r === "string" && !!r.trim())
              .map((r) => r.trim().toLowerCase())
          : [];
        return { books, records, activeRecords: [...new Set(activeRecords)] };
      }
    }
  } catch {
    // corrupt file ignorieren
  }
  return { books: [], records: [], activeRecords: [] };
}

function savePersisted(store: PersistedLibrary): void {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
    dropLegacyCacheFile("library.json");
  } catch {
    // best-effort
  }
}

let cache: PersistedLibrary = loadPersisted();

function reloadCache(): void {
  cache = loadPersisted();
}

function persist(): void {
  savePersisted(cache);
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export function getAllBooks(): LibraryBook[] {
  const map = new Map<string, LibraryBook>();
  for (const b of CURATED_BOOKS) map.set(b.id, b);
  for (const b of cache.books) {
    if (!map.has(b.id)) map.set(b.id, b);
  }
  // Records mit eigenem (nicht persistiertem) Buch → Buch-Eintrag synthetisieren
  for (const r of cache.records) {
    if (!map.has(r.book)) {
      map.set(r.book, { id: r.book, description: r.book, source: "user", readonly: false });
    }
  }
  return Array.from(map.values());
}

export function getAllRecords(): LibraryRecord[] {
  const seen = new Set(CURATED_RECORDS.map((r) => refOf(r.book, r.id)));
  const out: LibraryRecord[] = [...CURATED_RECORDS];
  for (const r of cache.records) {
    if (seen.has(refOf(r.book, r.id))) continue; // curated hat Vorrang
    out.push(r);
  }
  return out;
}

export function getBookById(id: string): LibraryBook | null {
  const norm = id.trim().toLowerCase();
  return getAllBooks().find((b) => b.id === norm) ?? null;
}

export function getRecordById(book: string, id: string): LibraryRecord | null {
  const b = book.trim().toLowerCase();
  const i = id.trim().toLowerCase();
  return getAllRecords().find((r) => r.book.toLowerCase() === b && r.id.toLowerCase() === i) ?? null;
}

/** Facetten = bekannte Ausprägungen ∪ in User-Records tatsächlich genutzte. */
export function listAspects(): string[] {
  const set = new Set<string>(LIBRARY_ASPECTS as readonly string[]);
  for (const r of getAllRecords()) if (r.aspect) set.add(r.aspect);
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// Bücher
// ---------------------------------------------------------------------------

export function createBook(id: string, description: string): LibraryBook {
  const norm = id.trim().toLowerCase();
  if (!isValidId(norm))
    throw new Error(
      `Ungültiger Buch-Name "${id}". Erlaubt: a-z, 0-9, -, _ (1-64 Zeichen), z.B. "film-noir".`
    );
  if (getBookById(norm))
    throw new Error(`Buch "${norm}" existiert bereits (curated oder user). Nutze update oder einen anderen Namen.`);
  const book: LibraryBook = {
    id: norm,
    description: description.trim() || norm,
    source: "user",
    readonly: false,
  };
  cache.books.push(book);
  persist();
  return book;
}

export function updateBook(id: string, description: string): LibraryBook {
  const norm = id.trim().toLowerCase();
  const curated = CURATED_BOOKS.find((b) => b.id === norm);
  if (curated) throw new Error(`Buch "${norm}" ist kuratiert (read-only) und kann nicht geändert werden.`);
  const idx = cache.books.findIndex((b) => b.id === norm);
  if (idx === -1) throw new Error(`Buch "${norm}" nicht gefunden.`);
  const desc = description.trim();
  if (desc) cache.books[idx].description = desc;
  persist();
  return cache.books[idx];
}

export function deleteBook(id: string): { deletedRecords: string[] } {
  const norm = id.trim().toLowerCase();
  if (CURATED_BOOKS.some((b) => b.id === norm))
    throw new Error(`Buch "${norm}" ist kuratiert (read-only) und kann nicht gelöscht werden.`);
  if (!cache.books.some((b) => b.id === norm))
    throw new Error(`Buch "${norm}" nicht gefunden.`);
  const deletedRecords = cache.records.filter((r) => r.book === norm).map((r) => refOf(r.book, r.id));
  cache.records = cache.records.filter((r) => r.book !== norm);
  cache.books = cache.books.filter((b) => b.id !== norm);
  cache.activeRecords = cache.activeRecords.filter((ref) => !ref.startsWith(`${norm}/`));
  persist();
  return { deletedRecords };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface CreateRecordResult {
  record: LibraryRecord;
  bookCreated: boolean;
}

export function createRecord(params: {
  book: string;
  id: string;
  aspect: string;
  keys: string[];
  content: string;
}): CreateRecordResult {
  const bookId = params.book.trim().toLowerCase();
  const id = params.id.trim().toLowerCase();
  if (!isValidId(bookId))
    throw new Error(`Ungültiger Buch-Name "${params.book}". Erlaubt: a-z, 0-9, -, _ (1-64 Zeichen).`);
  if (!isValidId(id))
    throw new Error(`Ungültiger Record-Name "${params.id}". Erlaubt: a-z, 0-9, -, _ (1-64 Zeichen).`);
  if (!params.content.trim()) throw new Error("content darf nicht leer sein.");

  let bookCreated = false;
  if (!getBookById(bookId)) {
    createBook(bookId, bookId);
    bookCreated = true;
  }
  if (getRecordById(bookId, id))
    throw new Error(`Record "${refOf(bookId, id)}" existiert bereits. Nutze update oder einen anderen Namen.`);

  const record: LibraryRecord = {
    id,
    book: bookId,
    aspect: params.aspect.trim().toLowerCase() || "general",
    keys: params.keys.map((k) => k.trim()).filter(Boolean),
    content: params.content.trim(),
    source: "user",
    readonly: false,
  };
  cache.records.push(record);
  persist();
  return { record, bookCreated };
}

export function updateRecord(
  book: string,
  id: string,
  changes: { aspect?: string; keys?: string[]; content?: string }
): LibraryRecord {
  const ref = refOf(book.trim().toLowerCase(), id.trim().toLowerCase());
  const curated = CURATED_RECORDS.find((r) => refOf(r.book, r.id) === ref);
  if (curated) throw new Error(`Record "${ref}" ist kuratiert (read-only) und kann nicht geändert werden.`);
  const idx = cache.records.findIndex((r) => refOf(r.book, r.id) === ref);
  if (idx === -1) throw new Error(`Record "${ref}" nicht gefunden.`);
  const target = cache.records[idx];
  if (changes.aspect !== undefined) {
    const a = changes.aspect.trim().toLowerCase();
    if (a) target.aspect = a;
  }
  if (changes.keys !== undefined) {
    const k = changes.keys.map((x) => x.trim()).filter(Boolean);
    if (k.length) target.keys = k;
  }
  if (changes.content !== undefined && changes.content.trim()) {
    target.content = changes.content.trim();
  }
  persist();
  return target;
}

export function deleteRecord(book: string, id: string): void {
  const ref = refOf(book.trim().toLowerCase(), id.trim().toLowerCase());
  if (CURATED_RECORDS.some((r) => refOf(r.book, r.id) === ref))
    throw new Error(`Record "${ref}" ist kuratiert (read-only) und kann nicht gelöscht werden.`);
  const idx = cache.records.findIndex((r) => refOf(r.book, r.id) === ref);
  if (idx === -1) throw new Error(`Record "${ref}" nicht gefunden.`);
  cache.records.splice(idx, 1);
  cache.activeRecords = cache.activeRecords.filter((r) => r !== ref);
  persist();
}

// ---------------------------------------------------------------------------
// Aktivierung (eigener Stack, unabhängig von directives.json)
// ---------------------------------------------------------------------------

export function getActiveRecordRefs(): string[] {
  const all = getAllRecords();
  const valid = cache.activeRecords.filter((ref) => {
    const parsed = parseRef(ref);
    return !!parsed && all.some((r) => r.book.toLowerCase() === parsed.book && r.id.toLowerCase() === parsed.id);
  });
  if (valid.length !== cache.activeRecords.length) {
    cache.activeRecords = valid; // hängende Refs prunen
    persist();
  }
  return [...cache.activeRecords];
}

export function getActiveRecords(): LibraryRecord[] {
  const all = getAllRecords();
  const out: LibraryRecord[] = [];
  for (const ref of getActiveRecordRefs()) {
    const parsed = parseRef(ref);
    if (!parsed) continue;
    const found = all.find((r) => r.book.toLowerCase() === parsed.book && r.id.toLowerCase() === parsed.id);
    if (found && !out.some((r) => refOf(r.book, r.id) === ref)) out.push(found);
  }
  return out;
}

export function addActiveRecord(book: string, id: string): { record: LibraryRecord; alreadyActive: boolean } {
  const record = getRecordById(book, id);
  if (!record)
    throw new Error(
      `Record "${refOf(book.trim().toLowerCase(), id.trim().toLowerCase())}" nicht gefunden. ` +
        `Bücher/Records: inclination_prompt_list oder inclination_prompt_library({query:""}). ` +
        `Neues: inclination_prompt_manage({store:"record", action:"create", …}).`
    );
  const ref = refOf(record.book, record.id);
  const alreadyActive = getActiveRecordRefs().includes(ref);
  if (!alreadyActive) {
    cache.activeRecords.push(ref);
    persist();
  }
  return { record, alreadyActive };
}

export function removeActiveRecord(book: string, id: string): boolean {
  const ref = refOf(book.trim().toLowerCase(), id.trim().toLowerCase());
  if (!cache.activeRecords.includes(ref)) return false;
  cache.activeRecords = cache.activeRecords.filter((r) => r !== ref);
  persist();
  return true;
}

export function removeActiveRecordsOfBook(book: string): number {
  const norm = book.trim().toLowerCase();
  const before = cache.activeRecords.length;
  cache.activeRecords = cache.activeRecords.filter((r) => !r.startsWith(`${norm}/`));
  const removed = before - cache.activeRecords.length;
  if (removed) persist();
  return removed;
}

export function clearActiveRecords(): void {
  if (cache.activeRecords.length === 0) return;
  cache.activeRecords = [];
  persist();
}

// ---------------------------------------------------------------------------
// Test-Helfer
// ---------------------------------------------------------------------------

export function _reload(): void {
  reloadCache();
}

export function _getStoreFile(): string {
  return STORE_FILE;
}
