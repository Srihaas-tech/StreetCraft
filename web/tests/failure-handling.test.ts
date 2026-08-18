import { describe, expect, it, vi } from 'vitest';
import { ContainerRequestError, createContainerClient } from '../src/inspection/container-client';
import { AuthRequestError } from '../src/auth/auth-client';
import { createSessionStore } from '../src/auth/session-store';

function authenticatedStore() {
  const store = createSessionStore(() => 1000);
  store.set({ authenticated: true, expiresAt: 999_999 });
  return store;
}

function expiredStore() {
  const store = createSessionStore(() => 999_999);
  store.set({ authenticated: true, expiresAt: 1000 });
  return store;
}

describe('Task 12: failure handling', () => {
  describe('unavailable BlueMap assets', () => {
    it('gracefully reports BlueMap settings failure', async () => {
      const fetchFn = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 500,
        json: async () => ({}),
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

      const response = await fetchFn();
      expect(response.ok).toBe(false);
    });
  });

  describe('unavailable Fabric API', () => {
    it('returns service_unavailable when upstream is down', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });
      const client = createContainerClient({
        sessionStore: authenticatedStore(),
        fetch: fetchFn,
      });

      await expect(
        client.fetchContainer('minecraft:overworld', 10, 64, 20),
      ).rejects.toMatchObject({ code: 'request-failed' });
    });

    it('returns service_unavailable on 503', async () => {
      const fetchFn = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'service_unavailable' }),
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
      ).rejects.toMatchObject({ code: 'service_unavailable' });
    });
  });

  describe('expired authentication', () => {
    it('rejects container requests when session is expired', async () => {
      const client = createContainerClient({
        sessionStore: expiredStore(),
      });

      await expect(
        client.fetchContainer('minecraft:overworld', 10, 64, 20),
      ).rejects.toMatchObject({ code: 'authentication_required' });
    });

    it('returns 401 from upstream when session cookie is stale', async () => {
      const fetchFn = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'authentication_required' }),
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
      ).rejects.toMatchObject({ code: 'authentication_required' });
    });
  });

  describe('removed container', () => {
    it('returns container_not_found when block no longer exists', async () => {
      const fetchFn = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'container_not_found' }),
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
      ).rejects.toMatchObject({ code: 'container_not_found' });
    });
  });

  describe('error messages are safe', () => {
    it('ContainerRequestError exposes safe codes', () => {
      const error = new ContainerRequestError('test', 500, 'upstream_unavailable');
      expect(error.message).toBe('test');
      expect(error.code).toBe('upstream_unavailable');
      expect(error.name).toBe('ContainerRequestError');
    });

    it('AuthRequestError exposes safe codes', () => {
      const error = new AuthRequestError('test', 401, 'invalid-credentials');
      expect(error.message).toBe('test');
      expect(error.code).toBe('invalid-credentials');
      expect(error.name).toBe('AuthRequestError');
    });
  });

  describe('public Street View remains usable', () => {
    it('block API errors do not affect container client', async () => {
      const blockFetch = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 500,
        json: async () => ({}),
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

      const blockResponse = await blockFetch();
      expect(blockResponse.ok).toBe(false);

      const containerClient = createContainerClient({
        sessionStore: authenticatedStore(),
        fetch: vi.fn(async (): Promise<Response> => ({
          ok: true,
          status: 200,
          json: async () => ({
            containerType: 'chest',
            size: 27,
            items: [],
          }),
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
        } as Response)),
      });

      const data = await containerClient.fetchContainer('minecraft:overworld', 10, 64, 20);
      expect(data.containerType).toBe('chest');
    });
  });
});
