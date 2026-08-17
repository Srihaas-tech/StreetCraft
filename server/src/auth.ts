import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verify, verifySync } from '@node-rs/argon2';
import { LoginRateLimiter, type RateLimitOptions } from './rate-limit';

export const SESSION_COOKIE_NAME = 'streetcraft_session';

const DEFAULT_SESSION_DURATION_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_SESSIONS = 10_000;
const DEFAULT_MAX_LOGIN_BODY_BYTES = 1_024;
const MINIMUM_ARGON2_MEMORY_KIB = 19_456;
const MINIMUM_ARGON2_TIME_COST = 2;
const INVALID_HASH_MESSAGE = 'STREETCRAFT_PASSWORD_HASH must contain a valid Argon2id PHC hash';

export interface AuthenticatedSession {
  authenticated: true;
  expiresAt: number;
}

interface StoredSession {
  expiresAt: number;
}

export interface AuthenticationOptions {
  passwordHash?: string;
  now?: () => number;
  sessionDurationMs?: number;
  maxSessions?: number;
  secureCookies?: boolean;
  maxLoginBodyBytes?: number;
  rateLimit?: RateLimitOptions;
  passwordVerifierForTests?: (passwordHash: string, password: string) => Promise<boolean>;
  allowReducedArgon2CostForTests?: true;
}

type LoginBodyResult =
  | { ok: true; password: string }
  | { ok: false; aborted: true }
  | { ok: false; status: 400 | 413 | 415; error: string; closeConnection?: boolean };

export class Authentication {
  private readonly passwordHash: string;
  private readonly now: () => number;
  private readonly sessionDurationMs: number;
  private readonly maxSessions: number;
  private readonly secureCookies: boolean;
  private readonly maxLoginBodyBytes: number;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly limiter: LoginRateLimiter;
  private readonly passwordVerifier: (passwordHash: string, password: string) => Promise<boolean>;

  constructor(options: AuthenticationOptions = {}) {
    if (options.passwordVerifierForTests !== undefined && options.allowReducedArgon2CostForTests !== true) {
      throw new Error('passwordVerifierForTests requires the explicit test-cost override');
    }
    this.passwordHash = validatePasswordHash(
      options.passwordHash ?? process.env.STREETCRAFT_PASSWORD_HASH,
      options.allowReducedArgon2CostForTests === true,
    );
    this.now = options.now ?? Date.now;
    this.sessionDurationMs = positiveInteger(
      options.sessionDurationMs,
      DEFAULT_SESSION_DURATION_MS,
      'sessionDurationMs',
    );
    this.maxSessions = positiveInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, 'maxSessions');
    this.maxLoginBodyBytes = positiveInteger(
      options.maxLoginBodyBytes,
      DEFAULT_MAX_LOGIN_BODY_BYTES,
      'maxLoginBodyBytes',
    );
    this.secureCookies = process.env.NODE_ENV === 'production' || options.secureCookies === true;
    this.limiter = new LoginRateLimiter(options.rateLimit, this.now);
    this.passwordVerifier = options.passwordVerifierForTests ?? verify;
  }

  async handleLogin(request: IncomingMessage, response: ServerResponse, remoteAddress: string): Promise<void> {
    const body = await readLoginBody(request, this.maxLoginBodyBytes);
    if (!body.ok) {
      if ('aborted' in body) {
        return;
      }
      if (body.closeConnection === true) {
        response.shouldKeepAlive = false;
        response.once('finish', () => request.destroy());
      }
      sendJson(response, body.status, { error: body.error });
      return;
    }

    const limit = this.limiter.reserve(remoteAddress);
    if (limit.limited) {
      sendJson(response, 429, { error: 'too many attempts' }, { 'retry-after': String(limit.retryAfterSeconds) });
      return;
    }

    let passwordAccepted = false;
    try {
      passwordAccepted = await this.passwordVerifier(this.passwordHash, body.password);
    } catch {
      passwordAccepted = false;
    }

    if (!passwordAccepted) {
      this.limiter.completeFailure(limit.reservation);
      sendJson(response, 401, { error: 'invalid credentials' });
      return;
    }

    this.limiter.completeSuccess(limit.reservation);
    const expiresAt = this.now() + this.sessionDurationMs;
    const sessionId = this.createSession(expiresAt);
    sendJson(
      response,
      200,
      { authenticated: true, expiresAt },
      { 'set-cookie': this.sessionCookie(sessionId) },
    );
  }

  handleLogout(request: IncomingMessage, response: ServerResponse): void {
    const sessionId = readSessionId(request.headers.cookie);
    if (sessionId !== null) {
      this.sessions.delete(sessionId);
    }

    sendJson(
      response,
      200,
      { authenticated: false },
      { 'set-cookie': this.clearedSessionCookie() },
    );
  }

  getAuthenticatedSession(cookieHeader: string | undefined): AuthenticatedSession | null {
    this.pruneExpiredSessions();
    const sessionId = readSessionId(cookieHeader);
    if (sessionId === null) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return null;
    }

    return { authenticated: true, expiresAt: session.expiresAt };
  }

  get sessionCount(): number {
    this.pruneExpiredSessions();
    return this.sessions.size;
  }

  private createSession(expiresAt: number): string {
    this.pruneExpiredSessions();
    if (this.sessions.size >= this.maxSessions) {
      const oldestSessionId = this.sessions.keys().next().value as string | undefined;
      if (oldestSessionId !== undefined) {
        this.sessions.delete(oldestSessionId);
      }
    }
    let sessionId: string;
    do {
      sessionId = randomBytes(32).toString('base64url');
    } while (this.sessions.has(sessionId));
    this.sessions.set(sessionId, { expiresAt });
    return sessionId;
  }

  private pruneExpiredSessions(): void {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private sessionCookie(sessionId: string): string {
    return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/${this.secureCookies ? '; Secure' : ''}`;
  }

  private clearedSessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secureCookies ? '; Secure' : ''}`;
  }
}

