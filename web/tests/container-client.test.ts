import { describe, expect, it, vi } from 'vitest';
import {
  createContainerClient,
  ContainerRequestError,
} from '../src/inspection/container-client';
import { createSessionStore, type SessionStore } from '../src/auth/session-store';

function validContainerResponse() {
  return {
    containerType: 'chest',
    size: 27,
    items: [
      {
        slot: 0,
        itemId: 'minecraft:diamond',
        count: 16,
        displayName: 'Diamond',
        safeTooltipData: { damage: 0, maxDamage: 0, glint: false },
      },
    ],
  };
}

function doubleChestResponse() {
  return {
    containerType: 'double_chest',
    size: 54,
    items: [
      {
        slot: 0,
        itemId: 'minecraft:emerald',
        count: 32,
        displayName: 'Emerald',
        safeTooltipData: { damage: 0, maxDamage: 0, glint: false },
      },
      {
        slot: 53,
        itemId: 'minecraft:netherite_sword',
        count: 1,
        displayName: 'Netherite Sword',
        safeTooltipData: { damage: 10, maxDamage: 1024, glint: true },
      },
    ],
  };
}

function makeFetch(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  return vi.fn(async (_url?: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const response = responses[Math.min(callIndex++, responses.length - 1)];
    if (response === undefined) {
      return new Response(null, { status: 404 });
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
      headers: new Headers(),
      redirected: false,
      statusText: '',
      type: 'basic' as ResponseType,
      url: '',
      clone: () => new Response(),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => '',
      bytes: async () => new Uint8Array(),
    } as Response;
  });
}

function authenticatedStore(): SessionStore {
  const store = createSessionStore(() => 1000);
  store.set({ authenticated: true, expiresAt: 999_999 });
  return store;
}

function unauthenticatedStore(): SessionStore {
  return createSessionStore(() => 1000);
}

describe('ContainerClient', () => {
  it('rejects requests when unauthenticated', async () => {
    const client = createContainerClient({
      sessionStore: unauthenticatedStore(),
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toThrow(ContainerRequestError);

    try {
      await client.fetchContainer('minecraft:overworld', 10, 64, 20);
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerRequestError);
      expect((error as ContainerRequestError).code).toBe('authentication_required');
      expect((error as ContainerRequestError).status).toBe(401);
    }
  });

  it('fetches a 27-slot chest successfully', async () => {
    const fetchFn = makeFetch([{ status: 200, body: validContainerResponse() }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    const data = await client.fetchContainer('minecraft:overworld', 10, 64, 20);

    expect(data.containerType).toBe('chest');
    expect(data.size).toBe(27);
    expect(data.items).toHaveLength(1);
    const firstItem = data.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem!.itemId).toBe('minecraft:diamond');
    expect(firstItem!.count).toBe(16);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('fetches a 54-slot double chest', async () => {
    const fetchFn = makeFetch([{ status: 200, body: doubleChestResponse() }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    const data = await client.fetchContainer('minecraft:overworld', 10, 64, 20);

    expect(data.containerType).toBe('double_chest');
    expect(data.size).toBe(54);
    expect(data.items).toHaveLength(2);
    expect(data.items[0]?.slot).toBe(0);
    expect(data.items[1]?.slot).toBe(53);
  });

  it('throws on 404 container not found', async () => {
    const fetchFn = makeFetch([{ status: 404, body: { error: 'container_not_found' } }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'container_not_found' });
  });

  it('throws on 401 expired session', async () => {
    const fetchFn = makeFetch([{ status: 401, body: { error: 'authentication_required' } }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'authentication_required' });
  });

  it('throws on 503 service unavailable', async () => {
    const fetchFn = makeFetch([{ status: 503, body: { error: 'service_unavailable' } }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'service_unavailable' });
  });

  it('throws on network failure', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network error'); });
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'request-failed' });
  });

  it('throws on invalid JSON response', async () => {
    const fetchFn = vi.fn(async (): Promise<Response> => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('not json'); },
      headers: new Headers(),
      redirected: false,
      statusText: '',
      type: 'basic' as ResponseType,
      url: '',
      clone: () => new Response(),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => '',
      bytes: async () => new Uint8Array(),
    } as Response));
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('throws on invalid container schema', async () => {
    const fetchFn = makeFetch([{ status: 200, body: { containerType: 'invalid', size: 27, items: [] } }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('throws on invalid item data in response', async () => {
    const badResponse = {
      containerType: 'chest',
      size: 27,
      items: [
        { slot: 0, itemId: 'minecraft:diamond', count: -1, displayName: 'X', safeTooltipData: { damage: 0, maxDamage: 0, glint: false } },
      ],
    };
    const fetchFn = makeFetch([{ status: 200, body: badResponse }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await expect(
      client.fetchContainer('minecraft:overworld', 10, 64, 20),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('builds correct URL with dimension and coordinates', async () => {
    const fetchFn = makeFetch([{ status: 200, body: validContainerResponse() }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await client.fetchContainer('minecraft:the_nether', 100, 32, -50);

    const firstCall = fetchFn.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const calledUrl = String(firstCall?.[0] ?? '');
    expect(calledUrl).toContain('dimension=minecraft%3Athe_nether');
    expect(calledUrl).toContain('x=100');
    expect(calledUrl).toContain('y=32');
    expect(calledUrl).toContain('z=-50');
  });

  it('includes credentials and accept header', async () => {
    const fetchFn = makeFetch([{ status: 200, body: validContainerResponse() }]);
    const client = createContainerClient({
      sessionStore: authenticatedStore(),
      fetch: fetchFn,
    });

    await client.fetchContainer('minecraft:overworld', 10, 64, 20);

    const firstCall = fetchFn.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toEqual({ accept: 'application/json' });
  });
});
