import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verify, verifySync } from '@node-rs/argon2';
import { LoginRateLimiter, type RateLimitOptions } from './rate-limit';

export const SESSION_COOKIE_NAME = 'streetcraft_session';

const DEFAULT_SESSION_DURATION_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_LOGIN_BODY_BYTES = 1_024;
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
  secureCookies?: boolean;
  maxLoginBodyBytes?: number;
  rateLimit?: RateLimitOptions;
}

type LoginBodyResult =
  | { ok: true; password: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

export class Authentication {
  private readonly passwordHash: string;
  private readonly now: () => number;
  private readonly sessionDurationMs: number;
  private readonly secureCookies: boolean;
  private readonly maxLoginBodyBytes: number;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly limiter: LoginRateLimiter;

  constructor(options: AuthenticationOptions = {}) {
    this.passwordHash = validatePasswordHash(options.passwordHash ?? process.env.STREETCRAFT_PASSWORD_HASH);
    this.now = options.now ?? Date.now;
    this.sessionDurationMs = positiveInteger(
      options.sessionDurationMs,
      DEFAULT_SESSION_DURATION_MS,
      'sessionDurationMs',
    );
    this.maxLoginBodyBytes = positiveInteger(
      options.maxLoginBodyBytes,
      DEFAULT_MAX_LOGIN_BODY_BYTES,
      'maxLoginBodyBytes',
    );
    this.secureCookies = process.env.NODE_ENV === 'production' || options.secureCookies === true;
    this.limiter = new LoginRateLimiter(options.rateLimit, this.now);
  }

  async handleLogin(request: IncomingMessage, response: ServerResponse, remoteAddress: string): Promise<void> {
    const limit = this.limiter.check(remoteAddress);
    if (limit.limited) {
      sendJson(response, 429, { error: 'too many attempts' }, { 'retry-after': String(limit.retryAfterSeconds) });
      return;
    }

    const body = await readLoginBody(request, this.maxLoginBodyBytes);
    if (!body.ok) {
      sendJson(response, body.status, { error: body.error });
      return;
    }

    let passwordAccepted = false;
    try {
      passwordAccepted = await verify(this.passwordHash, body.password);
    } catch {
      passwordAccepted = false;
    }

    if (!passwordAccepted) {
      this.limiter.recordFailure(remoteAddress);
      sendJson(response, 401, { error: 'invalid credentials' });
      return;
    }

    this.limiter.clear(remoteAddress);
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

function validatePasswordHash(passwordHash: string | undefined): string {
  if (passwordHash === undefined || !passwordHash.startsWith('$argon2id$')) {
    throw new Error(INVALID_HASH_MESSAGE);
  }

  try {
    verifySync(passwordHash, randomBytes(32).toString('base64url'));
  } catch {
    throw new Error(INVALID_HASH_MESSAGE);
  }

  return passwordHash;
}

async function readLoginBody(request: IncomingMessage, maxBytes: number): Promise<LoginBodyResult> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return { ok: false, status: 415, error: 'application/json required' };
  }

  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume();
    return { ok: false, status: 413, error: 'request body too large' };
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += buffer.byteLength;
    if (byteLength > maxBytes) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }

  if (tooLarge) {
    return { ok: false, status: 413, error: 'request body too large' };
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
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

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const name = cookie.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      return cookie.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
  headers: Record<string, string> = {},
): void {
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
