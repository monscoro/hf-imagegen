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

// 1. STIMMUNG-Sektion ist auf Standbilder gescoped, Video explizit ausgenommen.
check(
  "STIMMUNG nennt Standbild-Scope (generate_image/image_edit/compose_images)",
  pp.includes("NUR f\u00fcr Standbilder") &&
    pp.includes("generate_image/image_edit/compose_images")
);
check(
  "STIMMUNG nimmt generate_video motion/cuts aus",
  pp.includes("F\u00fcr generate_video (motion/cuts) gelten sie NICHT")
);
check(
  "STIMMUNG warnt vor Still-Fotobegriffen in motion",
  pp.includes("Still-Fotografie-Begriffe") || pp.includes("Still-Fotobegriffe")
);

// 2. Aktiver Injizierungs-Block traegt dieselbe Ausnahme.
check(
  "ACTIVE-Block nimmt generate_video motion/cuts aus",
  pp.includes("F\u00fcr generate_video motion/cuts NICHT anwenden")
);

// 3. generate_video-Description enthaelt den Guard (LLM sieht ihn am Tool).
check(
  "generate_video-Description: inclinations do NOT apply to motion/cuts",
  tp.includes("do NOT apply to 'motion'/'cuts'")
);

// 4. Header stabil: stripInclinationRules erkennt die Sektion weiterhin.
check(
  "stripInclinationRules matcht '== IMAGE SYSTEM PROMPT'",
  pp.includes('line.startsWith("== IMAGE SYSTEM PROMPT")') &&
    pp.includes("== IMAGE SYSTEM PROMPT / STIMMUNG ==")
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll inclination video-guard checks passed.");
