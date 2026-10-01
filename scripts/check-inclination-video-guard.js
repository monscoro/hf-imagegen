"use strict";
// Minimaler Guard-Test ohne Deps: stellt sicher, dass die Inclination-
// Bereinigung fuer generate_video nicht unbemerkt verloren geht.
// Laeuft gegen src/*.ts als Text (kompiliertes JS ist gitignored).
// Aufruf: node scripts/check-inclination-video-guard.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(root, f), "utf-8");

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

const pp = read("promptPreprocessor.ts");
const tp = read("toolsProvider.ts");
const types = read("types.ts");
const ds = read("directiveStore.ts");
const ls = read("libraryStore.ts");

// 1. STIMMUNG-Sektion ist auf Standbilder gescoped, Video explizit ausgenommen.
check(
  "STIMMUNG nennt Standbild-Scope (generate_image/image_edit/compose_images)",
  pp.includes("NUR f\u00fcr Standbilder") &&
    pp.includes("generate_image/image_edit/compose_images")
);
check(
  "STIMMUNG nimmt generate_video motion/cuts aus",
  pp.includes("F\u00fcr generate_video (motion/cuts) gelten") && pp.includes("NICHT")
);
check(
  "STIMMUNG warnt vor Still-Fotobegriffen in motion",
  pp.includes("Still-Fotografie-Begriffe") || pp.includes("Still-Fotobegriffe")
);

// 2. Aktiver Injizierungs-Block: scope-bezogene Ausnahme, kein unbedingtes
//    "NICHT anwenden" mehr — das widersprueche dem VIDEO-Block bei scope 'both'.
check(
  "ACTIVE-Block nimmt generate_video motion/cuts aus",
  pp.includes("scope 'image'") &&
    pp.includes("Alle scope 'image'-Einträge bleiben Standbilder")
);

// 3. generate_video-Description enthaelt den Guard (LLM sieht ihn am Tool).
check(
  "generate_video-Description: inclinations do NOT apply to motion/cuts",
  tp.includes("scope 'image' do NOT apply to") &&
    tp.includes("scope 'video' or 'both' DO apply")
);

// 4. Header stabil: stripInclinationRules erkennt die Sektion weiterhin.
check(
  "stripInclinationRules matcht '== IMAGE SYSTEM PROMPT'",
  pp.includes('line.startsWith("== IMAGE SYSTEM PROMPT")') &&
    pp.includes("== IMAGE SYSTEM PROMPT / STIMMUNG ==")
);

