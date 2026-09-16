"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
exports.recordGeneration = recordGeneration;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const RATE_LIMIT_FILE = path.join(os.homedir(), ".cache", "hf-image-gen", "rateLimit.json");
function loadEntry() {
    try {
        if (fs.existsSync(RATE_LIMIT_FILE)) {
            const raw = fs.readFileSync(RATE_LIMIT_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (typeof parsed.lastCall === "number" && typeof parsed.count === "number" && typeof parsed.dayStart === "number") {
                return parsed;
            }
        }
    }
    catch {
        // ignore corrupt file
    }
    return { lastCall: 0, count: 0, dayStart: 0 };
}
function saveEntry(e) {
    try {
        fs.mkdirSync(path.dirname(RATE_LIMIT_FILE), { recursive: true });
        fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(e), "utf-8");
    }
    catch {
        // persistence is best-effort
    }
}
const entry = loadEntry();
function currentDay() {
    const now = Date.now();
    return Math.floor(now / 86_400_000);
}
function checkRateLimit(cfg) {
    const now = Date.now();
    if (currentDay() !== entry.dayStart) {
        entry.dayStart = currentDay();
        entry.count = 0;
        saveEntry(entry);
    }
    if (entry.count >= cfg.dailyCap) {
        const tomorrow = (entry.dayStart + 1) * 86_400_000;
        const resetIn = Math.ceil((tomorrow - now) / 3600_000);
        return { ok: false, error: `Daily generation limit reached (${cfg.dailyCap}). Resets in ~${resetIn}h.` };
    }
    const elapsed = now - entry.lastCall;
    if (elapsed < cfg.cooldownMs) {
        const waitSec = Math.ceil((cfg.cooldownMs - elapsed) / 1000);
        return { ok: false, error: `Generation cooldown. Wait ${waitSec}s before next generation.` };
    }
    return { ok: true, remaining: cfg.dailyCap - entry.count };
}
function recordGeneration() {
    entry.lastCall = Date.now();
    entry.count++;
    saveEntry(entry);
}
