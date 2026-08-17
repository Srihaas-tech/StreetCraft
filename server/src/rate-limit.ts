export interface RateLimitOptions {
  maxFailures?: number;
  windowMs?: number;
  maxTrackedKeys?: number;
}

export interface RateLimitDecision {
  limited: boolean;
  retryAfterSeconds: number;
}

interface FailureWindow {
  failures: number;
  resetsAt: number;
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

export class LoginRateLimiter {
  private readonly failures = new Map<string, FailureWindow>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxTrackedKeys: number;

  constructor(
    options: RateLimitOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.maxFailures = positiveInteger(options.maxFailures, DEFAULT_MAX_FAILURES, 'maxFailures');
    this.windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS, 'windowMs');
    this.maxTrackedKeys = positiveInteger(options.maxTrackedKeys, DEFAULT_MAX_TRACKED_KEYS, 'maxTrackedKeys');
  }

  check(key: string): RateLimitDecision {
    this.pruneExpired();
    const window = this.failures.get(key);
    if (window === undefined || window.failures < this.maxFailures) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - this.now()) / 1_000)),
    };
  }

  recordFailure(key: string): void {
    this.pruneExpired();
    const existing = this.failures.get(key);
    if (existing !== undefined) {
      existing.failures += 1;
      return;
    }

    if (this.failures.size >= this.maxTrackedKeys) {
      const oldestKey = this.failures.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        this.failures.delete(oldestKey);
      }
    }

    this.failures.set(key, { failures: 1, resetsAt: this.now() + this.windowMs });
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  get trackedKeyCount(): number {
    this.pruneExpired();
    return this.failures.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, window] of this.failures) {
      if (window.resetsAt <= now) {
        this.failures.delete(key);
      }
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}
