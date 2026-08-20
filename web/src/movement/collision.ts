/**
 * A read-only terrain query. A BlueMap-backed adapter can implement this
 * without exposing its rendering data to movement code.
 */
export interface CollisionWorld {
  isSolidBlock(x: number, y: number, z: number): boolean;
}

export interface PhysicsVector {
  x: number;
  y: number;
  z: number;
}

/**
 * The player is an upright AABB. `position` is the camera/eye position, so
 * `eyeHeight` is measured from the AABB's bottom to the camera.
 */
export interface PlayerBounds {
  width: number;
  height: number;
  eyeHeight: number;
}

export interface MovementResolution {
  position: PhysicsVector;
  velocity: PhysicsVector;
  grounded: boolean;
}

export interface MovementRequest {
  position: PhysicsVector;
  velocity: PhysicsVector;
  bounds?: PlayerBounds;
  world: CollisionWorld;
  deltaSeconds: number;
  gravity?: number;
  terminalVelocity?: number;
}

export const DEFAULT_PLAYER_BOUNDS: Readonly<PlayerBounds> = {
  width: 1,
  height: 2,
  eyeHeight: 1.62,
};

export const DEFAULT_GRAVITY = 24;
export const DEFAULT_TERMINAL_VELOCITY = 48;

const MAX_SUBSTEP_DISTANCE = 0.1;
const CONTACT_EPSILON = 0.001;
const COLLISION_EPSILON = 1e-9;
const STEP_HEIGHT = 0.6;

/**
 * Advances velocity and position by one deterministic physics step, then
 * resolves the player AABB against solid unit blocks one axis at a time.
 */
export function resolveMovement(request: MovementRequest): MovementResolution {
  const bounds = validBoundsOrDefault(request.bounds);
  const deltaSeconds = validDeltaSeconds(request.deltaSeconds);
  const gravity = nonNegativeFiniteOrDefault(request.gravity, DEFAULT_GRAVITY);
  const terminalVelocity = nonNegativeFiniteOrDefault(
    request.terminalVelocity,
    DEFAULT_TERMINAL_VELOCITY,
  );
  const position = finiteVectorOrZero(request.position);
  const velocity = finiteVectorOrZero(request.velocity);

  let ejectionSteps = 0;
  while (intersectsSolidBlock(position, bounds, request.world) && ejectionSteps < 200) {
    position.y += 0.1;
    ejectionSteps++;
  }

  velocity.y = Math.max(velocity.y - (gravity * deltaSeconds), -terminalVelocity);
  const distance = scale(velocity, deltaSeconds);
  const steps = Math.max(1, Math.ceil(maxComponent(distance) / MAX_SUBSTEP_DISTANCE));
  const stepDistance = scale(distance, 1 / steps);

  const initialPosition = { ...position };
  const initialStepDistance = { ...stepDistance };
  let xBlocked = false;
  let zBlocked = false;

  for (let step = 0; step < steps; step += 1) {
    const xResult = moveAxis(position, 'x', stepDistance.x, bounds, request.world);
    position.x = xResult.position;
    if (xResult.blocked) {
      velocity.x = 0;
      stepDistance.x = 0;
      xBlocked = true;
    }

    const yResult = moveAxis(position, 'y', stepDistance.y, bounds, request.world);
    position.y = yResult.position;
    if (yResult.blocked) {
      velocity.y = 0;
      stepDistance.y = 0;
    }

    const zResult = moveAxis(position, 'z', stepDistance.z, bounds, request.world);
    position.z = zResult.position;
    if (zResult.blocked) {
      velocity.z = 0;
      stepDistance.z = 0;
      zBlocked = true;
    }
  }

  if ((xBlocked || zBlocked) && hasGroundBelow(position, bounds, request.world)) {
    const elevatedStart = { x: position.x, y: position.y + STEP_HEIGHT, z: position.z };
    if (!intersectsSolidBlock(elevatedStart, bounds, request.world)) {
      const remainingX = (initialStepDistance.x * steps) - (position.x - initialPosition.x);
      const remainingZ = (initialStepDistance.z * steps) - (position.z - initialPosition.z);
      const elevatedTarget = { ...elevatedStart };

      if (xBlocked && remainingX !== 0) {
        const xResult = moveAxis(elevatedTarget, 'x', remainingX, bounds, request.world);
        elevatedTarget.x = xResult.position;
      }
      if (zBlocked && remainingZ !== 0) {
        const zResult = moveAxis(elevatedTarget, 'z', remainingZ, bounds, request.world);
        elevatedTarget.z = zResult.position;
      }

      if (!intersectsSolidBlock(elevatedTarget, bounds, request.world)) {
        position.x = elevatedTarget.x;
        position.z = elevatedTarget.z;
        position.y = elevatedTarget.y;
        const snapResult = moveAxis(position, 'y', -STEP_HEIGHT, bounds, request.world);
        position.y = snapResult.position;
      }
    }
  }

  return {
    position,
    velocity,
    grounded: hasGroundBelow(position, bounds, request.world),
  };
}

