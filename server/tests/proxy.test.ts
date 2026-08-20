import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hash } from '@node-rs/argon2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStreetCraftServer, type StreetCraftServer } from '../src/index';

interface PlannedProxyOptions {
  fabricApiOrigin?: string;
  upstreamTimeoutMs?: number;
  maxUpstreamResponseBytes?: number;
}

const servers: Server[] = [];
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hash(randomBytes(24).toString('base64url'), {
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

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function startUpstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  return listen(createServer(handler));
}

async function startStreetCraft(options: PlannedProxyOptions = {}): Promise<{
  baseUrl: string;
  server: StreetCraftServer;
}> {
  const server = createStreetCraftServer({
    passwordHash,
    allowReducedArgon2CostForTests: true,
    passwordVerifierForTests: async (_hash, password) => password === 'correct horse battery staple',
    ...options,
  });
  return { baseUrl: await listen(server), server };
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';', 1)[0]!;
}

function upstreamJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function validContainer(): object {
  return {
    containerType: 'chest',
    size: 27,
    items: [{
      slot: 4,
      itemId: 'minecraft:diamond',
      count: 12,
      displayName: 'Diamond',
      safeTooltipData: { damage: 0, maxDamage: 0, glint: true },
    }],
  };
}

function validBlock(): object {
  return {
    dimension: 'minecraft:overworld',
    x: 7,
    y: 80,
    z: -9,
    blockId: 'minecraft:barrel',
    supportedContainer: true,
  };
}

