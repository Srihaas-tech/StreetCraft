import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mountStreetCraftApp } from '../src/app';

const originalRequestPointerLock = HTMLElement.prototype.requestPointerLock;

beforeEach(() => {
  HTMLElement.prototype.requestPointerLock = vi.fn() as unknown as typeof HTMLElement.prototype.requestPointerLock;
});

afterEach(() => {
  HTMLElement.prototype.requestPointerLock = originalRequestPointerLock;
  document.querySelectorAll('.crosshair, .streetcraft-status, .streetcraft-play-overlay, .streetcraft-block-info, .streetcraft-error, .auth-overlay, .inventory-overlay').forEach((el) => el.remove());
});

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class FakeRenderer {
    domElement = document.createElement('canvas');
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
  }

  return {
    ...actual,
    WebGLRenderer: FakeRenderer,
  };
});

describe('StreetCraft web bootstrap', () => {
  it('creates a WebGL canvas and UI elements', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = mountStreetCraftApp(container);

    expect(container.querySelector('canvas')).not.toBeNull();
    expect(document.querySelector('.crosshair')).not.toBeNull();
    expect(document.querySelector('.streetcraft-status')).not.toBeNull();
    expect(document.querySelector('.streetcraft-play-overlay')).not.toBeNull();

    app.dispose();
    container.remove();
  });

  it('exposes a dispose method that cleans up DOM', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = mountStreetCraftApp(container);
    app.dispose();

    expect(document.querySelector('.crosshair')).toBeNull();
    expect(document.querySelector('.streetcraft-status')).toBeNull();
    expect(document.querySelector('.streetcraft-play-overlay')).toBeNull();

    container.remove();
  });
});
