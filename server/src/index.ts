import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pathToFileURL } from 'node:url';
import { Authentication, type AuthenticationOptions } from './auth';
import { ApiProxy, type ApiProxyOptions, proxyRoute } from './proxy';

const DEFAULT_STREETCRAFT_PORT = 8102;
const DEFAULT_BLUEMAP_ORIGIN = 'http://127.0.0.1:8101';
const DEFAULT_BLUEMAP_TIMEOUT_MS = 5_000;
const BLUEMAP_PATH = '/bluemap';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
};

export interface StreetCraftServerOptions extends AuthenticationOptions, ApiProxyOptions {
  bluemapOrigin?: string;
  webDistDir?: string;
}

export type StreetCraftServer = Server & {
  readonly authentication: Authentication;
};

export function parseStreetCraftPort(value: string | undefined, fallback = DEFAULT_STREETCRAFT_PORT): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^[0-9]{1,5}$/.test(value)) {
    throw new Error('STREETCRAFT_PORT must be a decimal TCP port');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('STREETCRAFT_PORT must be a TCP port between 1 and 65535');
  }
  return port;
}

export const STREETCRAFT_PORT = parseStreetCraftPort(process.env.STREETCRAFT_PORT);

export function createStreetCraftServer(options: StreetCraftServerOptions = {}): StreetCraftServer {
  const authentication = new Authentication(options);
  const apiProxy = new ApiProxy(authentication, options);
  const bluemapOrigin = validateBlueMapOrigin(
    options.bluemapOrigin
      ?? process.env.STREETCRAFT_BLUEMAP_ORIGIN
      ?? DEFAULT_BLUEMAP_ORIGIN,
  );
  const webDistDir = options.webDistDir ?? join(process.cwd(), 'dist', 'web');
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ service: 'streetcraft', status: 'ok' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/auth/login') {
      void authentication.handleLogin(request, response, request.socket.remoteAddress ?? 'unknown').catch(() => {
        if (request.aborted || response.destroyed || response.writableEnded) {
          return;
        }
        try {
          response.writeHead(500, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
          });
          response.end(JSON.stringify({ error: 'authentication request failed' }));
        } catch {
          response.destroy();
        }
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/auth/logout') {
      authentication.handleLogout(request, response);
      return;
    }

    const route = proxyRoute(request.url);
    if (route !== null) {
      void apiProxy.handle(route, request, response);
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && isBlueMapRequest(request.url)) {
      void proxyBlueMap(bluemapOrigin, request, response);
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      void serveWeb(webDistDir, request, response);
      return;
    }

    sendJson(response, 405, { error: 'method_not_allowed' });
  }) as StreetCraftServer;
  Object.defineProperty(server, 'authentication', {
    value: authentication,
    enumerable: false,
    writable: false,
  });
  return server;
}

async function proxyBlueMap(origin: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestTarget = request.url ?? '/';
  const querySeparator = requestTarget.indexOf('?');
  const pathname = querySeparator === -1 ? requestTarget : requestTarget.slice(0, querySeparator);
  const search = querySeparator === -1 ? '' : requestTarget.slice(querySeparator);
  const rest = pathname.slice(BLUEMAP_PATH.length);
  const upstreamUrl = `${origin}${rest.startsWith('/') ? rest : `/${rest}`}${search}`;

  const abortController = new AbortController();
  let clientAborted = request.aborted || response.destroyed;
  const abortForClient = (): void => {
    clientAborted = true;
    abortController.abort();
  };
  request.once('aborted', abortForClient);
  response.once('close', abortForClient);
  const timeout = setTimeout(() => abortController.abort(), DEFAULT_BLUEMAP_TIMEOUT_MS);

  try {
    if (clientAborted) {
      return;
    }
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
      signal: abortController.signal,
    });

    if (clientAborted) {
      await cancelBody(upstreamResponse);
      return;
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of upstreamResponse.headers.entries()) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
        headers[name] = value;
      }
    }
    if (headers['content-type'] === undefined) {
      headers['content-type'] = 'application/octet-stream';
    }
    response.writeHead(upstreamResponse.status, headers);

    if (request.method === 'HEAD' || upstreamResponse.body === null) {
      await cancelBody(upstreamResponse);
      response.end();
      return;
    }
    await pipeline(
      Readable.fromWeb(upstreamResponse.body as WebReadableStream),
      response,
    );
  } catch {
    if (clientAborted || response.destroyed || response.writableEnded) {
      return;
    }
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 502, { error: 'blueMap_unavailable' });
  } finally {
    clearTimeout(timeout);
    request.off('aborted', abortForClient);
    response.off('close', abortForClient);
  }
}

async function serveWeb(webDistDir: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const requestTarget = request.url ?? '/';
    const querySeparator = requestTarget.indexOf('?');
    const pathname = querySeparator === -1 ? requestTarget : requestTarget.slice(0, querySeparator);
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.indexOf('..') !== -1) {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }
    const decoded = decodePathname(pathname);
    if (decoded === null || decoded.includes('..') || decoded.includes('\\')) {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }
    const relative = decoded.replace(/^\/+/, '') || 'index.html';
    let targetPath = normalize(join(webDistDir, relative));
    let info = await safeStat(targetPath);
    if ((info === null || !info.isFile()) && relative.endsWith('/')) {
      targetPath = join(webDistDir, relative, 'index.html');
      info = await safeStat(targetPath);
    }
    if ((info === null || !info.isFile()) && extname(targetPath) === '') {
      targetPath = join(webDistDir, 'index.html');
      info = await safeStat(targetPath);
    }
    if (info === null || !info.isFile()) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    const extension = extname(targetPath).toLowerCase();
    const isHtml = extension === '.html';
    response.writeHead(200, {
      'cache-control': isHtml ? 'no-cache' : 'public, max-age=86400',
      'content-length': String(info.size),
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await pipeline(createReadStream(targetPath), response);
  } catch {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 500, { error: 'internal_error' });
  }
}

function isBlueMapRequest(requestTarget: string | undefined): boolean {
  const pathname = requestTarget?.split('?', 1)[0] ?? '';
  return pathname === BLUEMAP_PATH || pathname.startsWith(`${BLUEMAP_PATH}/`);
}

function validateBlueMapOrigin(origin: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/?$/.exec(origin);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('blueMap origin must be loopback HTTP with an explicit valid port');
  }
  return `http://127.0.0.1:${port}`;
}

function decodePathname(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; response details remain suppressed either way.
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  createStreetCraftServer().listen(STREETCRAFT_PORT, '0.0.0.0', () => {
    console.info(`StreetCraft listening on port ${STREETCRAFT_PORT}`);
  });
}