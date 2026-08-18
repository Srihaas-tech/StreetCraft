import { Camera, PerspectiveCamera, Vector3 } from 'three';
import {
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_BOUNDS,
  DEFAULT_TERMINAL_VELOCITY,
  resolveMovement,
  type CollisionWorld,
  type PlayerBounds,
} from './collision';
import type { MovementInput } from './input';

export interface CameraControllerOptions {
  camera?: Camera;
  position?: Vector3;
  speed?: number;
  mouseSensitivity?: number;
  pitchLimit?: number;
  collisionWorld?: CollisionWorld;
  playerBounds?: PlayerBounds;
  gravity?: number;
  terminalVelocity?: number;
  jumpVelocity?: number;
}

const DEFAULT_SPEED = 6;
const DEFAULT_MOUSE_SENSITIVITY = 0.002;
const DEFAULT_PITCH_LIMIT = (Math.PI / 2) - 0.001;
const DEFAULT_JUMP_VELOCITY = 8;

export class CameraController {
  readonly camera: Camera;
  readonly position: Vector3;
  readonly speed: number;
  readonly mouseSensitivity: number;
  readonly pitchLimit: number;
  private readonly collisionWorld: CollisionWorld | undefined;
  private readonly playerBounds: PlayerBounds;
  private readonly gravity: number;
  private readonly terminalVelocity: number;
  private readonly jumpVelocity: number;
  private readonly velocityState = new Vector3();
  private yawRadians = 0;
  private pitchRadians = 0;
  private groundedState = false;
  private jumpWasPressed = false;

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
    this.collisionWorld = options.collisionWorld;
    this.playerBounds = validPlayerBoundsOrDefault(options.playerBounds);
    this.gravity = nonNegativeFiniteOrDefault(options.gravity, DEFAULT_GRAVITY);
    this.terminalVelocity = nonNegativeFiniteOrDefault(
      options.terminalVelocity,
      DEFAULT_TERMINAL_VELOCITY,
    );
    this.jumpVelocity = nonNegativeFiniteOrDefault(options.jumpVelocity, DEFAULT_JUMP_VELOCITY);
    this.camera.rotation.order = 'YXZ';
  }

  get yaw(): number {
    return this.yawRadians;
  }

  get pitch(): number {
    return this.pitchRadians;
  }

  get velocity(): Readonly<Vector3> {
    return this.velocityState.clone();
  }

  get grounded(): boolean {
    return this.groundedState;
  }

  update(deltaSeconds: number): void {
    const mouseDelta = this.input.consumeMouseDelta();
    this.yawRadians -= mouseDelta.x * this.mouseSensitivity;
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
    const horizontalX = (right * Math.cos(this.yawRadians) - forward * Math.sin(this.yawRadians)) * distance;
    const horizontalZ = (-right * Math.sin(this.yawRadians) - forward * Math.cos(this.yawRadians)) * distance;

    if (this.collisionWorld === undefined) {
      this.position.x += horizontalX;
      this.position.z += horizontalZ;
      return;
    }

    this.groundedState = resolveMovement({
      position: this.position,
      velocity: this.velocityState,
      bounds: this.playerBounds,
      world: this.collisionWorld,
      deltaSeconds: 0,
      gravity: this.gravity,
      terminalVelocity: this.terminalVelocity,
    }).grounded;
    const jumpPressed = this.input.isPressed('Space');
    const jumped = this.groundedState && jumpPressed && !this.jumpWasPressed;
    if (jumped) this.velocityState.y = this.jumpVelocity;
    this.jumpWasPressed = jumpPressed;

    this.velocityState.x = deltaSeconds === 0 ? 0 : horizontalX / deltaSeconds;
    this.velocityState.z = deltaSeconds === 0 ? 0 : horizontalZ / deltaSeconds;
    const resolution = resolveMovement({
      position: this.position,
      velocity: this.velocityState,
      bounds: this.playerBounds,
      world: this.collisionWorld,
      deltaSeconds,
      gravity: this.gravity,
      terminalVelocity: this.terminalVelocity,
    });
    this.position.set(resolution.position.x, resolution.position.y, resolution.position.z);
    this.velocityState.set(resolution.velocity.x, resolution.velocity.y, resolution.velocity.z);
    this.groundedState = jumped ? false : resolution.grounded;
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

function validPlayerBoundsOrDefault(bounds: PlayerBounds | undefined): PlayerBounds {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
