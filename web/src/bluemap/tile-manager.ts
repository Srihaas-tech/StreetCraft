import { Scene, Object3D, Mesh } from 'three';
import type { HiresTileLoader } from './hires-tile-loader';
import type { HiresTileSettings } from './hires-tile-loader';

export interface TileManagerOptions {
  loader: HiresTileLoader;
  scene: Scene;
  terrainObjects: Object3D[];
  settings: HiresTileSettings;
  viewDistance?: number;
}

const DEFAULT_VIEW_DISTANCE = 256;
const MAX_CONCURRENT_LOADS = 8;

export class TileManager {
  private readonly loader: HiresTileLoader;
  private readonly scene: Scene;
  private readonly terrainObjects: Object3D[];
  private readonly settings: HiresTileSettings;
  private readonly viewDistance: number;
  private readonly tiles = new Map<string, Mesh>();
  private readonly loading = new Set<string>();
  private centerTileX = 0;
  private centerTileZ = 0;
  private scheduledUpdate: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TileManagerOptions) {
    this.loader = options.loader;
    this.scene = options.scene;
    this.terrainObjects = options.terrainObjects;
    this.settings = options.settings;
    this.viewDistance = options.viewDistance ?? DEFAULT_VIEW_DISTANCE;
  }

  update(cameraX: number, cameraZ: number): void {
    const newTileX = Math.floor((cameraX - this.settings.translate.x) / this.settings.tileSize.x);
    const newTileZ = Math.floor((cameraZ - this.settings.translate.z) / this.settings.tileSize.z);

    if (newTileX === this.centerTileX && newTileZ === this.centerTileZ) return;

    this.centerTileX = newTileX;
    this.centerTileZ = newTileZ;

    this.removeFarTiles();

    if (this.scheduledUpdate !== null) return;
    this.scheduledUpdate = setTimeout(() => {
      this.scheduledUpdate = null;
      this.loadCloseTiles();
    }, 0);
  }

  private removeFarTiles(): void {
    const halfTiles = Math.ceil(this.viewDistance / this.settings.tileSize.x);

    for (const [key, mesh] of this.tiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (
        Math.abs(tx - this.centerTileX) > halfTiles ||
        Math.abs(tz - this.centerTileZ) > halfTiles
      ) {
        this.scene.remove(mesh);
        const idx = this.terrainObjects.indexOf(mesh);
        if (idx !== -1) this.terrainObjects.splice(idx, 1);
        mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
  }

  private loadCloseTiles(): void {
    if (this.loading.size >= MAX_CONCURRENT_LOADS) return;

    const halfTiles = Math.ceil(this.viewDistance / this.settings.tileSize.x);

    for (let dx = -halfTiles; dx <= halfTiles; dx++) {
      for (let dz = -halfTiles; dz <= halfTiles; dz++) {
        if (this.loading.size >= MAX_CONCURRENT_LOADS) return;

        const tx = this.centerTileX + dx;
        const tz = this.centerTileZ + dz;
        const key = `${tx},${tz}`;

        if (this.tiles.has(key) || this.loading.has(key)) continue;

        const worldX = tx * this.settings.tileSize.x + this.settings.translate.x;
        const worldZ = tz * this.settings.tileSize.z + this.settings.translate.z;
        const dist = Math.hypot(worldX - (this.centerTileX * this.settings.tileSize.x + this.settings.translate.x), worldZ - (this.centerTileZ * this.settings.tileSize.z + this.settings.translate.z));
        if (dist > this.viewDistance) continue;

        this.loading.add(key);
        this.loader.load(tx, tz, () => false).then((mesh) => {
          this.loading.delete(key);
          if (mesh === null) return;

          if (this.tiles.has(key)) {
            mesh.geometry.dispose();
            return;
          }

          this.tiles.set(key, mesh);
          this.scene.add(mesh);
          this.terrainObjects.push(mesh);

          if (this.scheduledUpdate === null && this.loading.size === 0) {
            this.scheduledUpdate = setTimeout(() => {
              this.scheduledUpdate = null;
              this.loadCloseTiles();
            }, 0);
          }
        }).catch(() => {
          this.loading.delete(key);
        });
      }
    }
  }

  dispose(): void {
    if (this.scheduledUpdate !== null) {
      clearTimeout(this.scheduledUpdate);
      this.scheduledUpdate = null;
    }

    for (const [, mesh] of this.tiles) {
      this.scene.remove(mesh);
      const idx = this.terrainObjects.indexOf(mesh);
      if (idx !== -1) this.terrainObjects.splice(idx, 1);
      mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.loading.clear();
  }
}
