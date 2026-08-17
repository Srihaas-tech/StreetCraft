import { Camera, PerspectiveCamera, Vector3 } from 'three';
import type { MovementInput } from './input';

export interface CameraControllerOptions {
  camera?: Camera;
  position?: Vector3;
  speed?: number;
  mouseSensitivity?: number;
  pitchLimit?: number;
}

const DEFAULT_SPEED = 6;
const DEFAULT_MOUSE_SENSITIVITY = 0.002;
const DEFAULT_PITCH_LIMIT = (Math.PI / 2) - 0.001;

export class CameraController {
  readonly camera: Camera;
  readonly position: Vector3;
  readonly speed: number;
  readonly mouseSensitivity: number;
  readonly pitchLimit: number;
  private yawRadians = 0;
  private pitchRadians = 0;

  constructor(
    private readonly input: MovementInput,
    options: CameraControllerOptions = {},
  ) {
    this.camera = options.camera ?? new PerspectiveCamera();
    this.position = this.camera.position;
    if (options.position !== undefined) {
      this.position.copy(options.position);
    }
    this.speed = nonNegativeFiniteOrDefault(options.speed, DEFAULT_SPEED);
    this.mouseSensitivity = nonNegativeFiniteOrDefault(
      options.mouseSensitivity,
      DEFAULT_MOUSE_SENSITIVITY,
    );
    this.pitchLimit = validPitchLimitOrDefault(options.pitchLimit);
    this.camera.rotation.order = 'YXZ';
  }

  get yaw(): number {
    return this.yawRadians;
  }

  get pitch(): number {
    return this.pitchRadians;
  }

  update(deltaSeconds: number): void {
    const mouseDelta = this.input.consumeMouseDelta();
    this.yawRadians += mouseDelta.x * this.mouseSensitivity;
    this.pitchRadians = clamp(
      this.pitchRadians - (mouseDelta.y * this.mouseSensitivity),
      -this.pitchLimit,
      this.pitchLimit,
    );
    this.applyRotation();

    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      return;
    }

    let forward = Number(this.input.isPressed('KeyW')) - Number(this.input.isPressed('KeyS'));
    let right = Number(this.input.isPressed('KeyD')) - Number(this.input.isPressed('KeyA'));
    const magnitude = Math.hypot(forward, right);

    if (magnitude > 1) {
      forward /= magnitude;
      right /= magnitude;
    }

    const distance = this.speed * deltaSeconds;
    this.position.x += (right * Math.cos(this.yawRadians) - forward * Math.sin(this.yawRadians)) * distance;
    this.position.z += (-right * Math.sin(this.yawRadians) - forward * Math.cos(this.yawRadians)) * distance;
  }

  private applyRotation(): void {
    this.camera.rotation.y = this.yawRadians;
    this.camera.rotation.x = this.pitchRadians;
  }
}

function nonNegativeFiniteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function validPitchLimitOrDefault(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 && value < Math.PI / 2
    ? value
    : DEFAULT_PITCH_LIMIT;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
