import {
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Vector3,
  Clock,
  Object3D,
  Color,
} from 'three';
import { streetCraftConfig } from './config';
import { CameraController } from './movement/camera-controller';
import { MovementInput, type PointerLockElement, type PointerLockEventTarget } from './movement/input';
import { raycastBlock } from './inspection/raycast';
import { createBlockInfo, renderBlockInfoPanel } from './inspection/block-info';
import { createContainerClient, ContainerRequestError } from './inspection/container-client';
import { createAuthClient, AuthRequestError } from './auth/auth-client';
import { createSessionStore } from './auth/session-store';
import { InventoryScreen } from './inventory/inventory-screen';
import { ItemAtlas } from './inventory/item-atlas';
import { HiresTileLoader, createHiresMaterials } from './bluemap/hires-tile-loader';
import { TileManager } from './bluemap/tile-manager';

const MAX_RAYCAST_DISTANCE = 8;

export interface StreetCraftApp {
  dispose(): void;
}

export function mountStreetCraftApp(container: HTMLElement): StreetCraftApp {
  const scene = new Scene();

  const camera = new PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 1000);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);

  const crosshair = document.createElement('div');
  crosshair.className = 'crosshair';
  document.body.appendChild(crosshair);

  const statusBar = document.createElement('div');
  statusBar.className = 'streetcraft-status';
  statusBar.innerHTML =
    '<span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span> Move &nbsp; ' +
    '<span class="key">Space</span> Jump &nbsp; ' +
    '<span class="key">Click</span> Block info';
  document.body.appendChild(statusBar);

  const playOverlay = document.createElement('div');
  playOverlay.className = 'streetcraft-play-overlay';
  playOverlay.innerHTML = '<div class="play-text">Click to Play</div><div class="play-sub">WASD to move &middot; Space to jump &middot; Mouse to look</div>';
  document.body.appendChild(playOverlay);

  const debugHud = document.createElement('div');
  debugHud.className = 'streetcraft-debug-hud';
  document.body.appendChild(debugHud);

  const blockInfoContainer = document.createElement('div');
  document.body.appendChild(blockInfoContainer);

  const sessionStore = createSessionStore();
  const authClient = createAuthClient({ store: sessionStore });
  const containerClient = createContainerClient({ sessionStore });
  const inventoryScreen = new InventoryScreen({ document, atlas: new ItemAtlas() });

  const terrainObjects: Object3D[] = [];
  const input = new MovementInput(
    renderer.domElement as unknown as PointerLockElement,
    document as unknown as PointerLockEventTarget,
  );
  let activeTileManager: TileManager | null = null;
  const collisionWorld = {
    isSolidBlock: (x: number, y: number, z: number): boolean =>
      activeTileManager !== null && activeTileManager.isSolidBlock(x, y, z),
  };
  const cameraController = new CameraController(input, { camera, collisionWorld });
  const clock = new Clock(false);

  let pointerLocked = false;
  let selectedBlockX = -1;
  let selectedBlockY = -1;
  let selectedBlockZ = -1;
  let selectedBlockIsContainer = false;

  renderer.domElement.addEventListener('click', () => {
    if (!pointerLocked) {
      renderer.domElement.requestPointerLock();
    }
  });

  playOverlay.addEventListener('click', () => {
    if (!pointerLocked) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      clock.start();
      playOverlay.style.display = 'none';
    } else {
      clock.stop();
      playOverlay.style.display = '';
    }
  });

  renderer.domElement.addEventListener('dblclick', (e) => {
    if (pointerLocked) {
      document.exitPointerLock();
      e.preventDefault();
    }
  });

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (!pointerLocked || e.button !== 0) return;

    const hit = raycastBlock({
      origin: camera.position.clone(),
      direction: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
      maximumDistance: MAX_RAYCAST_DISTANCE,
      targetObjects: terrainObjects,
    });

    if (hit === undefined) return;

    const blockInfo = createBlockInfo('unknown', { x: hit.x, y: hit.y, z: hit.z });
    selectedBlockX = hit.x;
    selectedBlockY = hit.y;
    selectedBlockZ = hit.z;
    selectedBlockIsContainer = false;

    fetchBlockInfo(hit.x, hit.y, hit.z, blockInfo);
  });

  async function fetchBlockInfo(x: number, y: number, z: number, fallback: ReturnType<typeof createBlockInfo>) {
    try {
      const response = await fetch(
        `/api/block?dimension=minecraft:overworld&x=${String(x)}&y=${String(y)}&z=${String(z)}`,
        { credentials: 'same-origin' },
      );
      if (response.ok) {
        const data = await response.json() as { blockId: string; supportedContainer: boolean };
        const info = createBlockInfo(data.blockId, { x, y, z });
        selectedBlockIsContainer = data.supportedContainer;
        renderBlockInfoPanel(blockInfoContainer, info);
        addContainerHintIfNeeded(info, x, y, z);
      } else {
        renderBlockInfoPanel(blockInfoContainer, fallback);
      }
    } catch {
      renderBlockInfoPanel(blockInfoContainer, fallback);
    }
  }

  function addContainerHintIfNeeded(info: { isContainer: boolean; id: string }, x: number, y: number, z: number) {
    const existing = blockInfoContainer.querySelector('.container-hint');
    if (existing) existing.remove();

    if (info.isContainer) {
      const hint = document.createElement('p');
      hint.className = 'container-hint';
      hint.textContent = sessionStore.get().authenticated
        ? 'Click to view contents'
        : 'Right-click to inspect (login required)';
      hint.setAttribute('role', 'button');
      hint.setAttribute('tabindex', '0');
      hint.addEventListener('click', () => openContainer(x, y, z));
      hint.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openContainer(x, y, z);
        }
      });
      blockInfoContainer.appendChild(hint);
    }
  }

  renderer.domElement.addEventListener('contextmenu', (e) => {
    if (!pointerLocked || !selectedBlockIsContainer) return;
    e.preventDefault();
    openContainer(selectedBlockX, selectedBlockY, selectedBlockZ);
  });

  async function openContainer(x: number, y: number, z: number) {
    if (!sessionStore.get().authenticated) {
      const authed = await showAuthPrompt();
      if (!authed) return;
    }

    try {
      const data = await containerClient.fetchContainer('minecraft:overworld', x, y, z);
      inventoryScreen.open(data);
    } catch (error) {
      if (error instanceof ContainerRequestError && error.code === 'authentication_required') {
        sessionStore.clear();
        const authed = await showAuthPrompt();
        if (!authed) return;
        try {
          const retryData = await containerClient.fetchContainer('minecraft:overworld', x, y, z);
          inventoryScreen.open(retryData);
        } catch (retryError) {
          showErrorMessage(formatContainerError(retryError));
        }
      } else {
        showErrorMessage(formatContainerError(error));
      }
    }
  }

  function showAuthPrompt(): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const panel = document.createElement('div');
      panel.className = 'auth-panel';

      const title = document.createElement('h2');
      title.textContent = 'Container Access';
      panel.appendChild(title);

      const label = document.createElement('label');
      label.textContent = 'Password';
      label.setAttribute('for', 'streetcraft-password');
      panel.appendChild(label);

      const passwordInput = document.createElement('input');
      passwordInput.id = 'streetcraft-password';
      passwordInput.type = 'password';
      passwordInput.autocomplete = 'off';
      passwordInput.placeholder = 'Enter password';
      panel.appendChild(passwordInput);

      const errorDiv = document.createElement('div');
      errorDiv.className = 'auth-error';
      panel.appendChild(errorDiv);

      const buttons = document.createElement('div');
      buttons.className = 'auth-buttons';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });

      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn-primary';
      loginBtn.textContent = 'Login';

      buttons.appendChild(cancelBtn);
      buttons.appendChild(loginBtn);
      panel.appendChild(buttons);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      passwordInput.focus();

      const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', handleKeydown);
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleKeydown);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          document.removeEventListener('keydown', handleKeydown);
          resolve(false);
        }
      });

      const doLogin = async () => {
        const password = passwordInput.value;
        if (password.length === 0) {
          errorDiv.textContent = 'Please enter a password';
          return;
        }

        try {
          await authClient.login(password);
          overlay.remove();
          document.removeEventListener('keydown', handleKeydown);
          resolve(true);
        } catch (error) {
          if (error instanceof AuthRequestError) {
            switch (error.code) {
              case 'invalid-credentials':
                errorDiv.textContent = 'Incorrect password';
                break;
              case 'rate-limited':
                errorDiv.textContent = 'Too many attempts. Please wait.';
                loginBtn.disabled = true;
                break;
              default:
                errorDiv.textContent = 'Connection failed. Try again.';
            }
          } else {
            errorDiv.textContent = 'Connection failed. Try again.';
          }
        }
      };

      loginBtn.addEventListener('click', doLogin);
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void doLogin();
        }
      });
    });
  }

  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  function showErrorMessage(message: string) {
    let errorEl = document.querySelector<HTMLElement>('.streetcraft-error');
    if (errorEl === null) {
      errorEl = document.createElement('div');
      errorEl.className = 'streetcraft-error';
      document.body.appendChild(errorEl);
    }
    errorEl.textContent = message;

    if (errorTimeout !== null) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => {
      errorEl?.remove();
      errorTimeout = null;
    }, 5000);
  }

  function formatContainerError(error: unknown): string {
    if (error instanceof ContainerRequestError) {
      switch (error.code) {
        case 'container_not_found':
          return 'Container not found at these coordinates';
        case 'service_unavailable':
          return 'Fabric API is unavailable';
        case 'authentication_required':
          return 'Session expired. Please login again.';
        case 'upstream_unavailable':
          return 'Container service is unavailable';
        default:
          return 'Failed to load container contents';
      }
    }
    return 'Failed to load container contents';
  }

  let animationId = requestAnimationFrame(animate);
  let spawnSnapped = false;

  let frameCount = 0;
  function animate() {
    animationId = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (activeTileManager !== null) {
      activeTileManager.update(camera.position.x, camera.position.z);
    }
    if (!spawnSnapped && activeTileManager !== null) {
      const surface = activeTileManager.getSurfaceHeight(camera.position.x, camera.position.z);
      if (surface !== undefined) {
        camera.position.y = surface + 3;
        spawnSnapped = true;
      }
    }
    cameraController.update(delta);
    renderer.render(scene, camera);

    frameCount++;
    if (frameCount % 10 === 0) {
      const bx = Math.floor(camera.position.x);
      const bz = Math.floor(camera.position.z);
      const surf = activeTileManager?.getSurfaceHeight(camera.position.x, camera.position.z);
      const aabbBot = camera.position.y - 1.62;
      const footBlock = activeTileManager?.isSolidBlock(bx, Math.floor(aabbBot), bz);
      debugHud.textContent =
        `Y=${camera.position.y.toFixed(2)} vel=${cameraController.velocity.y.toFixed(2)} ` +
        `gnd=${cameraController.grounded} ptr=${pointerLocked} ` +
        `surf=${surf} foot=${footBlock} ` +
        `tiles=${activeTileManager?.getTileCount() ?? 0} ` +
        `keys=${input.isPressed('KeyW')}${input.isPressed('KeyA')}${input.isPressed('KeyS')}${input.isPressed('KeyD')} ` +
        `dt=${delta.toFixed(4)}`;
    }
  }

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  void loadTerrain(scene, terrainObjects, camera, (tm) => { activeTileManager = tm; });

  return {
    dispose() {
      if (activeTileManager !== null) {
        activeTileManager.dispose();
        activeTileManager = null;
      }
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', onResize);
      input.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      crosshair.remove();
      statusBar.remove();
      playOverlay.remove();
      debugHud.remove();
      blockInfoContainer.remove();
      inventoryScreen.close();
      if (errorTimeout !== null) clearTimeout(errorTimeout);
      document.querySelectorAll('.streetcraft-error').forEach((el) => el.remove());
      document.querySelectorAll('.auth-overlay').forEach((el) => el.remove());
    },
  };
}

