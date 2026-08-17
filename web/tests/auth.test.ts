import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { hash } from '@node-rs/argon2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStreetCraftServer, type StreetCraftServer } from '../../server/src/index';
import { AuthRequestError, createAuthClient } from '../src/auth/auth-client';
import { createSessionStore } from '../src/auth/session-store';

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

async function startServer(now: () => number): Promise<{ baseUrl: string; server: StreetCraftServer }> {
  const server = createStreetCraftServer({ passwordHash, now });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

function createRealBrowserFetch(baseUrl: string): typeof fetch {
  let cookie: string | undefined;
  return async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/')) {
      throw new Error('auth client must use a same-origin relative URL');
    }
    if (init?.credentials !== 'same-origin') {
      throw new Error('auth client must explicitly use same-origin credentials');
    }

    const headers = new Headers(init.headers);
    if (cookie !== undefined) {
      headers.set('cookie', cookie);
    }
    const response = await fetch(`${baseUrl}${input}`, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) {
      cookie = setCookie.split(';', 1)[0];
    }
    return response;
  };
}

describe('browser auth client and in-memory session state', () => {
  it('retains only public authentication state after a real login', async () => {
    const now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl } = await startServer(() => now);
    const store = createSessionStore(() => now);
    const client = createAuthClient({ store, fetch: createRealBrowserFetch(baseUrl) });

    const session = await client.login(acceptedPassword);

    expect(session).toEqual({ authenticated: true, expiresAt: now + 15 * 60 * 1_000 });
    expect(store.get()).toEqual(session);
    expect(Object.keys(store.get())).toEqual(['authenticated', 'expiresAt']);
  });

  it('throws a typed generic error for a rejected password', async () => {
    const now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl } = await startServer(() => now);
    const store = createSessionStore(() => now);
    const client = createAuthClient({ store, fetch: createRealBrowserFetch(baseUrl) });

    let thrown: unknown;
    try {
      await client.login(rejectedPassword);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthRequestError);
    expect((thrown as AuthRequestError).status).toBe(401);
    expect((thrown as Error).message).toBe('Authentication failed');
    expect((thrown as Error).message).not.toContain(rejectedPassword);
    expect(store.get()).toEqual({ authenticated: false, expiresAt: null });
  });

  it('clears public session state and the server session on logout', async () => {
    const now = Date.UTC(2026, 7, 17, 12);
    const { baseUrl, server } = await startServer(() => now);
    const store = createSessionStore(() => now);
    const client = createAuthClient({ store, fetch: createRealBrowserFetch(baseUrl) });
    await client.login(acceptedPassword);
    expect(server.authentication.sessionCount).toBe(1);

    await client.logout();

    expect(store.get()).toEqual({ authenticated: false, expiresAt: null });
    expect(server.authentication.sessionCount).toBe(0);
  });

  it('clears in-memory UI state at absolute expiry', () => {
    let now = Date.UTC(2026, 7, 17, 12);
    const store = createSessionStore(() => now);
    store.set({ authenticated: true, expiresAt: now + 1_000 });
    expect(store.get()).toEqual({ authenticated: true, expiresAt: now + 1_000 });

    now += 1_000;

    expect(store.get()).toEqual({ authenticated: false, expiresAt: null });
  });
});
