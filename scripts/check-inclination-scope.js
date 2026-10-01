"use strict";
// Funktionaler Test fuer das Working-Dir-Scoping des aktiven Inclination-Stacks.
// Braucht keinen LM-Studio-Host: die Stores werden direkt ueber einen
// gefaelschten Controller mit Working Dir angesprochen.
// Setzt einen CJS-Require-Hook gegen die kompilierten .js-Module. Die
// kompilierte Fassung landet laut tsconfig (outDir "./", rootDir "./src") im
// Repo-Root, nicht in src/ — *.js ist gitignored.
// Aufruf: npm run build && node scripts/check-inclination-scope.js
const fs = require("fs");
const os = require("os");
const path = require("path");

// outDir "./" + rootDir "./src" -> Build-Artefakte liegen neben src/
const outDir = path.join(__dirname, "..");
const built = path.join(outDir, "directiveStore.js");
if (!fs.existsSync(built)) {
  console.error("directiveStore.js fehlt — erst `npm run build` ausfuehren.");
  process.exit(1);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-gen-scope-"));
// IMAGE_GEN_CACHE_DIR: definitionStore/library.json + (none)-Bucket wandern
// ins Temp, echte Nutzerdateien bleiben unberuehrt.
process.env.IMAGE_GEN_CACHE_DIR = path.join(tmpRoot, "cache");

const { addActiveDirective, getActiveIds, bindActiveScope } = require(built);
const { addActiveRecord, getActiveRecordRefs, bindActiveScope: bindRecordScope } =
  require(path.join(outDir, "libraryStore.js"));
const { NO_WORKING_DIR_KEY } = require(path.join(outDir, "workspace.js"));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const dirA = path.join(tmpRoot, "project-a");
const dirB = path.join(tmpRoot, "project-b");
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });

// Controller-Fake: gibt einen festen Working Dir vor, sonst wirft er wie der
// echte SDK (kein Working Dir attached).
function ctlFor(dir) {
  return { getWorkingDirectory: () => dir };
}
const ctlNone = {
  getWorkingDirectory() {
    throw new Error("This prediction process is not attached to a working directory.");
  },
};

// --- 1) Startzustand ist leer -------------------------------------------------
bindActiveScope(ctlFor(dirA));
bindRecordScope(ctlFor(dirA));
check("Startzustand in frischem Working Dir: keine aktiven Profile", getActiveIds().length === 0,
  `erwartet 0, war ${getActiveIds().length}`);
check("Startzustand: keine aktiven Records", getActiveRecordRefs().length === 0);

// --- 2) Aktivieren in A ------------------------------------------------------
addActiveDirective("pose-action", "");
check("A: Profil nach Aktivierung aktiv", getActiveIds().includes("pose-action"));

// --- 3) Wechsel nach B: Stack darf NICHT mitkommen ---------------------------
bindActiveScope(ctlFor(dirB));
bindRecordScope(ctlFor(dirB));
check("B: Stack aus A wird NICHT angewendet", getActiveIds().length === 0,
  `erwartet 0, war ${getActiveIds().join(",")}`);
check("B: Records aus A werden NICHT angewendet", getActiveRecordRefs().length === 0);

// --- 4) Zurueck nach A: der Stack ist wieder da -----------------------------
bindActiveScope(ctlFor(dirA));
bindRecordScope(ctlFor(dirA));
check("A: Stack nach Rueckkehr wieder vorhanden", getActiveIds().includes("pose-action"));

// --- 5) B hat einen eigenen, unabhaengigen Stack -----------------------------
// Wichtig: erst auf B binden, DANN aktivieren. Ein Aktivieren ohne vorheriges
// Binden schreibt in den Bucket, auf dem der Store gerade steht — das ist der
// Fall, den der Broker (Preprocessor setzt den Key pro Turn) verhindert.
bindActiveScope(ctlFor(dirB));
bindRecordScope(ctlFor(dirB));
addActiveDirective("interaction", "");
check("B: eigener Stack, A unberuehrt", getActiveIds().includes("interaction") && !getActiveIds().includes("pose-action"),
  getActiveIds().join(","));

bindActiveScope(ctlFor(dirA));
check("A: Stack von B nicht sichtbar", getActiveIds().join(",") === "pose-action",
  getActiveIds().join(","));

// --- 6) Stack-Datei liegt im Working Dir -------------------------------------
// A hat eine (dort wurde aktiviert), B hat eine (dort wurde aktiviert) —
// entscheidend ist, dass die Dateien getrennt sind, nicht ihre Existenz.
const stackA = path.join(dirA, ".image-gen-inclinations.json");
const stackB = path.join(dirB, ".image-gen-inclinations.json");
check("Stack-Datei liegt in A", fs.existsSync(stackA));
check("Stack-Datei liegt in B", fs.existsSync(stackB));
const rawA = JSON.parse(fs.readFileSync(stackA, "utf-8"));
const rawB = JSON.parse(fs.readFileSync(stackB, "utf-8"));
check("A und B haben getrennte Stacks",
  rawA.activeIds.includes("pose-action") && !rawA.activeIds.includes("interaction") &&
  rawB.activeIds.includes("interaction") && !rawB.activeIds.includes("pose-action"),
  `A=${JSON.stringify(rawA.activeIds)} B=${JSON.stringify(rawB.activeIds)}`);