function expectProxyHeaders(response: Response): void {
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('authenticated API proxy', () => {
  it('serves sparse public collision blocks without filling air below structures', async () => {
    const upstream = await startUpstream((request, response) => {
      expect(request.url).toBe('/collision?dimension=minecraft%3Aoverworld&fromX=0&fromZ=0&toX=1&toZ=1');
      upstreamJson(response, {
        dimension: 'minecraft:overworld',
        fromX: 0,
        fromZ: 0,
        blocks: [0, 64, 0, 0, 70, 0],
      });
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: upstream });

    const response = await fetch(`${baseUrl}/api/collision?dimension=minecraft:overworld&fromX=0&fromZ=0&toX=1&toZ=1`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dimension: 'minecraft:overworld',
      fromX: 0,
      fromZ: 0,
      blocks: [0, 64, 0, 0, 70, 0],
    });
  });

  it('authenticates container requests before query validation or any upstream call', async () => {
    let upstreamCalls = 0;
    const origin = await startUpstream((_request, response) => {
      upstreamCalls += 1;
      upstreamJson(response, validContainer());
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });

    const response = await fetch(`${baseUrl}/api/container?unexpected=secret`);

    expect(response.status).toBe(401);
    expectProxyHeaders(response);
    await expect(response.json()).resolves.toEqual({ error: 'authentication_required' });
    expect(upstreamCalls).toBe(0);
  });

  it('reconstructs an authenticated container query and never forwards browser-controlled headers', async () => {
    let target: string | undefined;
    let headers: IncomingMessage['headers'] | undefined;
    const origin = await startUpstream((request, response) => {
      target = request.url;
      headers = request.headers;
      upstreamJson(response, validContainer());
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });
    const cookie = await login(baseUrl);

    const response = await fetch(
      `${baseUrl}/api/container?z=-2&dimension=minecraft%3Aoverworld&y=64&x=1`,
      {
        headers: {
          cookie,
          authorization: 'Bearer browser-secret',
          'x-browser-controlled': 'do-not-forward',
        },
      },
    );

    expect(response.status).toBe(200);
    expectProxyHeaders(response);
    await expect(response.json()).resolves.toEqual(validContainer());
    expect(target).toBe('/container?dimension=minecraft%3Aoverworld&x=1&y=64&z=-2');
    expect(headers?.cookie).toBeUndefined();
    expect(headers?.authorization).toBeUndefined();
    expect(headers?.['x-browser-controlled']).toBeUndefined();
  });

  it('rejects expired and malformed sessions without an upstream call', async () => {
    let now = Date.UTC(2026, 7, 17, 12);
    let upstreamCalls = 0;
    const origin = await startUpstream((_request, response) => {
      upstreamCalls += 1;
      upstreamJson(response, validContainer());
    });
    const server = createStreetCraftServer({
      passwordHash,
      allowReducedArgon2CostForTests: true,
      passwordVerifierForTests: async () => true,
      fabricApiOrigin: origin,
      now: () => now,
      sessionDurationMs: 10,
    });
    const baseUrl = await listen(server);
    const cookie = await login(baseUrl);
    now += 11;

    const [expired, malformed] = await Promise.all([
      fetch(`${baseUrl}/api/container?dimension=minecraft:overworld&x=1&y=64&z=2`, { headers: { cookie } }),
      fetch(`${baseUrl}/api/container?dimension=minecraft:overworld&x=1&y=64&z=2`, {
        headers: { cookie: 'streetcraft_session=malformed' },
      }),
    ]);

    expect(expired.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(upstreamCalls).toBe(0);
  });

  it('serves schema-limited block information publicly without inventory or item fields', async () => {
    const origin = await startUpstream((_request, response) => upstreamJson(response, validBlock()));
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });

    const response = await fetch(
      `${baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`,
    );

    expect(response.status).toBe(200);
    expectProxyHeaders(response);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(validBlock());
    expect(Object.keys(body).sort()).toEqual(
      ['blockId', 'dimension', 'supportedContainer', 'x', 'y', 'z'].sort(),
    );
    expect(JSON.stringify(body).toLowerCase()).not.toContain('inventory');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('item');
  });

  it('rejects missing, duplicate, extra, malformed, and oversized query data without upstream calls', async () => {
    let upstreamCalls = 0;
    const origin = await startUpstream((_request, response) => {
      upstreamCalls += 1;
      upstreamJson(response, validBlock());
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });
    const invalidTargets = [
      '/api/block?dimension=minecraft:overworld&x=1&y=64',
      '/api/block?dimension=minecraft:overworld&x=1&x=2&y=64&z=3',
      '/api/block?dimension=minecraft:overworld&x=1&y=64&z=3&extra=true',
      '/api/block?dimension=Minecraft:Overworld&x=1&y=64&z=3',
      '/api/block?dimension=overworld&x=1&y=64&z=3',
      '/api/block?dimension=minecraft%ZZoverworld&x=1&y=64&z=3',
      '/api/block?dimension=minecraft:overworld&x=01&y=64&z=3',
      '/api/block?dimension=minecraft:overworld&x=2147483648&y=64&z=3',
      '/api/block?dimension=minecraft:overworld&x=-2147483649&y=64&z=3',
      `/api/block?dimension=minecraft:${'a'.repeat(4_096)}&x=1&y=64&z=3`,
    ];

    for (const target of invalidTargets) {
      const response = await fetch(`${baseUrl}${target.replace('%ZZ', '%25ZZ')}`);
      expect(response.status, target).toBe(400);
      expectProxyHeaders(response);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    }
    expect(upstreamCalls).toBe(0);
  });

  it('returns 405 with Allow GET for other methods without contacting upstream', async () => {
    let upstreamCalls = 0;
    const origin = await startUpstream((_request, response) => {
      upstreamCalls += 1;
      upstreamJson(response, validBlock());
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });

    for (const path of ['/api/block', '/api/container']) {
      const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expectProxyHeaders(response);
    }
    expect(upstreamCalls).toBe(0);
  });

  it('rejects invalid upstream origins during construction without reflecting them', () => {
    const invalidOrigins = [
      'https://127.0.0.1:8103',
      'http://localhost:8103',
      'http://127.0.0.2:8103',
      'http://127.0.0.1',
      'http://user:secret@127.0.0.1:8103',
      'http://127.0.0.1:8103/private',
      'http://127.0.0.1:8103/?secret=true',
      'http://127.0.0.1:8103/#secret',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
    ];

    for (const fabricApiOrigin of invalidOrigins) {
      let thrown: unknown;
      try {
        createStreetCraftServer({
          passwordHash,
          allowReducedArgon2CostForTests: true,
          fabricApiOrigin,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, fabricApiOrigin).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        'fabric API origin must be loopback HTTP with an explicit valid port',
      );
      expect((thrown as Error).message).not.toContain(fabricApiOrigin);
    }
  });

  it('uses the validated environment origin when no constructor override is supplied', async () => {
    const origin = await startUpstream((_request, response) => upstreamJson(response, validBlock()));
    const previous = process.env.STREETCRAFT_FABRIC_API_ORIGIN;
    process.env.STREETCRAFT_FABRIC_API_ORIGIN = origin;
    try {
      const { baseUrl } = await startStreetCraft();
      const response = await fetch(
        `${baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`,
      );

      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) {
        delete process.env.STREETCRAFT_FABRIC_API_ORIGIN;
      } else {
        process.env.STREETCRAFT_FABRIC_API_ORIGIN = previous;
      }
    }
  });

  it('maps stable upstream 400 and 404 results without exposing upstream bodies', async () => {
    let status = 400;
    const origin = await startUpstream((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/plain', 'x-secret': 'internal' });
      response.end('sensitive Fabric detail');
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });

    const invalid = await fetch(
      `${baseUrl}/api/block?dimension=minecraft:overworld&x=1&y=64&z=2`,
    );
    status = 404;
    const missing = await fetch(
      `${baseUrl}/api/block?dimension=minecraft:overworld&x=1&y=64&z=2`,
    );

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'block_not_found' });
    expect(invalid.headers.get('x-secret')).toBeNull();
    expect(missing.headers.get('x-secret')).toBeNull();
  });

  it.each([
    ['redirect', 'block', (response: ServerResponse) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/private-secret' });
      response.end('redirect-secret');
    }],
    ['malformed JSON', 'block', (response: ServerResponse) => response.end('{private malformed detail')],
    ['invalid container schema', 'container', (response: ServerResponse) => upstreamJson(response, {
      ...validContainer(),
      privateNbt: 'secret',
    })],
    ['invalid block schema with item data', 'block', (response: ServerResponse) => upstreamJson(response, {
      ...validBlock(),
      items: [{ itemId: 'minecraft:diamond' }],
    })],
    ['unexpected status', 'block', (response: ServerResponse) => {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('private stack trace');
    }],
  ] as const)('returns a generic non-leaking error for %s', async (_caseName, route, respond) => {
    const origin = await startUpstream((_request, response) => respond(response));
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin });
    const cookie = route === 'container' ? await login(baseUrl) : undefined;
    const query = route === 'container'
      ? 'dimension=minecraft:overworld&x=1&y=64&z=2'
      : 'dimension=minecraft:overworld&x=7&y=80&z=-9';

    const response = await fetch(
      `${baseUrl}/api/${route}?${query}`,
      cookie === undefined ? undefined : { headers: { cookie } },
    );

    expect(response.status).toBe(502);
    expectProxyHeaders(response);
    const text = await response.text();
    expect(text).toBe('{"error":"upstream_unavailable"}');
    expect(text).not.toMatch(/private|secret|stack|127\.0\.0\.1/i);
  });

  it('bounds upstream response bytes and returns only a generic error', async () => {
    const origin = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ padding: 'sensitive'.repeat(100) }));
    });
    const { baseUrl } = await startStreetCraft({
      fabricApiOrigin: origin,
      maxUpstreamResponseBytes: 128,
    });

    const response = await fetch(
      `${baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'upstream_unavailable' });
  });

  it('maps upstream timeout and network failure to generic responses', async () => {
    const timeoutOrigin = await startUpstream(() => undefined);
    const timeoutServer = await startStreetCraft({
      fabricApiOrigin: timeoutOrigin,
      upstreamTimeoutMs: 20,
    });

    const unavailable = createServer();
    const unavailableOrigin = await listen(unavailable);
    await new Promise<void>((resolve, reject) => unavailable.close((error) => (error ? reject(error) : resolve())));
    servers.splice(servers.indexOf(unavailable), 1);
    const networkServer = await startStreetCraft({ fabricApiOrigin: unavailableOrigin });

    const [timeout, network] = await Promise.all([
      fetch(`${timeoutServer.baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`),
      fetch(`${networkServer.baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`),
    ]);

    expect(timeout.status).toBe(503);
    expect(network.status).toBe(502);
    await expect(timeout.json()).resolves.toEqual({ error: 'service_unavailable' });
    await expect(network.json()).resolves.toEqual({ error: 'upstream_unavailable' });
  });

  it('aborts the upstream fetch when the browser disconnects', async () => {
    let markUpstreamStarted!: () => void;
    const upstreamStarted = new Promise<void>((resolve) => {
      markUpstreamStarted = resolve;
    });
    let markUpstreamClosed!: () => void;
    const upstreamClosed = new Promise<void>((resolve) => {
      markUpstreamClosed = resolve;
    });
    const origin = await startUpstream((_request, response) => {
      markUpstreamStarted();
      response.once('close', markUpstreamClosed);
    });
    const { baseUrl } = await startStreetCraft({ fabricApiOrigin: origin, upstreamTimeoutMs: 1_000 });
    const request = httpRequest(
      `${baseUrl}/api/block?dimension=minecraft:overworld&x=7&y=80&z=-9`,
    );
    request.on('error', () => undefined);
    request.end();
    await upstreamStarted;

    request.destroy();

    const closedBeforeTimeout = await Promise.race([
      upstreamClosed.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    expect(closedBeforeTimeout).toBe(true);
  });
});
