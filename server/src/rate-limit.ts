export interface RateLimitOptions {
  maxFailures?: number;
  windowMs?: number;
  maxTrackedKeys?: number;
}

export interface RateLimitDecision {
  limited: boolean;
  retryAfterSeconds: number;
}

export type RateLimitReservationResult =
  | { limited: true; retryAfterSeconds: number }
  | { limited: false; reservation: RateLimitReservation };

export interface RateLimitReservation {
  readonly key: string;
  readonly id: symbol;
}

interface FailureWindow {
  failures: number;
  reservations: Set<symbol>;
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
    if (window === undefined || window.failures + window.reservations.size < this.maxFailures) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - this.now()) / 1_000)),
    };
  }

  reserve(key: string): RateLimitReservationResult {
    const decision = this.check(key);
    if (decision.limited) {
      return { limited: true, retryAfterSeconds: decision.retryAfterSeconds };
    }

    let window = this.failures.get(key);
    if (window === undefined) {
      if (!this.makeRoomForNewKey()) {
        return { limited: true, retryAfterSeconds: 1 };
      }
      window = this.newWindow();
      this.failures.set(key, window);
    }

    const reservation: RateLimitReservation = { key, id: Symbol('login-attempt') };
    window.reservations.add(reservation.id);
    return { limited: false, reservation };
  }

  completeFailure(reservation: RateLimitReservation): void {
    const window = this.failures.get(reservation.key);
    if (window === undefined || !window.reservations.delete(reservation.id)) {
      return;
    }
    window.failures += 1;
  }

  completeSuccess(reservation: RateLimitReservation): void {
    const window = this.failures.get(reservation.key);
    if (window === undefined || !window.reservations.delete(reservation.id)) {
      return;
    }
    window.failures = 0;
    if (window.reservations.size === 0) {
      this.failures.delete(reservation.key);
    }
  }

  recordFailure(key: string): void {
    this.pruneExpired();
    const existing = this.failures.get(key);
    if (existing !== undefined) {
      existing.failures += 1;
      return;
    }

    if (!this.makeRoomForNewKey()) {
      return;
    }

    const window = this.newWindow();
    window.failures = 1;
    this.failures.set(key, window);
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
        if (window.reservations.size === 0) {
          this.failures.delete(key);
        } else {
          window.failures = 0;
          window.resetsAt = now + this.windowMs;
        }
      }
    }
  }

  private makeRoomForNewKey(): boolean {
    if (this.failures.size < this.maxTrackedKeys) {
      return true;
    }
    for (const [key, window] of this.failures) {
      if (window.reservations.size === 0) {
        this.failures.delete(key);
        return true;
      }
    }
    return false;
  }

  private newWindow(): FailureWindow {
    return {
      failures: 0,
      reservations: new Set(),
      resetsAt: this.now() + this.windowMs,
    };
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}
