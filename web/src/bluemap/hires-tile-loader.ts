import {
  Mesh,
  BufferGeometry,
  ShaderMaterial,
  Material,
  Float32BufferAttribute,
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
  private readonly sharedGeometry = new Map<string, BufferGeometry>();

  constructor(
    tileUrlBuilder: (tileX: number, tileZ: number) => string,
    settings: HiresTileSettings,
    materials: Material[],
  ) {
    this.tileUrlBuilder = tileUrlBuilder;
    this.settings = settings;
    this.materials = materials;
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
    if (geometry.attributes.position.count === 0) {
      geometry.dispose();
      return null;
    }

    geometry.computeBoundingSphere();

    const material = this.materials.length > 0
      ? this.materials[0]
      : new ShaderMaterial({
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
