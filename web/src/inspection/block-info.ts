export interface BlockCoordinates {
  x: number;
  y: number;
  z: number;
}

/** The deliberately small public representation of a selected block. */
export interface BlockInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  isContainer: boolean;
}

const CONTAINER_BLOCK_IDS = new Set([
  'minecraft:chest',
  'minecraft:trapped_chest',
  'minecraft:barrel',
  'minecraft:shulker_box',
  'minecraft:white_shulker_box',
  'minecraft:orange_shulker_box',
  'minecraft:magenta_shulker_box',
  'minecraft:light_blue_shulker_box',
  'minecraft:yellow_shulker_box',
  'minecraft:lime_shulker_box',
  'minecraft:pink_shulker_box',
  'minecraft:gray_shulker_box',
  'minecraft:light_gray_shulker_box',
  'minecraft:cyan_shulker_box',
  'minecraft:purple_shulker_box',
  'minecraft:blue_shulker_box',
  'minecraft:brown_shulker_box',
  'minecraft:green_shulker_box',
  'minecraft:red_shulker_box',
  'minecraft:black_shulker_box',
]);

export function isContainerBlockId(id: string): boolean {
  return CONTAINER_BLOCK_IDS.has(id);
}

/**
 * Combines an exact block identifier from a future read-only API with the
 * selected terrain coordinates. It never derives IDs from render materials.
 */
export function createBlockInfo(id: string, coordinates: BlockCoordinates): BlockInfo {
  return {
    id,
    x: integerCoordinate(coordinates.x),
    y: integerCoordinate(coordinates.y),
    z: integerCoordinate(coordinates.z),
    isContainer: isContainerBlockId(id),
  };
}

/** Renders one reusable, text-only public block-information status panel. */
export function renderBlockInfoPanel(container: HTMLElement, info: BlockInfo): HTMLElement {
  const existing = container.querySelector<HTMLElement>('[data-streetcraft-block-info-panel]');
  const panel = existing ?? document.createElement('section');

  panel.dataset.streetcraftBlockInfoPanel = '';
  panel.className = 'streetcraft-block-info';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Block information');

  const heading = document.createElement('h2');
  heading.textContent = 'Block information';
  const blockId = document.createElement('p');
  blockId.textContent = `Block ID: ${info.id}`;
  const coordinates = document.createElement('p');
  coordinates.textContent = `Coordinates: ${info.x}, ${info.y}, ${info.z}`;
  const containerStatus = document.createElement('p');
  containerStatus.textContent = `Supported container: ${info.isContainer ? 'Yes' : 'No'}`;
  panel.replaceChildren(heading, blockId, coordinates, containerStatus);

  if (existing === null) container.append(panel);
  return panel;
}

function integerCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}
