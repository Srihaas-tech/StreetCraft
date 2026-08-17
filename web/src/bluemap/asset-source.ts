export interface BlueMapTileCoordinates {
  x: number;
  z: number;
}

export interface BlueMapAssetConfiguration {
  mapDataRoot: string;
  clientDecompression: boolean;
}

export function assertBlueMapPathSegment(value: string, label: string): void {
  if (
    value.length === 0
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
  ) {
    throw new TypeError(`BlueMap ${label} must not contain path traversal`);
  }
}

function encodedPathSegment(value: string, label: string): string {
  assertBlueMapPathSegment(value, label);
  return encodeURIComponent(value);
}

function coordinatePath(coordinates: BlueMapTileCoordinates): string {
  if (!Number.isSafeInteger(coordinates.x) || !Number.isSafeInteger(coordinates.z)) {
    throw new TypeError('BlueMap tile coordinates must be safe integers');
  }

  const segmentPath = (axis: 'x' | 'z', coordinate: number): string => {
    const digits = String(Math.abs(coordinate));
    const firstSegment = coordinate < 0 ? `${axis}-${digits[0]}` : `${axis}${digits[0]}`;
    return `${firstSegment}${digits.slice(1).split('').map((digit) => `/${digit}`).join('')}`;
  };

  return `${segmentPath('x', coordinates.x)}/${segmentPath('z', coordinates.z)}.prbm`;
}

export class BlueMapAssetSource {
  private readonly baseUrl: URL;

  constructor(base: string) {
    this.baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
  }

  globalSettingsUrl(): string {
    return new URL('settings.json', this.baseUrl).toString();
  }

  mapSettingsUrl(mapId: string, mapDataRoot: string): string {
    return this.urlFor(mapId, mapDataRoot, 'settings.json');
  }

  highResolutionTileUrl(
    mapId: string,
    coordinates: BlueMapTileCoordinates,
    configuration: BlueMapAssetConfiguration,
  ): string {
    const extension = configuration.clientDecompression ? '.gz' : '';
    return this.urlFor(mapId, configuration.mapDataRoot, `tiles/0/${coordinatePath(coordinates)}${extension}`);
  }

  private urlFor(mapId: string, mapDataRoot: string, assetPath: string): string {
    const root = encodedPathSegment(mapDataRoot, 'map data root');
    const map = encodedPathSegment(mapId, 'map identifier');
    return new URL(`${root}/${map}/${assetPath}`, this.baseUrl).toString();
  }
}
