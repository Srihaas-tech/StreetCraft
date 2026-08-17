import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBlockInfo,
  isContainerBlockId,
  renderBlockInfoPanel,
} from '../src/inspection/block-info';
import { raycastBlock } from '../src/inspection/raycast';

const meshes: Mesh[] = [];

afterEach(() => {
  for (const mesh of meshes.splice(0)) {
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  }
});

function blockAt(x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  meshes.push(mesh);
  return mesh;
}

describe('block raycasting', () => {
  it('selects the nearest visible terrain hit and floors the solid side of its face (catches farther-hit selection)', () => {
    const nearest = blockAt(0, 0, -4);
    const farther = blockAt(0, 0, -8);

    const hit = raycastBlock({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, -4),
      maximumDistance: 10,
      targetObjects: [farther, nearest],
    });

    expect(hit).toMatchObject({
      distance: 3.5,
      point: new Vector3(0, 0, -3.5),
      normal: new Vector3(0, 0, 1),
      x: 0,
      y: 0,
      z: -4,
    });
  });

  it('returns no hit outside the supplied terrain and maximum distance (catches fabricated block selections)', () => {
    const outOfRange = blockAt(0, 0, -8);

    expect(raycastBlock({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, -1),
      maximumDistance: 4,
      targetObjects: [outOfRange],
    })).toBeUndefined();
  });

  it('returns no hit for invalid ray direction or distance (catches invalid Raycaster input)', () => {
    const target = blockAt(0, 0, -4);

    expect(raycastBlock({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, 0),
      maximumDistance: 10,
      targetObjects: [target],
    })).toBeUndefined();
    expect(raycastBlock({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(Number.NaN, 0, -1),
      maximumDistance: 10,
      targetObjects: [target],
    })).toBeUndefined();
    expect(raycastBlock({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, -1),
      maximumDistance: 0,
      targetObjects: [target],
    })).toBeUndefined();
  });

  it('uses the solid side coordinate at negative world coordinates (catches truncation toward zero)', () => {
    const target = blockAt(-1, 0, -4);

    const hit = raycastBlock({
      origin: new Vector3(-1, 0, 0),
      direction: new Vector3(0, 0, -1),
      maximumDistance: 10,
      targetObjects: [target],
    });

    expect(hit).toMatchObject({ x: -1, y: 0, z: -4 });
  });
});

describe('public block information', () => {
  it('recognizes only the supported namespaced readable container IDs (catches accidental broad container matching)', () => {
    for (const id of [
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
    ]) {
      expect(isContainerBlockId(id)).toBe(true);
    }

    expect(isContainerBlockId('minecraft:stone')).toBe(false);
    expect(isContainerBlockId('not_minecraft:chest')).toBe(false);
    expect(isContainerBlockId('chest')).toBe(false);
    expect(isContainerBlockId('minecraft:almost_shulker_box')).toBe(false);
  });

  it('renders and updates an accessible text-only panel for public block fields (catches HTML injection and stale details)', () => {
    const container = document.createElement('div');
    const first = createBlockInfo('minecraft:chest', { x: 1, y: 64, z: -2 });
    const second = createBlockInfo('<img src=x onerror=alert(1)>', { x: -3, y: 70, z: 4 });

    const panel = renderBlockInfoPanel(container, first);
    const updatedPanel = renderBlockInfoPanel(container, second);

    expect(updatedPanel).toBe(panel);
    expect(container.querySelectorAll('[data-streetcraft-block-info-panel]').length).toBe(1);
    expect(panel.getAttribute('role')).toBe('status');
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.textContent).toContain('-3, 70, 4');
    expect(panel.textContent).toContain('Supported container: No');
    expect(panel.querySelector('img')).toBeNull();
  });
});
