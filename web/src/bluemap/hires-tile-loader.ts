import {
  Mesh,
  ShaderMaterial,
  Material,
} from 'three';
import { parsePrbm, prbmToBufferGeometry } from './prbm-parser';

export interface HiresTileSettings {
  tileSize: { x: number; z: number };
  scale: { x: number; z: number };
  translate: { x: number; z: number };
}

const HIRES_VERTEX_SHADER = `
varying vec3 vColor;
varying float vAo;
attribute float ao;

void main() {
  vColor = color;
  vAo = ao;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HIRES_FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAo;

void main() {
  gl_FragColor = vec4(vColor * vAo, 1.0);
}
`;

export class HiresTileLoader {
  private readonly tileUrlBuilder: (tileX: number, tileZ: number) => string;
  private readonly settings: HiresTileSettings;
  private readonly materials: Material[];
  private fallbackMaterial: Material | null = null;

  constructor(
    tileUrlBuilder: (tileX: number, tileZ: number) => string,
    settings: HiresTileSettings,
    materials: Material[],
  ) {
    this.tileUrlBuilder = tileUrlBuilder;
    this.settings = settings;
    this.materials = materials;
  }

  private getMaterial(): Material {
    if (this.materials.length > 0) return this.materials[0]!;
    if (this.fallbackMaterial === null) {
      this.fallbackMaterial = new ShaderMaterial({
        vertexShader: HIRES_VERTEX_SHADER,
        fragmentShader: HIRES_FRAGMENT_SHADER,
        vertexColors: true,
      });
    }
    return this.fallbackMaterial;
  }

  async load(tileX: number, tileZ: number, cancelCheck?: () => boolean): Promise<Mesh | null> {
    const url = this.tileUrlBuilder(tileX, tileZ);
    const response = await fetch(url);
    if (!response.ok) return null;

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

    const mesh = new Mesh(geometry, this.getMaterial()!);
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
