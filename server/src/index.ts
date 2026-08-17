import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Authentication, type AuthenticationOptions } from './auth';

export const STREETCRAFT_PORT = 8102;

export interface StreetCraftServerOptions extends AuthenticationOptions {}

export type StreetCraftServer = Server & {
  readonly authentication: Authentication;
};

export function createStreetCraftServer(options: StreetCraftServerOptions = {}): StreetCraftServer {
  const authentication = new Authentication(options);
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ service: 'streetcraft', status: 'ok' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/auth/login') {
      void authentication.handleLogin(request, response, request.socket.remoteAddress ?? 'unknown');
      return;
    }

    if (request.method === 'POST' && request.url === '/api/auth/logout') {
      authentication.handleLogout(request, response);
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
