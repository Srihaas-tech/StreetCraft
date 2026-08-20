import { Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraController } from '../src/movement/camera-controller';
import { DEFAULT_PLAYER_BOUNDS, resolveMovement } from '../src/movement/collision';
import { MovementInput } from '../src/movement/input';

const inputs: MovementInput[] = [];

afterEach(() => {
  for (const input of inputs.splice(0)) {
    input.dispose();
  }

  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    value: null,
  });
});

function createControls(options: ConstructorParameters<typeof CameraController>[1] = {}) {
  const canvas = document.createElement('canvas');
  const input = new MovementInput(canvas, document);
  const controller = new CameraController(input, options);
  inputs.push(input);
  return { canvas, input, controller };
}

function press(code: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'Space'): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { code }));
}

function release(code: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'Space'): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

function moveMouse(movementX: number, movementY: number): void {
  const event = new Event('mousemove');
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  document.dispatchEvent(event);
}

describe('first-person movement', () => {
  it('moves forward along negative Z at zero yaw (catches a reversed forward vector)', () => {
    const { controller } = createControls({ speed: 6 });
    press('KeyW');

    controller.update(0.5);

    expect(controller.position).toEqual(new Vector3(0, 0, -3));
  });

  it('moves backward along positive Z at zero yaw (catches a reversed backward vector)', () => {
    const { controller } = createControls({ speed: 6 });
    press('KeyS');

    controller.update(0.5);

    expect(controller.position).toEqual(new Vector3(0, 0, 3));
  });

  it('moves left along negative X at zero yaw (catches swapped horizontal axes)', () => {
    const { controller } = createControls({ speed: 6 });
    press('KeyA');

    controller.update(0.5);

    expect(controller.position).toEqual(new Vector3(-3, 0, 0));
  });

  it('moves right along positive X at zero yaw (catches an inverted right vector)', () => {
    const { controller } = createControls({ speed: 6 });
    press('KeyD');

    controller.update(0.5);

    expect(controller.position).toEqual(new Vector3(3, 0, 0));
  });

  it('normalizes diagonal WASD movement (catches a diagonal speed boost)', () => {
    const { controller } = createControls({ speed: 10 });
    press('KeyW');
    press('KeyD');

    controller.update(1);

    expect(controller.position.x).toBeCloseTo(Math.sqrt(50));
    expect(controller.position.z).toBeCloseTo(-Math.sqrt(50));
    expect(controller.position.length()).toBeCloseTo(10);
  });

  it('uses yaw-relative directions after turning 90 degrees (catches world-axis movement)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 1, speed: 6 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(Math.PI / 2, 0);
    controller.update(0);
    press('KeyW');

    controller.update(1);

    expect(controller.position.x).toBeCloseTo(6);
    expect(controller.position.y).toBe(0);
    expect(controller.position.z).toBeCloseTo(0);
  });

  it('uses yaw-relative right movement after turning 90 degrees (catches a world-axis right vector)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 1, speed: 6 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(Math.PI / 2, 0);
    controller.update(0);
    press('KeyD');

    controller.update(1);

    expect(controller.position.x).toBeCloseTo(0);
    expect(controller.position.z).toBeCloseTo(6);
  });

  it('uses pointer-locked mouse deltas for yaw and pitch (catches ignored mouse look)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 0.01 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(20, -10);

    controller.update(0);

    expect(controller.yaw).toBeCloseTo(-0.2);
    expect(controller.pitch).toBeCloseTo(0.1);
  });

  it('ignores mouse movement outside pointer lock (catches unintended page mouse look)', () => {
    const { controller } = createControls({ mouseSensitivity: 0.01 });
    moveMouse(20, -10);

    controller.update(0);

    expect(controller.yaw).toBe(0);
    expect(controller.pitch).toBe(0);
  });

  it('clamps pitch just inside the vertical look limit (catches camera flip-over)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 1 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(0, -10_000);

    controller.update(0);

    expect(controller.pitch).toBeLessThan(Math.PI / 2);
    expect(controller.pitch).toBeGreaterThan(1.5);
  });

  it('discards mouse deltas after an update (catches repeated mouse rotation)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 0.01 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(10, 0);

    controller.update(0);
    controller.update(0);

    expect(controller.yaw).toBeCloseTo(-0.1);
  });

  it('ignores invalid delta seconds (catches NaN positions and backward movement)', () => {
    const { controller } = createControls({ speed: 6 });
    press('KeyW');

    controller.update(Number.NaN);
    controller.update(-1);
    controller.update(Number.POSITIVE_INFINITY);

    expect(controller.position).toEqual(new Vector3(0, 0, 0));
  });
});

