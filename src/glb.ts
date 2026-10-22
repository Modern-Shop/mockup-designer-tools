import { EditorError } from './core.js';
import { computeNormals, type MeshPart, type ModelGeometry, type ModelImage } from './meshes.js';

/**
 * Reads the static-mesh subset of binary glTF 2.0 (GLB): triangle primitives with POSITION, optional NORMAL/TEXCOORD_0,
 * node transforms, base color factors and embedded PNG/JPEG base-color textures. The file is untrusted input:
 * every offset is bounds-checked, totals are capped, and external resources are never fetched.
 */
const MAX_VERTICES = 1_000_000, MAX_INDICES = 3_000_000, MAX_DEPTH = 64;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

type Json = Record<string, unknown>;
const invalid = (detail: string) => new EditorError('model-invalid', `This GLB file could not be read: ${detail}`);
const unsupported = (detail: string) => new EditorError('model-unsupported', `This GLB file uses an unsupported feature: ${detail}`);
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): Json[] => Array.isArray(value) ? value.filter(isObject) : [];
const index = (value: unknown, length: number, what: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) throw invalid(`missing ${what}`);
  return value as number;
};

type Matrix = number[];
const identity = (): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
function nodeMatrix(node: Json): Matrix {
  const numbers = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(n => typeof n === 'number' && Number.isFinite(n)) ? value as number[] : null;
  const matrix = numbers(node.matrix, 16);
  if (matrix) return matrix;
  const [tx, ty, tz] = numbers(node.translation, 3) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = numbers(node.rotation, 4) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = numbers(node.scale, 3) ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function parseGlb(buffer: ArrayBuffer): Pick<ModelGeometry, 'parts' | 'images'> {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw invalid('it is not a binary glTF (GLB) file');
  if (view.getUint32(4, true) !== 2) throw unsupported('only glTF 2.0 is supported');
  const total = view.getUint32(8, true);
  if (total > buffer.byteLength) throw invalid('the file is truncated');
  let offset = 12, json: Json | null = null, bin: Uint8Array | null = null;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > total) throw invalid('a chunk is truncated');
    const chunk = new Uint8Array(buffer, offset + 8, length);
    if (type === 0x4e4f534a && !json) {
      try { json = JSON.parse(new TextDecoder().decode(chunk)); } catch { throw invalid('its JSON is malformed'); }
    } else if (type === 0x004e4942 && !bin) bin = chunk;
    offset += 8 + length;
  }
  if (!isObject(json)) throw invalid('it has no JSON chunk');
  const gltf = json;
  const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired : [];
  if (required.length) throw unsupported(`required extensions (${required.slice(0, 3).join(', ')})`);
  const buffers = list(gltf.buffers), bufferViews = list(gltf.bufferViews), accessors = list(gltf.accessors);
  if (buffers.some(b => b.uri !== undefined)) throw unsupported('external or embedded-URI buffers; export a self-contained GLB');
  const bufferView = (i: number) => {
    const bv = bufferViews[index(i, bufferViews.length, 'buffer view')];
    index(bv.buffer ?? 0, Math.max(1, buffers.length), 'buffer');
    if (!bin) throw invalid('it has no binary chunk');
    const start = Number(bv.byteOffset ?? 0), length = Number(bv.byteLength);
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > bin.byteLength) throw invalid('a buffer view is out of range');
    return { bytes: bin.subarray(start, start + length), stride: Number(bv.byteStride ?? 0) };
  };
  const readAccessor = (i: number, expected: string[]): { data: Float32Array | Uint32Array; size: number; count: number } => {
    const accessor = accessors[index(i, accessors.length, 'accessor')];
    if (accessor.sparse) throw unsupported('sparse accessors');
    const size = COMPONENTS[String(accessor.type)], componentType = Number(accessor.componentType), bytes = BYTES[componentType], count = Number(accessor.count);
    if (!size || !bytes || !expected.includes(String(accessor.type)) || !Number.isInteger(count) || count < 0) throw invalid('an accessor has an unexpected layout');
    const { bytes: source, stride: declared } = bufferView(Number(accessor.bufferView));
    const stride = declared || size * bytes, start = Number(accessor.byteOffset ?? 0);
    if (!Number.isInteger(start) || start < 0 || (count > 0 && start + (count - 1) * stride + size * bytes > source.byteLength)) throw invalid('an accessor is out of range');
    const reader = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const normalized = accessor.normalized === true;
    const out = componentType === 5126 || normalized || size > 1 ? new Float32Array(count * size) : new Uint32Array(count * size);
    for (let n = 0; n < count; n++) for (let c = 0; c < size; c++) {
      const at = start + n * stride + c * bytes;
      let value: number;
      switch (componentType) {
        case 5126: value = reader.getFloat32(at, true); break;
        case 5125: value = reader.getUint32(at, true); break;
        case 5123: value = reader.getUint16(at, true); if (normalized) value /= 65535; break;
        case 5121: value = reader.getUint8(at); if (normalized) value /= 255; break;
        case 5122: value = reader.getInt16(at, true); if (normalized) value = Math.max(value / 32767, -1); break;
        default: value = reader.getInt8(at); if (normalized) value = Math.max(value / 127, -1);
      }
      if (!Number.isFinite(value)) throw invalid('it contains non-numeric vertex data');
      out[n * size + c] = value;
    }
    return { data: out, size, count };
  };

  const images: ModelImage[] = [];
  const imageIndex = new Map<number, number>();
  const textures = list(gltf.textures), imageDefs = list(gltf.images), materials = list(gltf.materials);
  const textureImage = (textureInfo: unknown): number | undefined => {
    if (!isObject(textureInfo)) return undefined;
    if (textureInfo.texCoord !== undefined && textureInfo.texCoord !== 0) return undefined;
    const texture = textures[Number(textureInfo.index)];
    const source = texture ? Number(texture.source) : NaN;
    const image = imageDefs[source];
    if (!image) return undefined;
    if (image.uri !== undefined) throw unsupported('external texture images; export a self-contained GLB');
    if (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') throw unsupported('texture formats other than PNG or JPEG');
    if (!imageIndex.has(source)) { imageIndex.set(source, images.length); images.push({ mime: image.mimeType, bytes: bufferView(Number(image.bufferView)).bytes.slice() }); }
    return imageIndex.get(source);
  };

  const meshes = list(gltf.meshes), nodes = list(gltf.nodes), scenes = list(gltf.scenes);
  const groups = new Map<string, { positions: number[]; normals: number[]; uvs: number[]; indices: number[]; material: Json | undefined; hasNormals: boolean }>();
  let vertices = 0, indexCount = 0;
  const addPrimitive = (primitive: Json, matrix: Matrix) => {
    if ((primitive.mode ?? 4) !== 4) return;
    const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
    if (attributes.POSITION === undefined) return;
    const position = readAccessor(Number(attributes.POSITION), ['VEC3']);
    const normal = attributes.NORMAL !== undefined ? readAccessor(Number(attributes.NORMAL), ['VEC3']) : null;
    const uv = attributes.TEXCOORD_0 !== undefined ? readAccessor(Number(attributes.TEXCOORD_0), ['VEC2']) : null;
    const triangles = primitive.indices !== undefined ? readAccessor(Number(primitive.indices), ['SCALAR']).data : Uint32Array.from({ length: position.count }, (_, k) => k);
    vertices += position.count; indexCount += triangles.length;
    if (vertices > MAX_VERTICES || indexCount > MAX_INDICES) throw unsupported('more than one million vertices');
    if (triangles.some(k => k >= position.count) || triangles.length % 3) throw invalid('a primitive has invalid indices');
    const materialIndex = Number.isInteger(primitive.material) ? primitive.material as number : -1;
    const material = materials[materialIndex];
    const name = typeof material?.name === 'string' && material.name.trim() ? material.name.trim().slice(0, 120) : materialIndex >= 0 ? `material-${materialIndex}` : 'default';
    const group = groups.get(name) ?? { positions: [], normals: [], uvs: [], indices: [], material, hasNormals: true };
    groups.set(name, group);
    const base = group.positions.length / 3;
    // Normals use the inverse transpose; for uniform or rotation-only transforms the upper 3×3 is enough after renormalizing.
    for (let k = 0; k < position.count; k++) {
      const x = position.data[k * 3], y = position.data[k * 3 + 1], z = position.data[k * 3 + 2];
      group.positions.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
      if (normal) {
        const nx = normal.data[k * 3], ny = normal.data[k * 3 + 1], nz = normal.data[k * 3 + 2];
        const tx = matrix[0] * nx + matrix[4] * ny + matrix[8] * nz, ty = matrix[1] * nx + matrix[5] * ny + matrix[9] * nz, tz = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
        const length = Math.hypot(tx, ty, tz) || 1;
        group.normals.push(tx / length, ty / length, tz / length);
      } else group.hasNormals = false;
      group.uvs.push(uv ? uv.data[k * 2] : 0, uv ? uv.data[k * 2 + 1] : 0);
    }
    for (const k of triangles) group.indices.push(base + k);
  };
  const visit = (nodeId: number, parent: Matrix, depth: number) => {
    if (depth > MAX_DEPTH) throw unsupported('a node hierarchy deeper than 64 levels');
    const node = nodes[index(nodeId, nodes.length, 'node')];
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) for (const primitive of list(meshes[index(node.mesh, meshes.length, 'mesh')].primitives)) addPrimitive(primitive, matrix);
    if (Array.isArray(node.children)) for (const child of node.children) visit(Number(child), matrix, depth + 1);
  };
  const scene = scenes[Number.isInteger(gltf.scene) ? gltf.scene as number : 0];
  if (scene && Array.isArray(scene.nodes)) for (const nodeId of scene.nodes) visit(Number(nodeId), identity(), 0);
  else for (const mesh of meshes) for (const primitive of list(mesh.primitives)) addPrimitive(primitive, identity());
  if (!groups.size) throw invalid('it contains no triangle meshes');

  const parts: MeshPart[] = [];
  for (const [name, group] of groups) {
    const pbr = isObject(group.material?.pbrMetallicRoughness) ? group.material!.pbrMetallicRoughness as Json : {};
    const factor = Array.isArray(pbr.baseColorFactor) && pbr.baseColorFactor.length === 4 ? pbr.baseColorFactor.map(Number) : [1, 1, 1, 1];
    const positions = new Float32Array(group.positions), indices = new Uint32Array(group.indices), uvs = new Float32Array(group.uvs);
    // glTF colors are linear; the renderer works from sRGB part colors.
    const color = factor.slice(0, 3).map(c => Math.max(0, Math.min(1, c)) ** (1 / 2.2)) as [number, number, number];
    parts.push({
      name, printable: true, positions, indices,
      normals: group.hasNormals && group.normals.length === group.positions.length ? new Float32Array(group.normals) : computeNormals(positions, indices),
      partUV: uvs, baseUV: uvs, color, image: textureImage(pbr.baseColorTexture),
      finish: 'standard', roughness: Number.isFinite(Number(pbr.roughnessFactor)) ? Math.max(0, Math.min(1, Number(pbr.roughnessFactor))) : 1,
    });
  }
  return { parts, images };
}
