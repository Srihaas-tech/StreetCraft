import type { BlueMapAxes, BlueMapMapSettings } from './map-loader';

export interface WorldCoordinates {
  x: number;
  y: number;
  z: number;
}

export function worldToRenderCoordinates(coordinates: WorldCoordinates): WorldCoordinates {
  return { ...coordinates };
}

export function tileToRenderCoordinates(
  coordinates: BlueMapAxes,
  settings: BlueMapMapSettings,
): BlueMapAxes {
  const worldCoordinates = worldToRenderCoordinates({
    x: coordinates.x * settings.hiresTileSize.x,
    y: 0,
    z: coordinates.z * settings.hiresTileSize.z,
  });

  return {
    x: worldCoordinates.x * settings.scale.x + settings.translate.x,
    z: worldCoordinates.z * settings.scale.z + settings.translate.z,
  };
}