describe('movement input lifecycle', () => {
  it('stops tracking keys after dispose (catches leaked document listeners)', () => {
    const { input } = createControls();
    input.dispose();
    press('KeyW');

    expect(input.isPressed('KeyW')).toBe(false);
  });

  it('clears Space after dispose (catches a stuck jump key)', () => {
    const { input } = createControls();
    input.dispose();
    press('Space');

    expect(input.isPressed('Space')).toBe(false);
  });

  it('forwards pointer-lock requests to its configured element (catches a disconnected lock request)', () => {
    const canvas = document.createElement('canvas');
    let requests = 0;
    Object.defineProperty(canvas, 'requestPointerLock', {
      configurable: true,
      value: () => { requests += 1; },
    });
    const input = new MovementInput(canvas, document);
    inputs.push(input);

    input.requestPointerLock();

    expect(requests).toBe(1);
  });

  it('returns a rejected pointer-lock request so callers can handle it (catches hidden lock failures)', async () => {
    const canvas = document.createElement('canvas');
    const rejection = Promise.reject(new Error('Pointer lock denied'));
    void rejection.catch(() => undefined);
    Object.defineProperty(canvas, 'requestPointerLock', {
      configurable: true,
      value: () => rejection,
    });
    const input = new MovementInput(canvas, document);
    inputs.push(input);

    expect(input.requestPointerLock()).toBe(rejection);
    await expect(input.requestPointerLock()).rejects.toThrow('Pointer lock denied');
  });

  it('tracks keys through an injected event target (catches hidden dependence on global document state)', () => {
    const canvas = document.createElement('canvas');
    const eventTarget = new EventTarget();
    Object.defineProperty(eventTarget, 'pointerLockElement', { configurable: true, value: null });
    const input = new MovementInput(canvas, eventTarget as MovementInputEventTarget);
    inputs.push(input);
    const event = new Event('keydown');
    Object.defineProperty(event, 'code', { value: 'KeyW' });

    eventTarget.dispatchEvent(event);

    expect(input.isPressed('KeyW')).toBe(true);
  });

  it('clears a released key (catches stuck keyboard movement)', () => {
    const { input } = createControls();
    press('KeyW');
    release('KeyW');

    expect(input.isPressed('KeyW')).toBe(false);
  });
});

class InMemoryCollisionWorld {
  private readonly solidBlocks = new Set<string>();

  addSolidBlock(x: number, y: number, z: number): void {
    this.solidBlocks.add(`${x},${y},${z}`);
  }

  isSolidBlock(x: number, y: number, z: number): boolean {
    return this.solidBlocks.has(`${x},${y},${z}`);
  }
}

function resolveInWorld(
  world: InMemoryCollisionWorld,
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  deltaSeconds: number,
  gravity = 0,
  terminalVelocity = 48,
) {
  return resolveMovement({
    world,
    position,
    velocity,
    deltaSeconds,
    gravity,
    terminalVelocity,
  });
}

describe('collision resolution', () => {
  it('uses the requested two-block-high, one-block-wide player body', () => {
    expect(DEFAULT_PLAYER_BOUNDS).toEqual({ width: 1, height: 2, eyeHeight: 1.62 });
  });

  it('clamps leftward movement against a negative-coordinate wall (catches incorrect block flooring)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(-2, 1, 0);

    const result = resolveInWorld(world, { x: 0, y: 2.62, z: 0.5 }, { x: -5, y: 0, z: 0 }, 1);

    expect(result.position.x).toBeCloseTo(-0.5, 6);
    expect(result.position.y).toBe(2.62);
    expect(result.position.z).toBe(0.5);
    expect(result.velocity.x).toBe(0);
  });

  it('clamps Z movement against a solid block (catches missing Z-axis resolution)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 1, -2);

    const result = resolveInWorld(world, { x: 0.5, y: 2.62, z: 0 }, { x: 0, y: 0, z: -5 }, 1);

    expect(result.position.x).toBe(0.5);
    expect(result.position.y).toBe(2.62);
    expect(result.position.z).toBeCloseTo(-0.5, 6);
    expect(result.velocity.z).toBe(0);
  });

  it('stops an upward player at a solid ceiling (catches upward AABB penetration)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 3, 0);

    const result = resolveInWorld(world, { x: 0.5, y: 2.62, z: 0.5 }, { x: 0, y: 5, z: 0 }, 1);

    expect(result.position.x).toBe(0.5);
    expect(result.position.y).toBeCloseTo(2.62, 6);
    expect(result.position.z).toBe(0.5);
    expect(result.velocity.y).toBe(0);
    expect(result.grounded).toBe(false);
  });

  it('does not tunnel through a wall at high speed (catches a single-step collision)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(2, 1, 0);

    const result = resolveInWorld(world, { x: 0, y: 2.62, z: 0.5 }, { x: 100, y: 0, z: 0 }, 1);

    expect(result.position.x).toBeCloseTo(1.5, 6);
    expect(result.velocity.x).toBe(0);
  });

  it('rests on a floor across repeated gravity frames (catches accumulated downward penetration)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 0, 0);
    const first = resolveInWorld(world, { x: 0.5, y: 2.62, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1 / 60, 24);
    const second = resolveInWorld(world, first.position, first.velocity, 1 / 60, 24);

    expect(first.position.y).toBeCloseTo(2.62, 6);
    expect(second.position.y).toBeCloseTo(2.62, 6);
    expect(second.velocity.y).toBe(0);
    expect(second.grounded).toBe(true);
  });

  it('clamps gravity at the configured terminal velocity (catches unbounded falling speed)', () => {
    const result = resolveInWorld(
      new InMemoryCollisionWorld(),
      { x: 0, y: 100, z: 0 },
      { x: 0, y: 0, z: 0 },
      1,
      100,
      10,
    );

    expect(result.position.x).toBe(0);
    expect(result.position.y).toBeCloseTo(90, 6);
    expect(result.position.z).toBe(0);
    expect(result.velocity).toMatchObject({ x: 0, y: -10, z: 0 });
  });

  it('treats non-finite and negative deltas as zero physics time (catches movement on invalid input)', () => {
    const nonFinite = resolveInWorld(
      new InMemoryCollisionWorld(),
      { x: -3, y: 4, z: 5 },
      { x: 2, y: -1, z: 3 },
      Number.NaN,
      24,
    );
    const negative = resolveInWorld(
      new InMemoryCollisionWorld(),
      { x: -3, y: 4, z: 5 },
      { x: 2, y: -1, z: 3 },
      -1,
      24,
    );

    expect(nonFinite.position).toMatchObject({ x: -3, y: 4, z: 5 });
    expect(nonFinite.velocity).toMatchObject({ x: 2, y: -1, z: 3 });
    expect(negative.position).toMatchObject({ x: -3, y: 4, z: 5 });
    expect(negative.velocity).toMatchObject({ x: 2, y: -1, z: 3 });
  });
});

