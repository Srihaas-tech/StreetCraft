import { Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraController } from '../src/movement/camera-controller';
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

function press(code: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD'): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { code }));
}

function release(code: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD'): void {
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

  it('uses pointer-locked mouse deltas for yaw and pitch (catches ignored mouse look)', () => {
    const { canvas, controller } = createControls({ mouseSensitivity: 0.01 });
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    moveMouse(20, -10);

    controller.update(0);

    expect(controller.yaw).toBeCloseTo(0.2);
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

    expect(controller.yaw).toBeCloseTo(0.1);
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

  it('clears a released key (catches stuck keyboard movement)', () => {
    const { input } = createControls();
    press('KeyW');
    release('KeyW');

    expect(input.isPressed('KeyW')).toBe(false);
  });
});
