export interface CollisionResponse {
  dimension: string;
  fromX: number;
  fromZ: number;
  blocks: number[];
}

export class CollisionBlockIndex {
  private readonly blocks = new Set<string>();
  private readonly surfaceHeights = new Map<string, number>();

  isSolidBlock(x: number, y: number, z: number): boolean {
    return this.blocks.has(`${x},${y},${z}`);
  }

  getSurfaceHeight(x: number, z: number): number | undefined {
    return this.surfaceHeights.get(`${Math.floor(x)},${Math.floor(z)}`);
  }

  addBlock(x: number, y: number, z: number): void {
    this.blocks.add(`${x},${y},${z}`);
    const column = `${x},${z}`;
    const surface = y + 1;
    const previous = this.surfaceHeights.get(column);
    if (previous === undefined || surface > previous) this.surfaceHeights.set(column, surface);
  }

  replaceRegion(collision: CollisionResponse): void {
    for (let index = 0; index + 2 < collision.blocks.length; index += 3) {
      this.addBlock(collision.blocks[index]!, collision.blocks[index + 1]!, collision.blocks[index + 2]!);
    }
  }

  removeColumns(columns: ReadonlySet<string>): void {
    for (const block of this.blocks) {
      const [x, , z] = block.split(',');
      if (columns.has(`${x},${z}`)) this.blocks.delete(block);
    }
    for (const column of columns) this.surfaceHeights.delete(column);
  }

  clear(): void {
    this.blocks.clear();
    this.surfaceHeights.clear();
  }
}

const FETCH_TIMEOUT_MS = 3000;
let loggedUnavailable = false;

export async function fetchCollisionHeights(url: string): Promise<CollisionResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    return (await response.json()) as CollisionResponse;
  } catch {
    if (!loggedUnavailable) {
      console.info('[StreetCraft] Server collision unavailable, using geometry-based fallback');
      loggedUnavailable = true;
    }
    return null;
  }
}