async function loadTerrain(
  scene: Scene,
  objects: Object3D[],
  camera: PerspectiveCamera,
  onTileManager: (tm: TileManager) => void,
): Promise<void> {
  try {
    const settingsResponse = await fetch(`${streetCraftConfig.blueMapOrigin}/settings.json`);
    if (!settingsResponse.ok) {
      showMapError('BlueMap settings unavailable');
      return;
    }

    const globalSettings = await settingsResponse.json() as {
      maps?: string[];
      mapDataRoot?: string;
      clientDecompression?: boolean;
    };
    const maps = globalSettings.maps ?? [];
    const mapDataRoot = globalSettings.mapDataRoot ?? 'maps';
    const clientDecompression = globalSettings.clientDecompression ?? false;

    if (maps.length === 0) {
      showMapError('No BlueMap maps found');
      return;
    }

    const mapId = maps[0]!;
    const origin = streetCraftConfig.blueMapOrigin;

    const mapSettingsUrl = `${origin}/${mapDataRoot}/${mapId}/settings.json`;
    const mapSettingsResponse = await fetch(mapSettingsUrl);
    if (!mapSettingsResponse.ok) {
      showMapError('BlueMap map settings unavailable');
      return;
    }

    const mapSettings = await mapSettingsResponse.json() as {
      name?: string;
      startPos?: number[];
      skyColor?: number[];
      voidColor?: number[];
      hires?: {
        tileSize?: number[];
        scale?: number[];
        translate?: number[];
      };
    };

    const hires = mapSettings.hires;
    const rawTileSize = Array.isArray(hires?.tileSize) ? hires!.tileSize : undefined;
    const rawScale = Array.isArray(hires?.scale) ? hires!.scale : undefined;
    const rawTranslate = Array.isArray(hires?.translate) ? hires!.translate : undefined;

    const tileSettings = {
      tileSize: {
        x: rawTileSize?.[0] ?? 32,
        z: rawTileSize?.[1] ?? 32,
      },
      scale: {
        x: rawScale?.[0] ?? 1,
        z: rawScale?.[1] ?? 1,
      },
      translate: {
        x: rawTranslate?.[0] ?? 2,
        z: rawTranslate?.[1] ?? 2,
      },
    };

    if (mapSettings.skyColor && mapSettings.skyColor.length >= 3) {
      const sc = mapSettings.skyColor;
      scene.background = new Color(sc[0] ?? 0, sc[1] ?? 0, sc[2] ?? 0);
    } else {
      scene.background = new Color(0x87CEEB);
    }

    const startPos = mapSettings.startPos;
    if (Array.isArray(startPos) && startPos.length >= 2) {
      camera.position.set(startPos[0] ?? 0, 300, startPos[1] ?? 0);
    } else {
      camera.position.set(
        tileSettings.translate.x + tileSettings.tileSize.x * 2,
        300,
        tileSettings.translate.z + tileSettings.tileSize.z * 2,
      );
    }

    const tileUrlBuilder = (tileX: number, tileZ: number): string => {
      const path = coordinatePath(tileX, tileZ);
      const ext = clientDecompression ? '.gz' : '';
      return `${origin}/${encodeURIComponent(mapDataRoot)}/${encodeURIComponent(mapId)}/tiles/0/${path}.prbm${ext}`;
    };

    let materials: import('three').Material[] = [];
    try {
      const texturesUrl = `${origin}/${encodeURIComponent(mapDataRoot)}/${encodeURIComponent(mapId)}/textures.json`;
      const texturesResponse = await fetch(texturesUrl);
      if (texturesResponse.ok) {
        const texturesData = await texturesResponse.json() as Array<{ texture: string }>;
        materials = createHiresMaterials(texturesData);
      }
    } catch {
      console.warn('[StreetCraft] Failed to load textures.json, using fallback vertex colors');
    }

    const loader = new HiresTileLoader(tileUrlBuilder, tileSettings, materials);

    const tileManager = new TileManager({
      loader,
      scene,
      terrainObjects: objects,
      settings: tileSettings,
      viewDistance: 256,
      collisionUrlBuilder: (fromX, fromZ, toX, toZ) =>
        `/api/collision?dimension=minecraft:overworld&fromX=${String(fromX)}&fromZ=${String(fromZ)}&toX=${String(toX)}&toZ=${String(toZ)}`,
    });

    onTileManager(tileManager);

    removeMapErrors();
    showMapError(`BlueMap map "${mapSettings.name ?? mapId}" loaded.`);
    setTimeout(removeMapErrors, 3000);
  } catch {
    showMapError('Cannot reach BlueMap. Terrain is unavailable.');
  }
}

function coordinatePath(x: number, z: number): string {
  const segmentPath = (axis: 'x' | 'z', coordinate: number): string => {
    const abs = Math.abs(coordinate);
    const digits = String(abs);
    const first = coordinate < 0 ? `${axis}-${digits[0]}` : `${axis}${digits[0]}`;
    return `${first}${digits.slice(1).split('').map((d) => `/${d}`).join('')}`;
  };
  return `${segmentPath('x', x)}/${segmentPath('z', z)}`;
}

function showMapError(message: string) {
  const el = document.createElement('div');
  el.className = 'streetcraft-error';
  el.textContent = message;
  document.body.appendChild(el);
}

function removeMapErrors(): void {
  document.querySelectorAll('.streetcraft-error').forEach((el) => el.remove());
}
