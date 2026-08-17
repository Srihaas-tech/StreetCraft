import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

export const STREETCRAFT_PORT = 8102;

export function createStreetCraftServer(): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ service: 'streetcraft', status: 'ok' }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  createStreetCraftServer().listen(STREETCRAFT_PORT, '0.0.0.0', () => {
    console.info(`StreetCraft listening on port ${STREETCRAFT_PORT}`);
  });
}
