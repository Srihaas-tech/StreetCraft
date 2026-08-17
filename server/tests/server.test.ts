import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { hash } from '@node-rs/argon2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStreetCraftServer } from '../src/index';

const servers: ReturnType<typeof createStreetCraftServer>[] = [];
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

describe('StreetCraft HTTP bootstrap', () => {
  it('serves a public health response', async () => {
    const server = createStreetCraftServer({ passwordHash });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: 'streetcraft', status: 'ok' });
  });
});
