import {
  Mesh,
  ShaderMaterial,
  Material,
  Texture,
  NearestFilter,
  ClampToEdgeWrapping,
} from 'three';
import { parsePrbm, prbmToBufferGeometry } from './prbm-parser';

export interface HiresTileSettings {
  tileSize: { x: number; z: number };
  scale: { x: number; z: number };
  translate: { x: number; z: number };
}

const HIRES_VERTEX_SHADER = `
attribute float ao;
varying vec3 vColor;
varying vec2 vUv;
varying float vAo;

void main() {
  vColor = color;
  vUv = uv;
  vAo = ao;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HIRES_FRAGMENT_SHADER = `
uniform sampler2D textureImage;
varying vec3 vColor;
varying vec2 vUv;
varying float vAo;

void main() {
  vec4 texColor = texture2D(textureImage, vUv);
  if (texColor.a < 0.01) discard;
  gl_FragColor = vec4(texColor.rgb * vColor * vAo, texColor.a);
}
`;

export function createHiresMaterials(textures: Array<{ texture: string }>): Material[] {
  return textures.map((entry) => {
    const image = new Image();
    image.src = entry.texture;

    const texture = new Texture();
    texture.image = image;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.flipY = false;

    image.addEventListener('load', () => {
      texture.needsUpdate = true;
    });

    return new ShaderMaterial({
      uniforms: {
        textureImage: { value: texture },
      },
      vertexShader: HIRES_VERTEX_SHADER,
      fragmentShader: HIRES_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
  });
}

export class HiresTileLoader {
  private readonly tileUrlBuilder: (tileX: number, tileZ: number) => string;
  private readonly settings: HiresTileSettings;
  private readonly materials: Material[];

  constructor(
    tileUrlBuilder: (tileX: number, tileZ: number) => string,
    settings: HiresTileSettings,
    materials: Material[],
  ) {
    this.tileUrlBuilder = tileUrlBuilder;
    this.settings = settings;
    this.materials = materials;
  }

  getMaterials(): Material[] {
    return this.materials;
  }

  async load(tileX: number, tileZ: number, cancelCheck?: () => boolean): Promise<Mesh | null> {
    const url = this.tileUrlBuilder(tileX, tileZ);
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[StreetCraft] Tile fetch failed: ${url} (HTTP ${response.status})`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (cancelCheck?.()) return null;

    const data = parsePrbm(arrayBuffer);
    if (data.attributes['position'] === undefined) return null;

    const geometry = prbmToBufferGeometry(data);
    const posAttr = geometry.attributes['position'];
    if (posAttr === undefined || posAttr.count === 0) {
      geometry.dispose();
      return null;
    }

    geometry.computeBoundingSphere();

    const material = this.materials.length > 0
      ? this.materials
      : new ShaderMaterial({
          uniforms: {},
          vertexShader: HIRES_VERTEX_SHADER,
          fragmentShader: HIRES_FRAGMENT_SHADER,
          vertexColors: true,
        });

    const mesh = new Mesh(geometry, material);
    mesh.position.set(
      tileX * this.settings.tileSize.x + this.settings.translate.x,
      0,
      tileZ * this.settings.tileSize.z + this.settings.translate.z,
    );
    mesh.scale.set(this.settings.scale.x, 1, this.settings.scale.z);
    mesh.updateMatrixWorld(true);

    return mesh;
  }
}
