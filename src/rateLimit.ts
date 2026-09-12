export interface RateLimitConfig {
  cooldownMs: number;
  dailyCap: number;
}

interface Entry {
  lastCall: number;
  count: number;
  dayStart: number;
}

const entry: Entry = { lastCall: 0, count: 0, dayStart: 0 };

function currentDay(): number {
  const now = Date.now();
  return Math.floor(now / 86_400_000);
}

export function checkRateLimit(cfg: RateLimitConfig): { ok: true; remaining: number } | { ok: false; error: string } {
  const now = Date.now();

  if (currentDay() !== entry.dayStart) {
    entry.dayStart = currentDay();
    entry.count = 0;
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
}