check("A und B sind verschiedene Dateien", stackA !== stackB);

// --- 7) Ohne Working Dir: eigener Bucket -------------------------------------
bindActiveScope(ctlNone);
bindRecordScope(ctlNone);
check("ohne Working Dir: nichts aus A/B aktiv", getActiveIds().length === 0,
  getActiveIds().join(","));
addActiveDirective("narrative", "");
check("ohne Working Dir: Aktivierung wird gespeichert", getActiveIds().includes("narrative"));
check(
  "ohne Working Dir: (none)-Bucket im Cache, nicht in A",
  fs.existsSync(path.join(tmpRoot, "cache", "stacks", `${NO_WORKING_DIR_KEY}.json`))
);
// Der (none)-Bucket darf A nicht veraendern.
bindActiveScope(ctlFor(dirA));
check("A unveraendert nach (none)-Aktivierung", getActiveIds().join(",") === "pose-action",
  getActiveIds().join(","));

// --- 8) Records geteilte Datei: beide Arrays ueberleben ----------------------
bindActiveScope(ctlFor(dirA));
bindRecordScope(ctlFor(dirA));
addActiveRecord("ballerina", "class-arc");
check("A: Record aktiviert", getActiveRecordRefs().length > 0, getActiveRecordRefs().join(","));
const rawStack = JSON.parse(fs.readFileSync(stackA, "utf-8"));
check("Stack-Datei traegt activeIds UND activeRecords",
  Array.isArray(rawStack.activeIds) && Array.isArray(rawStack.activeRecords),
  JSON.stringify(Object.keys(rawStack)));
check("aktive Records fliessen nicht in activeIds", !rawStack.activeIds.includes("ballerina/class-arc"));

bindActiveScope(ctlFor(dirA));
check("A: Profil-Stack ueberlebt Record-Schreibvorgang", getActiveIds().includes("pose-action"),
  getActiveIds().join(","));

// --- 8b) Injektion selbst: wirkt nur im passenden Verzeichnis ---------------
// Der Stack in der Datei zu haben reicht nicht — entscheidend ist, was der
// promptPreprocessor tatsaechlich in den Prompt schreibt.
const { promptPreprocessor } = require(path.join(outDir, "promptPreprocessor.js"));
const IMG_BLOCK = "== ACTIVE IMAGE SYSTEM PROMPT ==";

async function renderFor(ctl) {
  const out = await promptPreprocessor(ctl, { getText: () => "Hallo" });
  return typeof out === "string" ? out : String(out);
}

// Controller-Fake, so wie ihn der Preprocessor benutzt.
function preCtl(getDir) {
  return {
    getWorkingDirectory: getDir,
    pullHistory: async () => [],
    needsNaming: async () => false,
    suggestName: () => {},
    getPluginConfig: () => ({ get: () => undefined }),
  };
}
const preA = preCtl(() => dirA);
const preNone = preCtl(() => { throw new Error("not attached to a working directory"); });

(async () => {
  const outA = await renderFor(preA);
  check("Preprocessor injiziert den Stack aus A", outA.includes(IMG_BLOCK) && outA.includes("pose-action"),
    outA.includes(IMG_BLOCK) ? "pose-action fehlt im Block" : "kein IMAGE-Block");

  // (none): der Stack mit 'narrative' liegt vor, darf aber NICHT injiziert werden.
  const outNone = await renderFor(preNone);
  check("(none)-Bucket wird nicht injiziert", !outNone.includes(IMG_BLOCK),
    outNone.includes(IMG_BLOCK) ? "IMAGE-Block trotz fehlendem Working Dir vorhanden" : "");
  check("(none) veraendert den A-Stack nicht",
    JSON.parse(fs.readFileSync(stackA, "utf-8")).activeIds.includes("pose-action"));

  const outB = await renderFor(preCtl(() => dirB));
  check("Preprocessor injiziert in B nur B-Eintraege",
    outB.includes("interaction") && !outB.includes("pose-action"),
    outB.includes("pose-action") ? "Stack aus A wandert mit" : "interaction fehlt");

  // --- 9) Globaler Altstand wird nicht uebernommen ----------------------------
  // Frisches Verzeichnis: dort gibt es keine Stack-Datei, also muss der Stack
  // leer sein, egal was die globale directives.json behauptet.
  const dirC = path.join(tmpRoot, "project-c");
  fs.mkdirSync(dirC, { recursive: true });
  const globalStore = path.join(tmpRoot, "cache", "directives.json");
  fs.writeFileSync(
    globalStore,
    JSON.stringify({ activeId: "setting", activeIds: ["setting"], directives: [] }, null, 2),
    "utf-8"
  );
  delete require.cache[require.resolve(built)];
  const fresh = require(built);
  fresh.bindActiveScope(ctlFor(dirC));
  check("globaler Altstand (activeIds) wird verworfen", fresh.getActiveIds().length === 0,
    fresh.getActiveIds().join(","));
  check("frischer Bucket erbt nichts", !fs.existsSync(path.join(dirC, ".image-gen-inclinations.json")));

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll inclination scope checks passed.");
})().catch((err) => {
  console.error("FAIL - Testabbruch:", err && err.stack ? err.stack : err);
  process.exit(1);
});
