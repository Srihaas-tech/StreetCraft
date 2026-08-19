export interface CollisionResponse {
  dimension: string;
  fromX: number;
  fromZ: number;
  width: number;
  depth: number;
  heights: number[];
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
