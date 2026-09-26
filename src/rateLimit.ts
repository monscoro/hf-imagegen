import * as fs from "fs";
import * as path from "path";
import { getCacheFile, resolveExistingCacheFile, dropLegacyCacheFile } from "./cachePaths";

export interface RateLimitConfig {
  cooldownMs: number;
  dailyCap: number;
}

interface Entry {
  lastCall: number;
  count: number;
  dayKey: string;
}

const RATE_LIMIT_FILE = getCacheFile("rateLimit.json");

function loadEntry(): Entry {
  try {
    const file = resolveExistingCacheFile("rateLimit.json");
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Entry>;
      if (typeof parsed.lastCall === "number" && typeof parsed.count === "number") {
        // dayKey may be missing from pre-2026 configs; a blank dayKey forces an immediate reset.
        return { lastCall: parsed.lastCall, count: parsed.count, dayKey: parsed.dayKey ?? "" };
      }
    }
  } catch {
    // ignore corrupt file
  }
  return { lastCall: 0, count: 0, dayKey: "" };
}

function saveEntry(e: Entry): void {
  try {
    fs.mkdirSync(path.dirname(RATE_LIMIT_FILE), { recursive: true });
    fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(e), "utf-8");
    dropLegacyCacheFile("rateLimit.json");
  } catch {
    // persistence is best-effort
  }
}

const entry: Entry = loadEntry();

// Local calendar date key ("2026-09-16") — the daily counter resets at local midnight,
// not at the UTC epoch boundary (which would land mid-day or mid-evening for many timezones).
function currentDayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Milliseconds of the next local midnight.
function nextLocalMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 86_400_000;
}

export interface RateLimitStatus {
  ok: boolean;
  remaining: number;
  used: number;
  limit: number;
  resetInHours: number;
  error?: string;
}

export function checkRateLimit(cfg: RateLimitConfig): RateLimitStatus {
  const now = Date.now();
  const used = entry.count;
  const remaining = Math.max(0, cfg.dailyCap - used);
  const resetInHours = Math.ceil((nextLocalMidnight() - now) / 3600_000);

  if (currentDayKey() !== entry.dayKey) {
    entry.dayKey = currentDayKey();
    entry.count = 0;
    saveEntry(entry);
    return { ok: true, remaining: cfg.dailyCap, used: 0, limit: cfg.dailyCap, resetInHours };
  }

  if (entry.count >= cfg.dailyCap) {
    return {
      ok: false,
      remaining: 0,
      used,
      limit: cfg.dailyCap,
      resetInHours,
      error: `Daily generation limit reached (${cfg.dailyCap}). Resets at local midnight (~${resetInHours}h). ` +
        "This is the plugin's own guard (config 'Daily Generation Limit'), not your HF credits.",
    };
  }

  const elapsed = now - entry.lastCall;
  if (elapsed < cfg.cooldownMs) {
    const waitSec = Math.ceil((cfg.cooldownMs - elapsed) / 1000);
    return {
      ok: false,
      remaining,
      used,
      limit: cfg.dailyCap,
      resetInHours,
      error: `Generation cooldown. Wait ${waitSec}s before next generation.`,
    };
  }

  return { ok: true, remaining, used, limit: cfg.dailyCap, resetInHours };
}

export function recordGeneration(): void {
  entry.lastCall = Date.now();
  entry.count++;
  saveEntry(entry);
}
