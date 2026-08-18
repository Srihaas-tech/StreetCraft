import { BufferGeometry, BufferAttribute } from 'three';

type TypedArrayCtor = typeof Float32Array | typeof Int8Array | typeof Int16Array | typeof Int32Array | typeof Uint8Array | typeof Uint16Array | typeof Uint32Array;

const ENCODING_TYPES: (TypedArrayCtor | null)[] = [
  null,
  Float32Array,
  null,
  Int8Array,
  Int16Array,
  null,
  Int32Array,
  Uint8Array,
  Uint16Array,
  null,
  Uint32Array,
];


let bigEndian: boolean | null = null;

function isBigEndian(): boolean {
  if (bigEndian === null) {
    const buf = new ArrayBuffer(2);
    new Uint8Array(buf)[0] = 0xAA;
    new Uint8Array(buf)[1] = 0xBB;
    bigEndian = new Uint16Array(buf)[0] === 0xAABB;
  }
  return bigEndian;
}

function read4ByteInt(array: Uint8Array, pos: number): number {
  return array[pos]! | (array[pos + 1]! << 8) | (array[pos + 2]! << 16) | (array[pos + 3]! << 24);
}

function copyFromBuffer(
  source: ArrayBuffer,
  Type: TypedArrayCtor,
  position: number,
  length: number,
  fromBigEndian: boolean,
): TypedArray {
  if (fromBigEndian === isBigEndian() || Type.BYTES_PER_ELEMENT === 1) {
    return new Type(source, position, length);
  }

  const view = new DataView(source, position, length * Type.BYTES_PER_ELEMENT);
  const littleEndian = !fromBigEndian;
  const result = new Type(length);

  for (let i = 0; i < length; i++) {
    const offset = i * Type.BYTES_PER_ELEMENT;
    let value: number;
    switch (Type) {
      case Uint16Array: value = view.getUint16(offset, littleEndian); break;
      case Uint32Array: value = view.getUint32(offset, littleEndian); break;
      case Int16Array: value = view.getInt16(offset, littleEndian); break;
      case Int32Array: value = view.getInt32(offset, littleEndian); break;
      case Float32Array: value = view.getFloat32(offset, littleEndian); break;
      default: value = new Type(source, position + offset, 1)[0] ?? 0;
    }
    (result as unknown as number[])[i] = value;
  }

  return result;
}

type TypedArray = Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;

interface ParsedAttribute {
  type: number;
  cardinality: number;
  values: TypedArray;
  normalized: boolean;
}

export interface PrbmData {
  version: number;
  attributes: Record<string, ParsedAttribute>;
  indices: Uint16Array | Uint32Array | null;
  groups: Array<{ materialIndex: number; start: number; count: number }>;
}

export function parsePrbm(buffer: ArrayBuffer, offset = 0): PrbmData {
  const array = new Uint8Array(buffer, offset);
  const version = array[0]!;
  const flags = array[1]!;
  const indexedGeometry = (flags >> 7 & 0x01) === 1;
  const indicesType = flags >> 6 & 0x01;
  const fromBigEndian = (flags >> 5 & 0x01) === 1;
  const attributesNumber = flags & 0x1F;

  let valuesNumber: number;
  let indicesNumber: number;

  if (fromBigEndian) {
    valuesNumber = (array[2]! << 16) + (array[3]! << 8) + array[4]!;
    indicesNumber = (array[5]! << 16) + (array[6]! << 8) + array[7]!;
  } else {
    valuesNumber = array[2]! + (array[3]! << 8) + (array[4]! << 16);
    indicesNumber = array[5]! + (array[6]! << 8) + (array[7]! << 16);
  }

  if (version === 0) throw new Error('PRBM: invalid format version 0');
  if (version !== 1) throw new Error(`PRBM: unsupported format version ${version}`);
  if (!indexedGeometry && indicesType !== 0) throw new Error('PRBM: indices type must be 0 for non-indexed geometry');
  if (!indexedGeometry && indicesNumber !== 0) throw new Error('PRBM: indices count must be 0 for non-indexed geometry');

  let pos = 8;
  const attributes: Record<string, ParsedAttribute> = {};

  for (let i = 0; i < attributesNumber; i++) {
    let attributeName = '';
    while (pos < array.length) {
      const char = array[pos]!;
      pos++;
      if (char === 0) break;
      attributeName += String.fromCharCode(char);
    }

    const attrFlags = array[pos]!;
    const normalized = (attrFlags >> 6 & 0x01) === 1;
    const cardinality = (attrFlags >> 4 & 0x03) + 1;
    const encodingType = attrFlags & 0x0F;
    const ArrayType = ENCODING_TYPES[encodingType];
    pos++;

    pos = Math.ceil(pos / 4) * 4;

    const values = copyFromBuffer(buffer, ArrayType!, pos + offset, cardinality * valuesNumber, fromBigEndian);
    pos += ArrayType!.BYTES_PER_ELEMENT * cardinality * valuesNumber;

    attributes[attributeName] = { type: 0, cardinality, values, normalized };
  }

  let indices: Uint16Array | Uint32Array | null = null;
  if (indexedGeometry) {
    pos = Math.ceil(pos / 4) * 4;
    const IndexType = indicesType === 1 ? Uint32Array : Uint16Array;
    indices = copyFromBuffer(buffer, IndexType, pos + offset, indicesNumber, fromBigEndian) as Uint16Array | Uint32Array;
  }

  const groups: Array<{ materialIndex: number; start: number; count: number }> = [];
  pos = Math.ceil(pos / 4) * 4;
  while (pos < array.length) {
    const next = read4ByteInt(array, pos);
    if (next === -1) break;
    groups.push({
      materialIndex: next,
      start: read4ByteInt(array, pos + 4),
      count: read4ByteInt(array, pos + 8),
    });
    pos += 12;
  }

  return { version, attributes, indices, groups };
}

export function prbmToBufferGeometry(data: PrbmData): BufferGeometry {
  const geometry = new BufferGeometry();

  for (const [name, attr] of Object.entries(data.attributes)) {
    const bufferAttr = new BufferAttribute(attr.values, attr.cardinality, attr.normalized);
    geometry.setAttribute(name, bufferAttr);
  }

  if (data.indices !== null) {
    geometry.setIndex(new BufferAttribute(data.indices, 1));
  }

  geometry.groups = data.groups;

  return geometry;
}
