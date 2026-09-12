import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface RateLimitConfig {
  cooldownMs: number;
  dailyCap: number;
}

interface Entry {
  lastCall: number;
  count: number;
  dayStart: number;
}

const RATE_LIMIT_FILE = path.join(os.homedir(), ".cache", "hf-image-gen", "rateLimit.json");

function loadEntry(): Entry {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      const raw = fs.readFileSync(RATE_LIMIT_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Entry;
      if (typeof parsed.lastCall === "number" && typeof parsed.count === "number" && typeof parsed.dayStart === "number") {
        return parsed;
      }
    }
  } catch {
    // ignore corrupt file
  }
  return { lastCall: 0, count: 0, dayStart: 0 };
}

function saveEntry(e: Entry): void {
  try {
    fs.mkdirSync(path.dirname(RATE_LIMIT_FILE), { recursive: true });
    fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(e), "utf-8");
  } catch {
    // persistence is best-effort
  }
}

const entry: Entry = loadEntry();

function currentDay(): number {
  const now = Date.now();
  return Math.floor(now / 86_400_000);
}

export function checkRateLimit(cfg: RateLimitConfig): { ok: true; remaining: number } | { ok: false; error: string } {
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

export function recordGeneration(): void {
  entry.lastCall = Date.now();
  entry.count++;
  saveEntry(entry);
}
