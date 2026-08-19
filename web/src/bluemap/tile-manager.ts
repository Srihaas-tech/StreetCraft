import { Scene, Object3D, Mesh, BufferAttribute } from 'three';
import type { HiresTileLoader } from './hires-tile-loader';
import type { HiresTileSettings } from './hires-tile-loader';
import { fetchCollisionHeights } from './collision-client';

export interface TileManagerOptions {
  loader: HiresTileLoader;
  scene: Scene;
  terrainObjects: Object3D[];
  settings: HiresTileSettings;
  viewDistance?: number;
  collisionUrlBuilder?: (fromX: number, fromZ: number, toX: number, toZ: number) => string;
}

const DEFAULT_VIEW_DISTANCE = 256;
const MAX_CONCURRENT_LOADS = 8;

export class TileManager {
  private readonly loader: HiresTileLoader;
  private readonly scene: Scene;
  private readonly terrainObjects: Object3D[];
  private readonly settings: HiresTileSettings;
  private readonly viewDistance: number;
  private readonly collisionUrlBuilder: ((fromX: number, fromZ: number, toX: number, toZ: number) => string) | undefined;
  private readonly tiles = new Map<string, Mesh>();
  private readonly loading = new Set<string>();
  private readonly solidBlocks = new Map<string, number>();
  private centerTileX = Infinity;
  private centerTileZ = Infinity;
  private scheduledUpdate: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TileManagerOptions) {
    this.loader = options.loader;
    this.scene = options.scene;
    this.terrainObjects = options.terrainObjects;
    this.settings = options.settings;
    this.viewDistance = options.viewDistance ?? DEFAULT_VIEW_DISTANCE;
    this.collisionUrlBuilder = options.collisionUrlBuilder;
  }

  isSolidBlock(x: number, y: number, z: number): boolean {
    const key = `${x},${z}`;
    const maxY = this.solidBlocks.get(key);
    return maxY !== undefined && y < maxY;
  }

  getSurfaceHeight(worldX: number, worldZ: number): number | undefined {
    const bx = Math.floor(worldX);
    const bz = Math.floor(worldZ);
    return this.solidBlocks.get(`${bx},${bz}`);
  }

  private buildCollisionData(mesh: Mesh): void {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as BufferAttribute | undefined;
    if (posAttr === undefined) return;

    const normAttr = geo.getAttribute('normal') as BufferAttribute | undefined;
    const sx = mesh.scale.x;
    const sz = mesh.scale.z;
    const px = mesh.position.x;
    const pz = mesh.position.z;

    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      if (normAttr !== undefined) {
        const nx = normAttr.getX(i);
        const ny = normAttr.getY(i);
        const nz = normAttr.getZ(i);
        const axisAligned =
          (Math.abs(nx) > 0.9 && Math.abs(ny) < 0.1 && Math.abs(nz) < 0.1) ||
          (Math.abs(ny) > 0.9 && Math.abs(nx) < 0.1 && Math.abs(nz) < 0.1) ||
          (Math.abs(nz) > 0.9 && Math.abs(nx) < 0.1 && Math.abs(ny) < 0.1);
        if (!axisAligned) continue;
      }

      const wx = Math.floor(posAttr.getX(i) * sx + px);
      const wy = Math.floor(posAttr.getY(i));
      const wz = Math.floor(posAttr.getZ(i) * sz + pz);
      const key = `${wx},${wz}`;
      const prev = this.solidBlocks.get(key);
      if (prev === undefined || wy > prev) {
        this.solidBlocks.set(key, wy);
      }
    }
  }

  private clearCollisionData(mesh: Mesh): void {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as BufferAttribute | undefined;
    if (posAttr === undefined) return;

    const sx = mesh.scale.x;
    const sz = mesh.scale.z;
    const px = mesh.position.x;
    const pz = mesh.position.z;

    const count = posAttr.count;
    const columns = new Set<string>();
    for (let i = 0; i < count; i++) {
      const wx = Math.floor(posAttr.getX(i) * sx + px);
      const wz = Math.floor(posAttr.getZ(i) * sz + pz);
      columns.add(`${wx},${wz}`);
    }

    for (const key of columns) {
      this.solidBlocks.delete(key);
    }
  }

  private applyServerCollision(collision: { fromX: number; fromZ: number; width: number; depth: number; heights: number[] }): void {
    const { fromX, fromZ, width, depth, heights } = collision;
    for (let dz = 0; dz < depth; dz++) {
      for (let dx = 0; dx < width; dx++) {
        const y = heights[dz * width + dx] ?? -1;
        if (y > -1) {
          this.solidBlocks.set(`${fromX + dx},${fromZ + dz}`, y);
        }
      }
    }
  }

  private triggerDeferredLoad(): void {
    if (this.scheduledUpdate === null && this.loading.size === 0) {
      this.scheduledUpdate = setTimeout(() => {
        this.scheduledUpdate = null;
        this.loadCloseTiles();
      }, 0);
    }
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
      const parts = key.split(',');
      const tx = Number(parts[0]);
      const tz = Number(parts[1]);
      if (
        Math.abs(tx - this.centerTileX) > halfTiles ||
        Math.abs(tz - this.centerTileZ) > halfTiles
      ) {
        this.scene.remove(mesh);
        const idx = this.terrainObjects.indexOf(mesh);
        if (idx !== -1) this.terrainObjects.splice(idx, 1);
        this.clearCollisionData(mesh);
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
        const centerX = this.centerTileX * this.settings.tileSize.x + this.settings.translate.x;
        const centerZ = this.centerTileZ * this.settings.tileSize.z + this.settings.translate.z;
        const dist = Math.hypot(worldX - centerX, worldZ - centerZ);
        if (dist > this.viewDistance) continue;

        this.loading.add(key);
        this.loader.load(tx, tz, () => false).then((mesh) => {
          this.loading.delete(key);
          if (mesh === null) {
            console.warn(`[StreetCraft] Tile ${key} returned null`);
            return;
          }

          if (this.tiles.has(key)) {
            mesh.geometry.dispose();
            return;
          }

          this.tiles.set(key, mesh);
          this.scene.add(mesh);
          this.terrainObjects.push(mesh);

          const tileFromX = Math.floor(mesh.position.x);
          const tileFromZ = Math.floor(mesh.position.z);
          const tileToX = tileFromX + Math.floor(this.settings.tileSize.x * this.settings.scale.x) - 1;
          const tileToZ = tileFromZ + Math.floor(this.settings.tileSize.z * this.settings.scale.z) - 1;

          if (this.collisionUrlBuilder !== undefined) {
            const url = this.collisionUrlBuilder(tileFromX, tileFromZ, tileToX, tileToZ);
            fetchCollisionHeights(url).then((collision) => {
              if (collision !== null && this.tiles.has(key)) {
                this.applyServerCollision(collision);
              } else if (this.tiles.has(key)) {
                this.buildCollisionData(mesh);
              }
              this.triggerDeferredLoad();
            }).catch(() => {
              if (this.tiles.has(key)) {
                this.buildCollisionData(mesh);
              }
              this.triggerDeferredLoad();
            });
          } else {
            this.buildCollisionData(mesh);
            this.triggerDeferredLoad();
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
    this.solidBlocks.clear();
  }
}