function moveAxis(
  position: PhysicsVector,
  axis: keyof PhysicsVector,
  distance: number,
  bounds: PlayerBounds,
  world: CollisionWorld,
): { position: number; blocked: boolean } {
  if (distance === 0) return { position: position[axis], blocked: false };

  const start = position[axis];
  const target = start + distance;
  const candidate = { ...position, [axis]: target };
  if (!intersectsSolidBlock(candidate, bounds, world)) {
    return { position: target, blocked: false };
  }

  let free = start;
  let blocked = target;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const midpoint = (free + blocked) / 2;
    const midpointPosition = { ...position, [axis]: midpoint };
    if (intersectsSolidBlock(midpointPosition, bounds, world)) {
      blocked = midpoint;
    } else {
      free = midpoint;
    }
  }
  return { position: free, blocked: true };
}

function hasGroundBelow(position: PhysicsVector, bounds: PlayerBounds, world: CollisionWorld): boolean {
  return intersectsSolidBlock({ ...position, y: position.y - CONTACT_EPSILON }, bounds, world);
}

function intersectsSolidBlock(position: PhysicsVector, bounds: PlayerBounds, world: CollisionWorld): boolean {
  const halfWidth = bounds.width / 2;
  const minimumX = position.x - halfWidth;
  const maximumX = position.x + halfWidth;
  const minimumY = position.y - bounds.eyeHeight;
  const maximumY = minimumY + bounds.height;
  const minimumZ = position.z - halfWidth;
  const maximumZ = position.z + halfWidth;

  for (let x = Math.floor(minimumX + COLLISION_EPSILON); x <= Math.floor(maximumX - COLLISION_EPSILON); x += 1) {
    for (let y = Math.floor(minimumY + COLLISION_EPSILON); y <= Math.floor(maximumY - COLLISION_EPSILON); y += 1) {
      for (let z = Math.floor(minimumZ + COLLISION_EPSILON); z <= Math.floor(maximumZ - COLLISION_EPSILON); z += 1) {
        if (world.isSolidBlock(x, y, z)) return true;
      }
    }
  }
  return false;
}

function finiteVectorOrZero(vector: PhysicsVector): PhysicsVector {
  return {
    x: Number.isFinite(vector.x) ? vector.x : 0,
    y: Number.isFinite(vector.y) ? vector.y : 0,
    z: Number.isFinite(vector.z) ? vector.z : 0,
  };
}

function validBoundsOrDefault(bounds: PlayerBounds | undefined): PlayerBounds {
  if (
    bounds !== undefined
    && Number.isFinite(bounds.width) && bounds.width > 0
    && Number.isFinite(bounds.height) && bounds.height > 0
    && Number.isFinite(bounds.eyeHeight) && bounds.eyeHeight >= 0 && bounds.eyeHeight <= bounds.height
  ) {
    return bounds;
  }
  return DEFAULT_PLAYER_BOUNDS;
}

function validDeltaSeconds(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeFiniteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function scale(vector: PhysicsVector, multiplier: number): PhysicsVector {
  return { x: vector.x * multiplier, y: vector.y * multiplier, z: vector.z * multiplier };
}

function maxComponent(vector: PhysicsVector): number {
  return Math.max(Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z));
}