describe('street view physics', () => {
  it('stops at a solid wall (catches movement through terrain)', () => {
    const world = new InMemoryCollisionWorld();
    for (const y of [-2, -1, 0, 1]) {
      world.addSolidBlock(1, y, 0);
    }
    const { controller } = createControls({
      position: new Vector3(0, 2.62, 0),
      speed: 6,
      collisionWorld: world,
    });
    press('KeyD');

    controller.update(1);

    expect(controller.position.x).toBeCloseTo(0.5, 4);
  });

  it('reports grounded when standing on a solid surface (catches falling through a floor)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 0, 0);
    const { controller } = createControls({
      position: new Vector3(0.5, 2.62, 0.5),
      collisionWorld: world,
    });

    controller.update(0);

    expect(controller.grounded).toBe(true);
  });

  it('applies jump velocity once from the ground (catches missing jump input)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 0, 0);
    const { controller } = createControls({
      position: new Vector3(0.5, 2.62, 0.5),
      collisionWorld: world,
      jumpVelocity: 8,
    });
    controller.update(0);
    press('Space');

    controller.update(0);

    expect(controller).toMatchObject({ velocity: new Vector3(0, 8, 0) });
  });

  it('jumps when Space is pressed on the first grounded update (catches stale grounded state)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 0, 0);
    const { controller } = createControls({
      position: new Vector3(0.5, 2.62, 0.5),
      collisionWorld: world,
      jumpVelocity: 8,
    });
    press('Space');

    controller.update(0);

    expect(controller.velocity.y).toBe(8);
    expect(controller.grounded).toBe(false);
  });

  it('does not repeat a held jump after landing (catches jump auto-repeat)', () => {
    const world = new InMemoryCollisionWorld();
    world.addSolidBlock(0, 0, 0);
    const { controller } = createControls({
      position: new Vector3(0.5, 2.62, 0.5),
      collisionWorld: world,
      jumpVelocity: 8,
    });
    controller.update(0);
    press('Space');
    controller.update(0);
    controller.update(1);

    controller.update(0);

    expect(controller.velocity.y).toBe(0);
    expect(controller.grounded).toBe(true);
  });

  it('applies delta-time gravity with a terminal speed (catches frame-dependent falling)', () => {
    const { controller } = createControls({
      position: new Vector3(0, 10, 0),
      collisionWorld: new InMemoryCollisionWorld(),
      gravity: 24,
      terminalVelocity: 48,
    });

    controller.update(0.5);

    expect(controller.position.y).toBeCloseTo(4, 10);
    expect(controller.velocity.y).toBe(-12);
  });

  it('keeps yaw-relative diagonal motion normalized while physics is enabled (catches a no-world-only implementation)', () => {
    const { canvas, controller } = createControls({
      collisionWorld: new InMemoryCollisionWorld(),
      gravity: 0,
      mouseSensitivity: 1,
      speed: 10,
    });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(Math.PI / 2, 0);
    controller.update(0);
    press('KeyW');
    press('KeyD');

    controller.update(1);

    expect(controller.position.x).toBeCloseTo(Math.sqrt(50));
    expect(controller.position.y).toBe(0);
    expect(controller.position.z).toBeCloseTo(Math.sqrt(50));
  });
});

type MovementInputEventTarget = ConstructorParameters<typeof MovementInput>[1];
