export interface CollisionResponse {
  dimension: string;
  fromX: number;
  fromZ: number;
  width: number;
  depth: number;
  heights: number[];
}

export async function fetchCollisionHeights(url: string): Promise<CollisionResponse | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return (await response.json()) as CollisionResponse;
  } catch {
    return null;
  }
}
