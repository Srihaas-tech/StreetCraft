import { Material, Matrix3, Object3D, Raycaster, Vector3 } from 'three';

export interface RaycastBlockRequest {
  origin: Vector3;
  direction: Vector3;
  maximumDistance: number;
  targetObjects: readonly Object3D[];
}

export interface BlockRaycastHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  x: number;
  y: number;
  z: number;
}

const BLOCK_FACE_NUDGE = 1e-6;

/**
 * Raycasts BlueMap/Three.js terrain and returns the Minecraft block on the
 * solid side of the nearest visible face.
 */
export function raycastBlock(request: RaycastBlockRequest): BlockRaycastHit | undefined {
  if (
    !isFiniteVector(request.origin)
    || !isFiniteVector(request.direction)
    || request.direction.lengthSq() === 0
    || !Number.isFinite(request.maximumDistance)
    || request.maximumDistance <= 0
  ) {
    return undefined;
  }

  const direction = request.direction.clone().normalize();
  const raycaster = new Raycaster(request.origin, direction, 0, request.maximumDistance);

  for (const object of request.targetObjects) {
    object.updateWorldMatrix(true, true);
  }

  const intersection = raycaster.intersectObjects([...request.targetObjects], true)
    .find((candidate) => (
      candidate.face != null
      && isVisibleInHierarchy(candidate.object)
      && hasVisibleEffectiveMaterial(candidate.object, candidate.face.materialIndex)
    ));

  if (intersection === undefined || intersection.face == null) return undefined;

  const normalMatrix = new Matrix3().getNormalMatrix(intersection.object.matrixWorld);
  const normal = intersection.face.normal.clone().applyNormalMatrix(normalMatrix);
  const point = intersection.point.clone();
  const solidPoint = point.clone().addScaledVector(normal, -BLOCK_FACE_NUDGE);

  return {
    distance: intersection.distance,
    point,
    normal,
    x: Math.floor(solidPoint.x),
    y: Math.floor(solidPoint.y),
    z: Math.floor(solidPoint.z),
  };
}

function isFiniteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isVisibleInHierarchy(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function hasVisibleEffectiveMaterial(object: Object3D, materialIndex: number): boolean {
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  if (material === undefined) return true;

  if (Array.isArray(material)) {
    const effectiveMaterial = material[materialIndex];
    return effectiveMaterial !== undefined && effectiveMaterial.visible;
  }

  return material.visible;
}
