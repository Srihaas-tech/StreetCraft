import {
  assertBlueMapPathSegment,
  BlueMapAssetSource,
} from './asset-source';

export interface BlueMapAxes {
  x: number;
  z: number;
}

export interface BlueMapMapSettings {
  hiresTileSize: BlueMapAxes;
  scale: BlueMapAxes;
  translate: BlueMapAxes;
}

export interface BlueMapGlobalSettings {
  maps: string[];
  mapDataRoot: string;
  clientDecompression: boolean;
}

export interface BlueMapMapMetadata {
  id: string;
  globalSettings: BlueMapGlobalSettings;
  settings: BlueMapMapSettings;
}

export class BlueMapAssetRequestError extends Error {
  constructor(url: string, status: number) {
    super(`BlueMap asset request failed with status ${status}: ${url}`);
    this.name = 'BlueMapAssetRequestError';
  }
}

export class BlueMapMetadataError extends Error {
  constructor(message: string) {
    super(`Invalid BlueMap metadata: ${message}`);
    this.name = 'BlueMapMetadataError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAxes(value: unknown, label: string, defaultValue: BlueMapAxes): BlueMapAxes {
  if (value === undefined) {
    return defaultValue;
  }

  if (
    !Array.isArray(value)
    || value.length !== 2
    || typeof value[0] !== 'number'
    || !Number.isFinite(value[0])
    || typeof value[1] !== 'number'
    || !Number.isFinite(value[1])
  ) {
    throw new BlueMapMetadataError(`${label} must be an [x, z] number array`);
  }

  return { x: value[0], z: value[1] };
}

function parseGlobalSettings(value: unknown): BlueMapGlobalSettings {
  if (!isRecord(value) || !Array.isArray(value.maps) || !value.maps.every((map) => typeof map === 'string')) {
    throw new BlueMapMetadataError('global settings maps must be a string array');
  }

  for (const mapId of value.maps) {
    try {
      assertBlueMapPathSegment(mapId, 'map identifier');
    } catch {
      throw new BlueMapMetadataError('global settings contains an unsafe map identifier');
    }
  }

  const mapDataRoot = value.mapDataRoot ?? 'maps';
  if (typeof mapDataRoot !== 'string') {
    throw new BlueMapMetadataError('global settings mapDataRoot must be a string');
  }

  try {
    assertBlueMapPathSegment(mapDataRoot, 'map data root');
  } catch {
    throw new BlueMapMetadataError('global settings mapDataRoot is unsafe');
  }

  const clientDecompression = value.clientDecompression ?? false;
  if (typeof clientDecompression !== 'boolean') {
    throw new BlueMapMetadataError('global settings clientDecompression must be a boolean');
  }

  return { maps: [...value.maps], mapDataRoot, clientDecompression };
}

function parseMapSettings(value: unknown): BlueMapMapSettings {
  if (!isRecord(value)) {
    throw new BlueMapMetadataError('per-map settings must be an object');
  }

  return {
    hiresTileSize: parseAxes(value.hiresTileSize, 'hiresTileSize', { x: 32, z: 32 }),
    scale: parseAxes(value.scale, 'scale', { x: 1, z: 1 }),
    translate: parseAxes(value.translate, 'translate', { x: 2, z: 2 }),
  };
}

async function loadJson(url: string, fetchImplementation: typeof fetch): Promise<unknown> {
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new BlueMapAssetRequestError(url, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new BlueMapMetadataError(`asset at ${url} does not contain valid JSON`);
  }
}

export async function loadMapMetadata(
  source: BlueMapAssetSource,
  mapId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<BlueMapMapMetadata> {
  const globalSettings = parseGlobalSettings(await loadJson(source.globalSettingsUrl(), fetchImplementation));
  if (!globalSettings.maps.includes(mapId)) {
    throw new BlueMapMetadataError(`map ${JSON.stringify(mapId)} is not listed in global settings`);
  }

  const settings = parseMapSettings(await loadJson(
    source.mapSettingsUrl(mapId, globalSettings.mapDataRoot),
    fetchImplementation,
  ));

  return { id: mapId, globalSettings, settings };
}
