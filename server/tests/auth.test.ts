import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
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
  const server = createStreetCraftServer({
    passwordHash,
    allowReducedArgon2CostForTests: true,
    ...options,
  });
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

  it('bounds active sessions and evicts the oldest session', async () => {
    const { baseUrl, server } = await startServer({ maxSessions: 2 });
    const first = sessionCookie(await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword }));
    const second = sessionCookie(await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword }));
    const third = sessionCookie(await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword }));

    expect(server.authentication.sessionCount).toBe(2);
    expect(server.authentication.getAuthenticatedSession(first)).toBeNull();
    expect(server.authentication.getAuthenticatedSession(second)).not.toBeNull();
    expect(server.authentication.getAuthenticatedSession(third)).not.toBeNull();
  });

  it('rejects duplicate and malformed session cookie fields', async () => {
    const { baseUrl, server } = await startServer();
    const cookie = sessionCookie(await postJson(baseUrl, '/api/auth/login', { password: acceptedPassword }));
    const cookieName = cookie.split('=', 1)[0]!;

    expect(server.authentication.getAuthenticatedSession(`${cookie}; ${cookie}`)).toBeNull();
    expect(server.authentication.getAuthenticatedSession(`${cookieName}; ${cookie}`)).toBeNull();
    expect(server.authentication.getAuthenticatedSession(cookie)).not.toBeNull();
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

  it('atomically limits overlapping password verifications', async () => {
    let releaseVerifications!: () => void;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerifications = resolve;
    });
    let startedVerifications = 0;
    let markReservationsFilled!: () => void;
    const reservationsFilled = new Promise<void>((resolve) => {
      markReservationsFilled = resolve;
    });
    const { baseUrl } = await startServer({
      rateLimit: { maxFailures: 2, windowMs: TEST_SESSION_DURATION_MS, maxTrackedKeys: 100 },
      passwordVerifierForTests: async () => {
        startedVerifications += 1;
        if (startedVerifications === 2) {
          markReservationsFilled();
        }
        await verificationGate;
        return false;
      },
    });

    const first = postJson(baseUrl, '/api/auth/login', { password: rejectedPassword });
    const second = postJson(baseUrl, '/api/auth/login', { password: rejectedPassword });
    const verifierIsBlocked = await Promise.race([
      reservationsFilled.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(verifierIsBlocked).toBe(true);

    const overlapping = postJson(baseUrl, '/api/auth/login', { password: rejectedPassword });
    const overlappingBeforeRelease = await Promise.race([
      overlapping,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    releaseVerifications();
    const completed = await Promise.all([first, second, overlapping]);

    expect(overlappingBeforeRelease?.status).toBe(429);
    expect(completed.map((response) => response.status)).toEqual([401, 401, 429]);
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

  it('keeps the server healthy when a login upload is aborted', async () => {
    const { baseUrl, server } = await startServer();
    let markReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      server.once('request', (request) => {
        request.once('aborted', resolve);
        markReceived();
      });
    });
    const unhandledReasons: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };
    process.prependListener('unhandledRejection', recordUnhandled);

    try {
      const request = httpRequest(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
      });
      request.on('error', () => undefined);
      request.write(randomBytes(32));
      await received;
      request.destroy();
      await aborted;
      await new Promise<void>((resolve) => setImmediate(resolve));

      const health = await fetch(`${baseUrl}/health`);

      expect(health.status).toBe(200);
      expect(unhandledReasons.length).toBe(0);
    } finally {
      process.removeListener('unhandledRejection', recordUnhandled);
    }
  });

  it('rejects an oversized streaming login body before upload EOF', async () => {
    const { baseUrl } = await startServer({ maxLoginBodyBytes: 64 });
    const request = httpRequest(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      },
    });
    request.on('error', () => undefined);
    const responsePromise = once(request, 'response').then(([response]) => response);
    request.write(randomBytes(65));

    const received = await Promise.race([
      responsePromise.then((response) => ({ response })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);

    if (received === null) {
      request.destroy();
    }
    expect(received).not.toBeNull();
    const response = received!.response as import('node:http').IncomingMessage;
    expect(response.statusCode).toBe(413);
    response.resume();
    await once(response, 'end');

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
  }, 2_000);

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

  it('rejects reduced-cost password hashes unless the constructor explicitly enables test cost', () => {
    expect(() => createStreetCraftServer({ passwordHash })).toThrow(
      'STREETCRAFT_PASSWORD_HASH must contain a valid Argon2id PHC hash',
    );

    expect(() => createStreetCraftServer({
      passwordHash,
      allowReducedArgon2CostForTests: true,
    })).not.toThrow();
  });

  it('rejects legacy Argon2 versions even when test cost is enabled', async () => {
    const legacyHash = await hash(randomBytes(24).toString('base64url'), {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      version: 0,
    });
    let thrown: unknown;

    try {
      createStreetCraftServer({
        passwordHash: legacyHash,
        allowReducedArgon2CostForTests: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'STREETCRAFT_PASSWORD_HASH must contain a valid Argon2id PHC hash',
    );
    expect((thrown as Error).message).not.toContain(legacyHash);
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
