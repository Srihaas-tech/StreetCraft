export type MovementKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';

export interface PointerLockEventTarget extends EventTarget {
  readonly pointerLockElement: Element | null;
}

export type PointerLockElement = Omit<HTMLElement, 'requestPointerLock'> & {
  requestPointerLock(): void | Promise<void>;
};

export interface MouseDelta {
  x: number;
  y: number;
}

const movementKeys = new Set<MovementKey>(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class MovementInput {
  private readonly pressedKeys = new Set<MovementKey>();
  private mouseX = 0;
  private mouseY = 0;

  constructor(
    private readonly element: PointerLockElement,
    private readonly eventTarget: PointerLockEventTarget,
  ) {
    this.eventTarget.addEventListener('keydown', this.handleKeyDown);
    this.eventTarget.addEventListener('keyup', this.handleKeyUp);
    this.eventTarget.addEventListener('mousemove', this.handleMouseMove);
  }

  isPressed(key: MovementKey): boolean {
    return this.pressedKeys.has(key);
  }

  consumeMouseDelta(): MouseDelta {
    const delta = { x: this.mouseX, y: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return delta;
  }

  requestPointerLock(): ReturnType<PointerLockElement['requestPointerLock']> {
    return this.element.requestPointerLock();
  }

  dispose(): void {
    this.eventTarget.removeEventListener('keydown', this.handleKeyDown);
    this.eventTarget.removeEventListener('keyup', this.handleKeyUp);
    this.eventTarget.removeEventListener('mousemove', this.handleMouseMove);
    this.pressedKeys.clear();
    this.consumeMouseDelta();
  }

  private readonly handleKeyDown = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (isMovementKey(code)) {
      this.pressedKeys.add(code);
    }
  };

  private readonly handleKeyUp = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (isMovementKey(code)) {
      this.pressedKeys.delete(code);
    }
  };

  private readonly handleMouseMove = (event: Event): void => {
    if (this.eventTarget.pointerLockElement !== this.element) {
      return;
    }

    const mouseEvent = event as MouseEvent;
    if (Number.isFinite(mouseEvent.movementX)) {
      this.mouseX += mouseEvent.movementX;
    }
    if (Number.isFinite(mouseEvent.movementY)) {
      this.mouseY += mouseEvent.movementY;
    }
  };
}

function isMovementKey(code: string): code is MovementKey {
  return movementKeys.has(code as MovementKey);
}
