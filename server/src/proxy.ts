import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Authentication } from './auth';

const DEFAULT_FABRIC_API_ORIGIN = 'http://127.0.0.1:8103';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1_024;
const MAX_REQUEST_TARGET_BYTES = 4_096;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const IDENTIFIER_PATTERN = /^[a-z0-9_.-]+:[a-z0-9/._-]+$/;
const COORDINATE_PATTERN = /^-?(?:0|[1-9][0-9]{0,9})$/;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const CONTAINER_SIZES = {
  chest: 27,
  double_chest: 54,
  barrel: 27,
  shulker_box: 27,
} as const;

type ProxyRoute = 'container' | 'block';

interface PositionQuery {
  dimension: string;
  x: number;
  y: number;
  z: number;
}

interface SafeTooltipData {
  damage: number;
  maxDamage: number;
  glint: boolean;
}

interface SafeItemRecord {
  slot: number;
  itemId: string;
  count: number;
  displayName: string;
  safeTooltipData: SafeTooltipData;
}

interface ContainerDto {
  containerType: keyof typeof CONTAINER_SIZES;
  size: number;
  items: SafeItemRecord[];
}

interface BlockDto extends PositionQuery {
  blockId: string;
  supportedContainer: boolean;
}

export interface ApiProxyOptions {
  fabricApiOrigin?: string;
  upstreamTimeoutMs?: number;
  maxUpstreamResponseBytes?: number;
}

export class ApiProxy {
  private readonly authentication: Authentication;
  private readonly fabricApiOrigin: string;
  private readonly upstreamTimeoutMs: number;
  private readonly maxUpstreamResponseBytes: number;

  constructor(authentication: Authentication, options: ApiProxyOptions = {}) {
    this.authentication = authentication;
    this.fabricApiOrigin = validateFabricApiOrigin(
      options.fabricApiOrigin
        ?? process.env.STREETCRAFT_FABRIC_API_ORIGIN
        ?? DEFAULT_FABRIC_API_ORIGIN,
    );
    this.upstreamTimeoutMs = positiveInteger(
      options.upstreamTimeoutMs,
      DEFAULT_UPSTREAM_TIMEOUT_MS,
      'upstreamTimeoutMs',
    );
    this.maxUpstreamResponseBytes = positiveInteger(
      options.maxUpstreamResponseBytes,
      DEFAULT_MAX_UPSTREAM_RESPONSE_BYTES,
      'maxUpstreamResponseBytes',
    );
  }

  async handle(
    route: ProxyRoute,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET') {
      request.resume();
      sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
      return;
    }

    if (
      route === 'container'
      && this.authentication.getAuthenticatedSession(request.headers.cookie) === null
    ) {
      sendJson(response, 401, { error: 'authentication_required' });
      return;
    }

    const query = parsePositionQuery(request.url, route);
    if (query === null) {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }

    const upstreamUrl = buildUpstreamUrl(this.fabricApiOrigin, route, query);
    const abortController = new AbortController();
    let timedOut = false;
    let clientAborted = request.aborted || response.destroyed;
    const abortForClient = (): void => {
      clientAborted = true;
      abortController.abort();
    };
    const abortForClosedResponse = (): void => {
      if (!response.writableEnded) {
        abortForClient();
      }
    };
    request.once('aborted', abortForClient);
    response.once('close', abortForClosedResponse);
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, this.upstreamTimeoutMs);

    try {
      if (clientAborted) {
        return;
      }
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: abortController.signal,
      });

      if (clientAborted) {
        await cancelBody(upstreamResponse);
        return;
      }
      if (upstreamResponse.status === 400) {
        await cancelBody(upstreamResponse);
        sendJson(response, 400, { error: 'invalid_request' });
        return;
      }
      if (upstreamResponse.status === 404) {
        await cancelBody(upstreamResponse);
        sendJson(response, 404, {
          error: route === 'container' ? 'container_not_found' : 'block_not_found',
        });
        return;
      }
      if (upstreamResponse.status === 503) {
        await cancelBody(upstreamResponse);
        sendJson(response, 503, { error: 'service_unavailable' });
        return;
      }
      if (upstreamResponse.status !== 200) {
        await cancelBody(upstreamResponse);
        sendJson(response, 502, { error: 'upstream_unavailable' });
        return;
      }

      const body = await readBoundedBody(upstreamResponse, this.maxUpstreamResponseBytes);
      const value = parseJson(body);
      if (route === 'container') {
        if (!isContainerDto(value)) {
          sendJson(response, 502, { error: 'upstream_unavailable' });
          return;
        }
        sendJson(response, 200, value);
        return;
      }
      if (!isBlockDto(value, query)) {
        sendJson(response, 502, { error: 'upstream_unavailable' });
        return;
      }
      sendJson(response, 200, value);
    } catch {
      if (clientAborted || response.destroyed || response.writableEnded) {
        return;
      }
      sendJson(
        response,
        timedOut ? 503 : 502,
        { error: timedOut ? 'service_unavailable' : 'upstream_unavailable' },
      );
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abortForClient);
      response.off('close', abortForClosedResponse);
    }
  }
}

export function proxyRoute(requestTarget: string | undefined): ProxyRoute | null {
  const path = requestTarget?.split('?', 1)[0];
  if (path === '/api/container') {
    return 'container';
  }
  if (path === '/api/block') {
    return 'block';
  }
  return null;
}

function validateFabricApiOrigin(origin: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/?$/.exec(origin);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('fabric API origin must be loopback HTTP with an explicit valid port');
  }
  return `http://127.0.0.1:${port}`;
}

