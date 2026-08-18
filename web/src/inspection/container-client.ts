import type { InventoryData, ItemData } from '../inventory/inventory-screen';
import type { SessionStore } from '../auth/session-store';

export class ContainerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'authentication_required'
      | 'container_not_found'
      | 'service_unavailable'
      | 'upstream_unavailable'
      | 'request-failed'
      | 'invalid-response',
  ) {
    super(message);
    this.name = 'ContainerRequestError';
  }
}

export interface ContainerClient {
  fetchContainer(
    dimension: string,
    x: number,
    y: number,
    z: number,
  ): Promise<InventoryData>;
}

export interface ContainerClientOptions {
  sessionStore: SessionStore;
  fetch?: typeof fetch;
}

export function createContainerClient(options: ContainerClientOptions): ContainerClient {
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    fetchContainer: async (dimension, x, y, z) => {
      const session = options.sessionStore.get();
      if (!session.authenticated) {
        throw new ContainerRequestError(
          'Authentication required',
          401,
          'authentication_required',
        );
      }

      const url = `/api/container?dimension=${encodeURIComponent(dimension)}&x=${String(x)}&y=${String(y)}&z=${String(z)}`;

      let response: Response;
      try {
        response = await fetchRequest(url, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
      } catch {
        throw new ContainerRequestError(
          'Container request failed',
          0,
          'request-failed',
        );
      }

      if (response.status === 401) {
        throw new ContainerRequestError(
          'Authentication required',
          401,
          'authentication_required',
        );
      }
      if (response.status === 404) {
        throw new ContainerRequestError(
          'Container not found',
          404,
          'container_not_found',
        );
      }
      if (response.status === 503) {
        throw new ContainerRequestError(
          'Service unavailable',
          503,
          'service_unavailable',
        );
      }
      if (!response.ok) {
        throw new ContainerRequestError(
          'Upstream unavailable',
          response.status,
          'upstream_unavailable',
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ContainerRequestError(
          'Invalid container response',
          response.status,
          'invalid-response',
        );
      }

      const data = parseInventoryData(body);
      if (data === null) {
        throw new ContainerRequestError(
          'Invalid container response',
          response.status,
          'invalid-response',
        );
      }

      return data;
    },
  };
}

function parseInventoryData(value: unknown): InventoryData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;

  const containerType = obj.containerType;
  if (
    containerType !== 'chest'
    && containerType !== 'barrel'
    && containerType !== 'shulker_box'
    && containerType !== 'double_chest'
  ) {
    return null;
  }

  const expectedSize = containerType === 'double_chest' ? 54 : 27;
  if (obj.size !== expectedSize || !Array.isArray(obj.items)) {
    return null;
  }

  const items: ItemData[] = [];
  for (const raw of obj.items) {
    const item = parseItemData(raw, expectedSize);
    if (item === null) return null;
    items.push(item);
  }

  return { containerType, size: expectedSize, items };
}

const INT32_MAX = 2_147_483_647;
const IDENTIFIER_PATTERN = /^[a-z0-9_.-]+:[a-z0-9/._-]+$/;

function parseItemData(value: unknown, containerSize: number): ItemData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;

  if (
    typeof obj.slot !== 'number'
    || !Number.isInteger(obj.slot)
    || (obj.slot as number) < 0
    || (obj.slot as number) >= containerSize
    || typeof obj.itemId !== 'string'
    || !IDENTIFIER_PATTERN.test(obj.itemId)
    || typeof obj.count !== 'number'
    || !Number.isInteger(obj.count)
    || (obj.count as number) < 1
    || (obj.count as number) > INT32_MAX
    || typeof obj.displayName !== 'string'
  ) {
    return null;
  }

  const tooltip = obj.safeTooltipData;
  if (
    typeof tooltip !== 'object'
    || tooltip === null
    || Array.isArray(tooltip)
  ) {
    return null;
  }
  const t = tooltip as Record<string, unknown>;
  if (
    typeof t.damage !== 'number'
    || !Number.isInteger(t.damage)
    || (t.damage as number) < 0
    || typeof t.maxDamage !== 'number'
    || !Number.isInteger(t.maxDamage)
    || (t.maxDamage as number) < 0
    || (t.damage as number) > (t.maxDamage as number)
    || typeof t.glint !== 'boolean'
  ) {
    return null;
  }

  return {
    slot: obj.slot as number,
    itemId: obj.itemId as string,
    count: obj.count as number,
    displayName: obj.displayName as string,
    safeTooltipData: {
      damage: t.damage as number,
      maxDamage: t.maxDamage as number,
      glint: t.glint as boolean,
    },
  };
}
