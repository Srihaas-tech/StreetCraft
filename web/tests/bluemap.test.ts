import { describe, expect, it } from 'vitest';
import { BlueMapAssetSource } from '../src/bluemap/asset-source';
import {
  BlueMapAssetRequestError,
  BlueMapMetadataError,
  loadMapMetadata,
} from '../src/bluemap/map-loader';
import {
  tileToRenderCoordinates,
  worldToRenderCoordinates,
} from '../src/bluemap/world-transform';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BlueMap asset source', () => {
  it('builds encoded map settings and compressed high-resolution tile URLs', () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101/bluemap');

    expect(source.globalSettingsUrl()).toBe('http://127.0.0.1:8101/bluemap/settings.json');
    expect(source.mapSettingsUrl('over world', 'map data')).toBe(
      'http://127.0.0.1:8101/bluemap/map%20data/over%20world/settings.json',
    );
    expect(source.highResolutionTileUrl('over world', { x: 42, z: -17 }, {
      mapDataRoot: 'map data',
      clientDecompression: true,
    })).toBe(
      'http://127.0.0.1:8101/bluemap/map%20data/over%20world/tiles/0/x4/2/z-1/7.prbm.gz',
    );
  });

  it('rejects map identifiers that could traverse paths', () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101');

    expect(() => source.mapSettingsUrl('../private', 'maps')).toThrow('path traversal');
  });
});

describe('BlueMap map metadata', () => {
  it('loads global and per-map settings and applies documented defaults', async () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101');
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);

      if (url === source.globalSettingsUrl()) {
        return jsonResponse({ maps: ['overworld'] });
      }

      return jsonResponse({});
    };

    await expect(loadMapMetadata(source, 'overworld', fetchImplementation)).resolves.toEqual({
      id: 'overworld',
      globalSettings: {
        maps: ['overworld'],
        mapDataRoot: 'maps',
        clientDecompression: false,
      },
      settings: {
        hiresTileSize: { x: 32, z: 32 },
        scale: { x: 1, z: 1 },
        translate: { x: 2, z: 2 },
      },
    });
  });

  it('parses configured settings arrays and fetches the configured map-data root', async () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101');
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);

      if (url === 'http://127.0.0.1:8101/settings.json') {
        return jsonResponse({
          maps: ['overworld'],
          mapDataRoot: 'terrain data',
          clientDecompression: true,
        });
      }

      expect(url).toBe('http://127.0.0.1:8101/terrain%20data/overworld/settings.json');
      return jsonResponse({
        hiresTileSize: [64, 48],
        scale: [2, 0.5],
        translate: [3, -4],
      });
    };

    await expect(loadMapMetadata(source, 'overworld', fetchImplementation)).resolves.toMatchObject({
      globalSettings: {
        mapDataRoot: 'terrain data',
        clientDecompression: true,
      },
      settings: {
        hiresTileSize: { x: 64, z: 48 },
        scale: { x: 2, z: 0.5 },
        translate: { x: 3, z: -4 },
      },
    });
  });

  it('rejects non-success responses with a typed request error', async () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101');
    const fetchImplementation: typeof fetch = async () => jsonResponse({}, 503);

    await expect(loadMapMetadata(source, 'overworld', fetchImplementation)).rejects.toBeInstanceOf(
      BlueMapAssetRequestError,
    );
  });

  it('rejects malformed global metadata instead of accepting it', async () => {
    const source = new BlueMapAssetSource('http://127.0.0.1:8101');
    const fetchImplementation: typeof fetch = async () => jsonResponse({ maps: ['overworld', 7] });

    await expect(loadMapMetadata(source, 'overworld', fetchImplementation)).rejects.toBeInstanceOf(
      BlueMapMetadataError,
    );
  });
});

describe('BlueMap world transforms', () => {
  it('keeps Minecraft world coordinates on the Three.js render axes', () => {
    expect(worldToRenderCoordinates({ x: 14.5, y: 72, z: -8.25 })).toEqual({
      x: 14.5,
      y: 72,
      z: -8.25,
    });
  });

  it('applies tile size, scale, and translation once when placing a tile', () => {
    expect(tileToRenderCoordinates(
      { x: 3, z: -2 },
      {
        hiresTileSize: { x: 32, z: 32 },
        scale: { x: 2, z: 0.5 },
        translate: { x: 3, z: -4 },
      },
    )).toEqual({ x: 195, z: -36 });
  });
});
