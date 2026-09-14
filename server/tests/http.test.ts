import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStreetCraftServer, parseStreetCraftPort } from '../src/index';

const cleanups: (() => Promise<void>)[] = [];
const servers: ReturnType<typeof createStreetCraftServer>[] = [];
const upstreams: ReturnType<typeof createHttpServer>[] = [];
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
  await Promise.all(upstreams.splice(0).map((upstream) => new Promise<void>((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  })));
  await Promise.all(cleanups.splice(0).map(async (cleanup) => {
    await cleanup();
  }));
});

describe('parseStreetCraftPort', () => {
  it('uses the fallback when unset', () => {
    expect(parseStreetCraftPort(undefined)).toBe(8102);
    expect(parseStreetCraftPort('')).toBe(8102);
    expect(parseStreetCraftPort(undefined, 9000)).toBe(9000);
  });

  it('parses valid decimal ports', () => {
    expect(parseStreetCraftPort('80')).toBe(80);
    expect(parseStreetCraftPort('8104')).toBe(8104);
    expect(parseStreetCraftPort('65535')).toBe(65535);
  });

  it('rejects invalid values', () => {
    expect(() => parseStreetCraftPort('0')).toThrow();
    expect(() => parseStreetCraftPort('65536')).toThrow();
    expect(() => parseStreetCraftPort('abc')).toThrow();
    expect(() => parseStreetCraftPort(' 8102')).toThrow();
    expect(() => parseStreetCraftPort('-1')).toThrow();
  });
});

describe('StreetCraft static frontend serving', () => {
  it('serves built assets with SPA fallback and rejects traversal', async () => {
    const webDistDir = await mkdtemp(join(tmpdir(), 'streetcraft-web-'));
    cleanups.push(async () => { await rm(webDistDir, { recursive: true, force: true }); });
    await writeFile(join(webDistDir, 'index.html'), '<!doctype html><title>StreetCraft</title>');
    await mkdir(join(webDistDir, 'assets'));
    await writeFile(join(webDistDir, 'assets', 'app.css'), 'body{display:none}');

    const server = createStreetCraftServer({
      passwordHash,
      allowReducedArgon2CostForTests: true,
      webDistDir,
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const root = await fetch(`${origin}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    await expect(root.text()).resolves.toContain('<title>StreetCraft</title>');

    const spa = await fetch(`${origin}/maps/world`);
    expect(spa.status).toBe(200);
    expect(spa.headers.get('content-type')).toContain('text/html');

    const asset = await fetch(`${origin}/assets/app.css`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/css; charset=utf-8');
    await expect(asset.text()).resolves.toContain('display:none');

    const missing = await fetch(`${origin}/assets/missing.css`);
    expect(missing.status).toBe(404);

    const traversal = await fetch(`${origin}/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(traversal.status);
  });
});

describe('StreetCraft blueMap proxy', () => {
  it('rewrites the /bluemap prefix and passes through status and headers', async () => {
    const upstream = createHttpServer((request, response) => {
      if (request.url === '/settings.json') {
        response.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' });
        response.end('{"plugin":true}');
        return;
      }
      if (request.url?.startsWith('/tiles/')) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('missing tile');
        return;
      }
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('unexpected');
    });
    upstreams.push(upstream);
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const { port: upstreamPort } = upstream.address() as AddressInfo;

    const webDistDir = await mkdtemp(join(tmpdir(), 'streetcraft-web-'));
    cleanups.push(async () => { await rm(webDistDir, { recursive: true, force: true }); });
    await writeFile(join(webDistDir, 'index.html'), '<!doctype html><title>StreetCraft</title>');

    const server = createStreetCraftServer({
      passwordHash,
      allowReducedArgon2CostForTests: true,
      bluemapOrigin: `http://127.0.0.1:${upstreamPort}`,
      webDistDir,
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const settings = await fetch(`${origin}/bluemap/settings.json`);
    expect(settings.status).toBe(200);
    expect(settings.headers.get('x-upstream')).toBe('yes');
    await expect(settings.json()).resolves.toEqual({ plugin: true });

    const missing = await fetch(`${origin}/bluemap/tiles/region.png`);
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toBe('missing tile');

    const head = await fetch(`${origin}/bluemap/settings.json`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('x-upstream')).toBe('yes');
    await expect(head.text()).resolves.toBe('');
  });
});