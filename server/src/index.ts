import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Authentication, type AuthenticationOptions } from './auth';
import { ApiProxy, type ApiProxyOptions, proxyRoute } from './proxy';

export const STREETCRAFT_PORT = 8102;

export interface StreetCraftServerOptions extends AuthenticationOptions, ApiProxyOptions {}

export type StreetCraftServer = Server & {
  readonly authentication: Authentication;
};

export function createStreetCraftServer(options: StreetCraftServerOptions = {}): StreetCraftServer {
  const authentication = new Authentication(options);
  const apiProxy = new ApiProxy(authentication, options);
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

    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not found' }));
  }) as StreetCraftServer;
  Object.defineProperty(server, 'authentication', {
    value: authentication,
    enumerable: false,
    writable: false,
  });
  return server;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  createStreetCraftServer().listen(STREETCRAFT_PORT, '0.0.0.0', () => {
    console.info(`StreetCraft listening on port ${STREETCRAFT_PORT}`);
  });
}