// 5. Scope-Feld: Trennung Bild/Video ist im Code verankert (nicht nur Prosa).
check(
  "types.ts kennt InclinationScope (image|video|both)",
  types.includes('InclinationScope = "image" | "video" | "both"')
);
check(
  "directiveStore verwaltet scope (sanitize/create/update)",
  ds.includes("sanitizeInclinationScope") && ds.includes("scope?: InclinationScope")
);
check(
  "libraryStore verwaltet scope (sanitize/create/update)",
  ls.includes("sanitizeInclinationScope") && ls.includes("scope?: InclinationScope")
);
// Scope-Typ und Gueltigkeitsliste existieren EINMAL (types.ts) — die Stores
// validieren nur fremdes JSON und duerfen die Werteliste nicht selbst neu
// aufzischen: dann koennen Typ und Liste auseinanderlaufen.
check(
  "Scope-Definition ist zentral (types.ts als einzige Quelle)",
  read("types.ts").includes("export type InclinationScope") &&
    read("types.ts").includes("export const INCLINATION_SCOPES") &&
    ds.includes('from "./types"') &&
    ls.includes('from "./types"') &&
    !/const VALID_SCOPES\s*=\s*\[/.test(ds) &&
    !/const VALID_SCOPES\s*=\s*\[/.test(ls)
);
check(
  "curatedLibrary nutzt denselben Scope-Typ",
  read("curatedLibrary.ts").includes('import type { InclinationScope } from "./types"') &&
    !read("curatedLibrary.ts").includes('import("./types")')
);
check(
  "Preprocessor splittet ACTIVE VIDEO CHOREOGRAPHY ab",
  pp.includes("== ACTIVE VIDEO CHOREOGRAPHY ==")
);
// scope 'both' darf nicht zweimal wortgleich im Prompt stehen: der VIDEO-Block
// verweist auf den IMAGE-Block, Volltext nur fuer scope 'video'.
check(
  "VIDEO-Block referenziert scope=both statt es zu wiederholen",
  pp.includes("fmtProfileRef") && pp.includes("fmtRecordRef") &&
    pp.includes("videoOnlyProfiles") &&
    pp.includes("siehe IMAGE-Block")
);
check(
  "manage kennt scope-Parameter (image|video|both)",
  tp.includes('z.enum(["image", "video", "both"])')
);

// 6. Bewegungsvokabular am generate_video-Tool (Kamera + Subjekt, durationsskaliert).
check(
  "generate_video-Description nennt Motion vocabulary",
  tp.includes("Motion vocabulary") && tp.includes("slow dolly-in")
);

// 7. Kostentransparenz: Results tragen estimated_cost, Planung kennt flat pricing.
check(
  "Results tragen estimated_cost (image + video)",
  tp.includes("estimated_cost: estimateImageCost") && tp.includes("clip(s)")
);
// Abgerechnet wird, was gerendert wurde — nicht, was angefordert wurde.
// Ein Fehlschlag faellt beim Provider aus und darf nicht in die Kalkulation.
check(
  "estimated_cost zaehlt gerenderte, nicht angeforderte Cuts",
  tp.includes("succeeded.length} clip(s)") && tp.includes("von ${motions.length} angeforderten")
);
check(
  "Kosten-Helper loest Kurstabelle + Aliase auf",
  read("pollinations.ts").includes("getPollinationsKnownCost")
);
// Pollinations liefert Preise teils als String ("0.01"). Ohne Ueberleitung faellt
// der Preis stillschweigend raus und die Zeile wirkt gratis.
check(
  "Video-Preise ueberleben String-Zahlen",
  tp.includes("function parsePollenRate") &&
    tp.includes("parsePollenRate(cap.pricing?.completionVideoSeconds)")
);
// Der Cooldown-Schutz ist nur so gut wie sein Zeitstempel: steht er erst im
// Erfolgsfall, zaehlt ein fehlgeschlagener Call nicht und das Limit wird getrieben.
// Geprueft wird pro Request-Site, dass unmittelbar davor gestempelt wird.
check(
  "Cooldown-Stempel vor jedem Pollinations-Request",
  (() => {
    const stamp = "lastPollinationsCall = Date.now()";
    const sites = ["await downloadVideo(url, pollinationsKey)"];
    // Die beiden Pollinations-Bild-Calls: POST /v1/images/... mit body.
    let i = 0;
    while ((i = tp.indexOf("const res = await fetch(url, {", i)) !== -1) {
      if (tp.slice(Math.max(0, i - 300), i).includes("Pollinations")) sites.push("const res = await fetch(url, {");
      i += 1;
    }
    if (sites.length < 3) return false;
    return sites.every((site) => {
      const at = tp.indexOf(site);
      return at > 0 && tp.slice(Math.max(0, at - 300), at).includes(stamp);
    });
  })()
);
check(
  "Planungshinweis: flat per image + cheap-fail-Warnung",
  tp.includes("FLAT per image") && pp.includes("COST vs CAPABILITY")
);

// 8. Ballerina-Experiment: Config-Schalter blendet Buch/Profil überall aus.
const cfg = read("config.ts");
const cl = read("curatedLibrary.ts");
check(
  "Config kennt enableBallerinaLorebook",
  cfg.includes("enableBallerinaLorebook")
);
check(
  "Ballerina-Praedikate existieren",
  cl.includes("BALLERINA_BOOK_ID") && cl.includes("isBallerinaBook")
);
check(
  "toolsProvider filtert Ballerina (list/library/manage)",
  tp.includes('cfg.get("enableBallerinaLorebook")') &&
    tp.includes("isBallerinaBook") &&
    tp.includes("isBallerinaProfile")
);
check(
  "Preprocessor filtert Ballerina-Injektion",
  pp.includes("includeBallerina") && pp.includes("isBallerinaBook")
);

// 9. Working-Dir-Scoping: der aktive Stack darf ein Verzeichnis nicht
//    verlassen. Text-Grep ersetzt den Funktionstest nicht, verhindert aber,
//    dass jemand den Bind-Aufruf beim Refaktorieren einfach loescht.
const ws = read("workspace.ts");
const dsScope = read("directiveStore.ts");
const lsScope = read("libraryStore.ts");
check(
  "Stack liegt pro Working Dir (Datei im Verzeichnis, (none)-Bucket)",
  ws.includes(".image-gen-inclinations.json") &&
    ws.includes("NO_WORKING_DIR_KEY") &&
    ws.includes("activeStackFileFor")
);
check(
  "Preprocessor bindet den Stack pro Turn als Broker",
  pp.includes("bindProfileScope(ctl)") &&
    pp.includes("bindRecordScope(ctl)") &&
    pp.includes("setPredictionScopeKey")
);
check(
  "Tools binden den Stack (SDK reicht Working Dir nicht durch)",
  tp.includes("INCLINATION_TOOLS") && tp.includes("bindInclinationScope()")
);
check(
  "globaler Altstand wird verworfen (kein Erben zwischen Buckets)",
  dsScope.includes("return { activeIds: [], directives: dirs }") &&
    lsScope.includes("activeRecords: []")
);
check(
  "Antworten nennen den Working-Dir-Scope",
  tp.includes('applies_to: "nur dieses Verzeichnis"') && tp.includes("no_working_dir")
);
check(
  "Antworten unterscheiden gespeichert von wirksam (applied)",
  tp.includes("applied:") &&
    tp.includes("gespeichert, nicht aktiv") &&
    tp.includes("scopeReport()")
);
check(
  "SYSTEM_RULES: Startzustand leer, nichts vorausgewaehlt",
  pp.includes("Startzustand ist IMMER leer")
);

// 10. (none)-Sperre: der Block darf nur bei echtem Working Dir gebaut werden.
//     Sonst meldet das Tool "aktiv" und der Prompt enthaelt trotzdem nichts.
check(
  "(none) blockiert die Injektion (hasScope-Gate)",
  pp.includes("hasScope") &&
    pp.includes("inclinationsEnabled && hasScope") &&
    pp.includes("NO_WORKING_DIR_KEY")
);
check(
  "(none)-Hinweis in SYSTEM_RULES",
  pp.includes("applied = false") && pp.includes("gespeichert, nicht aktiv")
);

// 11. Block-Inhalte duerfen nur auf existierende Bloecke verweisen.
check(
  "motionNote nur wenn VIDEO-Block existiert",
  pp.includes("videoEnabled && videoTotal > 0")
);
check(
  "bothRef nur wenn IMAGE-Block existiert",
  pp.includes("imageTotal > 0")
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll inclination video-guard checks passed.");