function validatePasswordHash(passwordHash: string | undefined, allowReducedCostForTests: boolean): string {
  if (passwordHash === undefined || !hasRequiredArgon2Parameters(passwordHash, allowReducedCostForTests)) {
    throw new Error(INVALID_HASH_MESSAGE);
  }

  try {
    verifySync(passwordHash, randomBytes(32).toString('base64url'));
  } catch {
    throw new Error(INVALID_HASH_MESSAGE);
  }

  return passwordHash;
}

function hasRequiredArgon2Parameters(passwordHash: string, allowReducedCostForTests: boolean): boolean {
  const parts = passwordHash.split('$');
  if (
    parts.length !== 6
    || parts[0] !== ''
    || parts[1] !== 'argon2id'
    || parts[2] !== 'v=19'
    || parts[4] === ''
    || parts[5] === ''
  ) {
    return false;
  }

  const parameters = new Map<string, number>();
  for (const parameter of parts[3]!.split(',')) {
    const match = /^(m|t|p)=([1-9][0-9]*)$/.exec(parameter);
    if (match === null || parameters.has(match[1]!)) {
      return false;
    }
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) {
      return false;
    }
    parameters.set(match[1]!, value);
  }

  if (parameters.size !== 3 || (parameters.get('p') ?? 0) < 1) {
    return false;
  }
  return allowReducedCostForTests
    || ((parameters.get('m') ?? 0) >= MINIMUM_ARGON2_MEMORY_KIB
      && (parameters.get('t') ?? 0) >= MINIMUM_ARGON2_TIME_COST);
}

async function readLoginBody(request: IncomingMessage, maxBytes: number): Promise<LoginBodyResult> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return { ok: false, status: 415, error: 'application/json required' };
  }

  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.pause();
    request.on('error', () => undefined);
    return { ok: false, status: 413, error: 'request body too large', closeConnection: true };
  }

  const body = await new Promise<Buffer | null | 'too-large'>((resolve) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;

    const removeBodyListeners = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
    };
    const settle = (result: Buffer | null | 'too-large'): void => {
      if (settled) {
        return;
      }
      settled = true;
      removeBodyListeners();
      resolve(result);
    };
    const onData = (chunk: Buffer | Uint8Array): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > maxBytes) {
        request.pause();
        settle('too-large');
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => settle(Buffer.concat(chunks));
    const onAborted = (): void => settle(null);
    const onError = (): void => settle(null);

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });

  if (body === null) {
    return { ok: false, aborted: true };
  }
  if (body === 'too-large') {
    return { ok: false, status: 413, error: 'request body too large', closeConnection: true };
  }

  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return { ok: false, status: 400, error: 'invalid request' };
  }

  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || typeof (value as { password?: unknown }).password !== 'string'
  ) {
    return { ok: false, status: 400, error: 'invalid request' };
  }

  return { ok: true, password: (value as { password: string }).password };
}

function readSessionId(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  let sessionId: string | null = null;
  let sessionCookieSeen = false;
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator === -1) {
      if (cookie.trim() === SESSION_COOKIE_NAME) {
        return null;
      }
      continue;
    }
    const name = cookie.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      if (sessionCookieSeen) {
        return null;
      }
      sessionCookieSeen = true;
      const value = cookie.slice(separator + 1).trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
        return null;
      }
      sessionId = value;
    }
  }
  return sessionId;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
  headers: Record<string, string> = {},
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}
