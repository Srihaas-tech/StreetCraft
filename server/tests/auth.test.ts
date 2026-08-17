import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { hash } from '@node-rs/argon2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStreetCraftServer, type StreetCraftServer } from '../src/index';
import { LoginRateLimiter } from '../src/rate-limit';

const TEST_SESSION_DURATION_MS = 15 * 60 * 1_000;

let acceptedPassword: string;
let rejectedPassword: string;
let passwordHash: string;
const servers: StreetCraftServer[] = [];

beforeAll(async () => {
  acceptedPassword = randomBytes(24).toString('base64url');
  rejectedPassword = randomBytes(24).toString('base64url');
  passwordHash = await hash(acceptedPassword, {
    memoryCost: 4_096,
    timeCost: 1,
    parallelism: 1,
  });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

interface RunningServer {
  baseUrl: string;
  server: StreetCraftServer;
}

async function startServer(options: Parameters<typeof createStreetCraftServer>[0] = {}): Promise<RunningServer> {
  const server = createStreetCraftServer({ passwordHash, ...options });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

async function postJson(baseUrl: string, path: string, body: unknown, headers: HeadersInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).not.toBeNull();
  return setCookie!.split(';', 1)[0]!;
}

function sessionCookieAttributes(response: Response): string[] {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).not.toBeNull();
  return setCookie!.split(';').slice(1).map((attribute) => attribute.trim());
}

describe('StreetCraft password authentication', () => {
  it('creates an opaque server-side session for the correct password', async () => {
    const now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl, server } = await startServer({ now: () => now });

    const response = await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      expiresAt: now + TEST_SESSION_DURATION_MS,
    });
    const attributes = sessionCookieAttributes(response);
    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('SameSite=Strict');
    expect(attributes).toContain('Path=/');
    expect(attributes.some((attribute) => attribute.startsWith('Domain='))).toBe(false);
    expect(attributes.some((attribute) => attribute.startsWith('Max-Age='))).toBe(false);
    expect(attributes.some((attribute) => attribute.startsWith('Expires='))).toBe(false);
    expect(attributes).not.toContain('Secure');

    const cookie = sessionCookie(response);
    const sessionId = cookie.split('=', 2)[1]!;
    expect(sessionId.length).toBe(43);
    expect(/^[A-Za-z0-9_-]+$/.test(sessionId)).toBe(true);
    expect(server.authentication.getAuthenticatedSession(cookie)).toEqual({
      authenticated: true,
      expiresAt: now + TEST_SESSION_DURATION_MS,
    });
  });

  it('returns the same generic rejection for an incorrect password', async () => {
    const { baseUrl } = await startServer();

    const response = await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword });

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: 'invalid credentials' });
  });

  it('rejects and prunes an expired session using the injected clock', async () => {
    let now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl, server } = await startServer({ now: () => now });
    const login = await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword });
    const cookie = sessionCookie(login);
    expect(server.authentication.getAuthenticatedSession(cookie)).not.toBeNull();

    now += TEST_SESSION_DURATION_MS + 1;

    expect(server.authentication.getAuthenticatedSession(cookie)).toBeNull();
    expect(server.authentication.sessionCount).toBe(0);
  });

  it('rate limits the direct remote address before further login attempts', async () => {
    let now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl } = await startServer({
      now: () => now,
      rateLimit: { maxFailures: 2, windowMs: TEST_SESSION_DURATION_MS, maxTrackedKeys: 100 },
    });

    expect((await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword })).status).toBe(401);
    expect((await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword })).status).toBe(401);
    const limited = await postJson(
      baseUrl,
      '/api/auth/login',
      { password: acceptedPassword },
      { 'x-forwarded-for': '203.0.113.100' },
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('900');
    await expect(limited.json()).resolves.toEqual({ error: 'too many attempts' });

    now += TEST_SESSION_DURATION_MS;
    expect((await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword })).status).toBe(200);
  });

  it('clears the limiter after a successful login', async () => {
    const { baseUrl } = await startServer({
      rateLimit: { maxFailures: 2, windowMs: TEST_SESSION_DURATION_MS, maxTrackedKeys: 100 },
    });

    expect((await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword })).status).toBe(401);
    expect((await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword })).status).toBe(200);
    expect((await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword })).status).toBe(401);
    expect((await postJson(baseUrl, '/api/auth/login', { password: rejectedPassword })).status).toBe(401);
    expect((await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword })).status).toBe(429);
  });

  it('invalidates the presented session and clears its cookie idempotently', async () => {
    const { baseUrl, server } = await startServer();
    const login = await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword });
    const cookie = sessionCookie(login);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });

    expect(logout.status).toBe(200);
    expect(logout.headers.get('cache-control')).toBe('no-store');
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    await expect(logout.json()).resolves.toEqual({ authenticated: false });
    expect(server.authentication.getAuthenticatedSession(cookie)).toBeNull();

    const repeated = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(repeated.status).toBe(200);
  });

  it('enforces JSON content type, shape, syntax, and a small body limit', async () => {
    const { baseUrl } = await startServer({ maxLoginBodyBytes: 64 });

    const wrongType = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ password: acceptedPassword }),
    });
    expect(wrongType.status).toBe(415);

    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);

    const wrongShape = await postJson(baseUrl, '/api/auth/login', { password: 42 });
    expect(wrongShape.status).toBe(400);

    const oversized = await postJson(baseUrl, '/api/auth/login', {
      password: randomBytes(96).toString('base64url'),
    });
    expect(oversized.status).toBe(413);
  });

  it('adds Secure to auth cookies when configured', async () => {
    const { baseUrl } = await startServer({ secureCookies: true });

    const login = await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword });
    expect(sessionCookieAttributes(login)).toContain('Secure');

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(logout.headers.get('set-cookie')).toContain('Secure');
  });

  it('keeps auth cookies Secure in production even if configuration requests otherwise', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { baseUrl } = await startServer({ secureCookies: false });

      const login = await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword });

      expect(sessionCookieAttributes(login)).toContain('Secure');
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });

  it('fails closed for missing or malformed password hashes without echoing values', () => {
    const previous = process.env.STREETCRAFT_PASSWORD_HASH;
    delete process.env.STREETCRAFT_PASSWORD_HASH;
    try {
      expect(() => createStreetCraftServer()).toThrow('STREETCRAFT_PASSWORD_HASH must contain a valid Argon2id PHC hash');
    } finally {
      if (previous !== undefined) {
        process.env.STREETCRAFT_PASSWORD_HASH = previous;
      }
    }

    const malformed = randomBytes(32).toString('base64url');
    let thrown: unknown;
    try {
      createStreetCraftServer({ passwordHash: malformed });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('STREETCRAFT_PASSWORD_HASH must contain a valid Argon2id PHC hash');
    expect((thrown as Error).message).not.toContain(malformed);
  });
});

describe('login rate limiter storage', () => {
  it('bounds attacker-generated keys and prunes expired windows', () => {
    let now = Date.UTC(2026, 7, 17, 12);
    const limiter = new LoginRateLimiter(
      { maxFailures: 1, windowMs: 1_000, maxTrackedKeys: 2 },
      () => now,
    );

    limiter.recordFailure('192.0.2.1');
    limiter.recordFailure('192.0.2.2');
    limiter.recordFailure('192.0.2.3');
    expect(limiter.trackedKeyCount).toBe(2);

    now += 1_000;
    expect(limiter.trackedKeyCount).toBe(0);
  });
});