function parsePositionQuery(requestTarget: string | undefined, route: ProxyRoute): PositionQuery | null {
  if (
    requestTarget === undefined
    || Buffer.byteLength(requestTarget, 'utf8') > MAX_REQUEST_TARGET_BYTES
  ) {
    return null;
  }
  const querySeparator = requestTarget.indexOf('?');
  if (
    querySeparator === -1
    || requestTarget.slice(0, querySeparator) !== `/api/${route}`
    || requestTarget.indexOf('?', querySeparator + 1) !== -1
  ) {
    return null;
  }
  const rawQuery = requestTarget.slice(querySeparator + 1);
  if (rawQuery.length === 0) {
    return null;
  }

  const values = new Map<string, string>();
  try {
    for (const pair of rawQuery.split('&')) {
      const separator = pair.indexOf('=');
      if (separator < 1 || separator !== pair.lastIndexOf('=')) {
        return null;
      }
      const key = strictDecode(pair.slice(0, separator));
      const value = strictDecode(pair.slice(separator + 1));
      if (
        !['dimension', 'x', 'y', 'z'].includes(key)
        || value.length === 0
        || values.has(key)
      ) {
        return null;
      }
      values.set(key, value);
    }
  } catch {
    return null;
  }
  if (values.size !== 4) {
    return null;
  }

  const dimension = values.get('dimension');
  const x = parseCoordinate(values.get('x'));
  const y = parseCoordinate(values.get('y'));
  const z = parseCoordinate(values.get('z'));
  if (dimension === undefined || !isIdentifier(dimension) || x === null || y === null || z === null) {
    return null;
  }
  return { dimension, x, y, z };
}

function strictDecode(encoded: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded.charCodeAt(index);
    if (character === 0x25) {
      if (index + 2 >= encoded.length) {
        throw new Error('invalid encoding');
      }
      const byte = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
      if (!/^[0-9A-Fa-f]{2}$/.test(encoded.slice(index + 1, index + 3))) {
        throw new Error('invalid encoding');
      }
      bytes.push(byte);
      index += 2;
    } else if (character === 0x2b) {
      bytes.push(0x20);
    } else if (character <= 0x7f) {
      bytes.push(character);
    } else {
      throw new Error('invalid encoding');
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
}

function parseCoordinate(value: string | undefined): number | null {
  if (value === undefined || !COORDINATE_PATTERN.test(value)) {
    return null;
  }
  const coordinate = Number(value);
  return Number.isInteger(coordinate) && coordinate >= INT32_MIN && coordinate <= INT32_MAX
    ? coordinate
    : null;
}

function buildUpstreamUrl(origin: string, route: ProxyRoute, query: PositionQuery): string {
  const url = new URL(`/${route}`, origin);
  url.searchParams.set('dimension', query.dimension);
  url.searchParams.set('x', String(query.x));
  url.searchParams.set('y', String(query.y));
  url.searchParams.set('z', String(query.z));
  return url.href;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; response details remain suppressed either way.
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    await cancelBody(response);
    throw new Error('invalid upstream response');
  }
  if (response.body === null) {
    throw new Error('invalid upstream response');
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    length += result.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('invalid upstream response');
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJson(body: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  return JSON.parse(text) as unknown;
}

function isContainerDto(value: unknown): value is ContainerDto {
  if (!isExactObject(value, ['containerType', 'size', 'items'])) {
    return false;
  }
  const containerType = value.containerType;
  if (!isContainerType(containerType)) {
    return false;
  }
  const size = CONTAINER_SIZES[containerType];
  if (value.size !== size || !Array.isArray(value.items) || value.items.length > size) {
    return false;
  }

  const slots = new Set<number>();
  for (const item of value.items) {
    if (!isSafeItemRecord(item, size) || slots.has(item.slot)) {
      return false;
    }
    slots.add(item.slot);
  }
  return true;
}

function isContainerType(value: unknown): value is keyof typeof CONTAINER_SIZES {
  return typeof value === 'string' && hasOwn(CONTAINER_SIZES, value);
}

function isSafeItemRecord(value: unknown, containerSize: number): value is SafeItemRecord {
  if (!isExactObject(value, ['slot', 'itemId', 'count', 'displayName', 'safeTooltipData'])) {
    return false;
  }
  if (
    !isBoundedInteger(value.slot, 0, containerSize - 1)
    || typeof value.itemId !== 'string'
    || !isIdentifier(value.itemId)
    || !isBoundedInteger(value.count, 1, INT32_MAX)
    || typeof value.displayName !== 'string'
    || Array.from(value.displayName).length > 256
    || CONTROL_OR_FORMAT_PATTERN.test(value.displayName)
  ) {
    return false;
  }
  const tooltip = value.safeTooltipData;
  return isExactObject(tooltip, ['damage', 'maxDamage', 'glint'])
    && isBoundedInteger(tooltip.damage, 0, INT32_MAX)
    && isBoundedInteger(tooltip.maxDamage, 0, INT32_MAX)
    && tooltip.damage <= tooltip.maxDamage
    && typeof tooltip.glint === 'boolean';
}

function isBlockDto(value: unknown, query: PositionQuery): value is BlockDto {
  return isExactObject(value, ['dimension', 'x', 'y', 'z', 'blockId', 'supportedContainer'])
    && value.dimension === query.dimension
    && value.x === query.x
    && value.y === query.y
    && value.z === query.z
    && typeof value.blockId === 'string'
    && isIdentifier(value.blockId)
    && typeof value.supportedContainer === 'boolean';
}

function isIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => hasOwn(value, key));
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
  extraHeaders: Record<string, string> = {},
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}
