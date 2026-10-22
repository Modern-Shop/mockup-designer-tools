import { DEFAULT_PRESET_SIZE, PRESET_SOFTNESS } from './presets.js';
import type { Model3D, ModelBinding, PrintSurface } from './types.js';

export type Finish = 'jersey' | 'fleece' | 'knit' | 'twill' | 'canvas' | 'ceramic' | 'metal' | 'paper' | 'card' | 'standard';
/** One drawable piece of a 3D model. Positions are in model units (millimeters for presets). */
export interface MeshPart {
  /** Preset part id or glTF material name. Print bindings refer to it. */
  name: string;
  printable: boolean;
  positions: Float32Array;
  normals: Float32Array;
  /** Normalized part space (0..1, top-left origin) used to place print areas; -1 where a vertex has none. */
  partUV: Float32Array;
  /** Texture coordinates for a glTF base-color texture. */
  baseUV?: Float32Array;
  indices: Uint32Array;
  /** Base color in sRGB, 0..1. */
  color: [number, number, number];
  image?: number;
  finish: Finish;
  roughness: number;
  /** Baked ambient occlusion per vertex: [side the normal points to, opposite side]. */
  ao?: Float32Array;
  /**
   * Sewing detail per vertex, four values: rib-knit weight (0..1), the coordinate across the ribs (mm),
   * the distance across the nearest seam (mm; 1000 where there is none), and the distance along it (mm).
   * A plain seam stores −1 − along; a non-negative value means the seam is topstitched with a double row.
   */
  detail?: Float32Array;
  /** Parts in one group move together in the soft-body preview; seams between them stay closed. */
  group?: string;
  /** Keeps its own color when the product is tinted (woven labels, metal eyelets, strings). */
  ownColor?: boolean;
}
export interface ModelImage { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }
export interface ModelGeometry {
  parts: MeshPart[];
  images: ModelImage[];
  /** Physical part sizes for presets, so print areas keep their millimeter proportions. */
  partSizes: Record<string, { width: number; height: number }>;
  /** Model yaw (radians) that turns a part toward the camera. */
  facing: Record<string, number>;
  /** Default downward viewing tilt in radians, so open shapes such as a mug show their inside. */
  pitch?: number;
  /** Default soft-body looseness (0 rigid). */
  softness?: number;
  /** How firmly a rest position is held in the soft-body preview (0 free … 1 fixed), e.g. a garment's shoulders. */
  pin?: (x: number, y: number, z: number, group: string) => number;
}

export { DEFAULT_PRESET_SIZE };

type Vec3 = [number, number, number];
type RGB = [number, number, number];
interface Builder { positions: number[]; partUV: number[]; detail: number[]; indices: number[] }
const builder = (): Builder => ({ positions: [], partUV: [], detail: [], indices: [] });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const signedPow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// Deterministic value noise: the same position always gets the same wrinkle, so neighbouring parts stay sealed.
function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const corner = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  const x00 = mix(corner(0, 0, 0), corner(1, 0, 0), u), x10 = mix(corner(0, 1, 0), corner(1, 1, 0), u);
  const x01 = mix(corner(0, 0, 1), corner(1, 0, 1), u), x11 = mix(corner(0, 1, 1), corner(1, 1, 1), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 2 - 1;
}
const fbm = (x: number, y: number, z: number) => noise(x, y, z) * .6 + noise(x * 2.1 + 7, y * 2.1, z * 2.1) * .28 + noise(x * 4.3, y * 4.3 + 3, z * 4.3) * .12;

type Detail = [number, number, number, number];
const NO_DETAIL: Detail = [0, 0, 1000, -1];
type Sample = { p: Vec3; uv?: [number, number]; detail?: Detail };
/** A seam candidate: distance across it, distance along it, and whether it is topstitched. */
type SeamCandidate = [number, number, boolean];
/** Encodes the nearest of several seams into the last two detail values. */
function nearestSeam(candidates: SeamCandidate[], limit = 16): [number, number] {
  let best: SeamCandidate | null = null;
  for (const candidate of candidates) if (!best || Math.abs(candidate[0]) < Math.abs(best[0])) best = candidate;
  return best && Math.abs(best[0]) < limit ? [best[0], best[2] ? best[1] : -1 - best[1]] : [1000, -1];
}
/** A (nu+1) × (nv+1) vertex grid; with `wrapU`, the last column joins the first (no seam). */
function grid(target: Builder, nu: number, nv: number, at: (u: number, v: number) => Sample, flip = false, wrapU = false): void {
  const start = target.positions.length / 3, columns = wrapU ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < columns; i++) {
    const { p, uv, detail } = at(i / nu, j / nv);
    target.positions.push(...p); target.partUV.push(...(uv ?? [-1, -1])); target.detail.push(...(detail ?? NO_DETAIL));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = wrapU ? (i + 1) % nu : i + 1;
    const a = start + j * columns + i, b = start + j * columns + i1, c = a + columns, d = start + (j + 1) * columns + i1;
    if (flip) target.indices.push(a, b, c, b, d, c); else target.indices.push(a, c, b, b, c, d);
  }
}
/** A tube along a path with parallel-transport frames; `closed` joins the path's ends into a ring. With `rib`, knit ribs run across the path. */
function tube(target: Builder, path: (t: number) => Vec3, radius: (t: number) => number, segments: number, sides: number, closed: boolean, options: { squash?: number; rib?: boolean } = {}): void {
  const count = closed ? segments : segments + 1;
  const points = Array.from({ length: count }, (_, i) => path(i / segments));
  const tangent = (i: number) => {
    const prev = closed ? points[(i - 1 + count) % count] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % count] : points[Math.min(count - 1, i + 1)];
    return normalize(sub(next, prev));
  };
  const first = tangent(0);
  let n: Vec3 = normalize(Math.abs(first[1]) < .9 ? cross(first, [0, 1, 0]) : cross(first, [1, 0, 0]));
  const start = target.positions.length / 3;
  let length = 0;
  for (let i = 0; i < count; i++) {
    const t = tangent(i);
    n = normalize(sub(n, scale(t, dot(n, t))));
    const b = cross(t, n), r = radius(i / segments);
    if (i) length += Math.hypot(...sub(points[i], points[i - 1]));
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2;
      target.positions.push(...add(points[i], add(scale(n, Math.cos(a) * r), scale(b, Math.sin(a) * r * (options.squash ?? 1)))));
      target.partUV.push(-1, -1);
      target.detail.push(options.rib ? 1 : 0, options.rib ? length : 0, 1000, -1);
    }
  }
  const rows = closed ? count : count - 1;
  for (let i = 0; i < rows; i++) for (let k = 0; k < sides; k++) {
    const i1 = (i + 1) % count, k1 = (k + 1) % sides;
    const a = start + i * sides + k, b = start + i * sides + k1, c = start + i1 * sides + k, d = start + i1 * sides + k1;
    target.indices.push(a, c, b, b, c, d);
  }
}
/** A convex outline closed with a center fan. */
function fan(target: Builder, outline: Vec3[], center: Vec3, uvOf: (p: Vec3) => [number, number] = () => [-1, -1], flip = false): void {
  const start = target.positions.length / 3;
  target.positions.push(...center); target.partUV.push(...uvOf(center)); target.detail.push(...NO_DETAIL);
  for (const p of outline) { target.positions.push(...p); target.partUV.push(...uvOf(p)); target.detail.push(...NO_DETAIL); }
  for (let i = 0; i < outline.length; i++) {
    const a = start + 1 + i, b = start + 1 + (i + 1) % outline.length;
    if (flip) target.indices.push(start, b, a); else target.indices.push(start, a, b);
  }
}

/** Area-weighted smooth normals, oriented by triangle winding. */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
  }
  return normals;
}

function part(name: string, b: Builder, color: RGB, finish: Finish, options: { printable?: boolean; roughness?: number; group?: string; ownColor?: boolean } = {}): MeshPart {
  const positions = new Float32Array(b.positions), indices = new Uint32Array(b.indices);
  return {
    name, printable: options.printable ?? false, positions, normals: computeNormals(positions, indices), partUV: new Float32Array(b.partUV),
    detail: new Float32Array(b.detail), indices, color, finish, roughness: options.roughness ?? .85, group: options.group ?? name,
    ...(options.ownColor ? { ownColor: true } : {}),
  };
}

/** Parts of one group that share seam positions get averaged normals there, so the join is invisible. */
function weldNormals(parts: MeshPart[]): void {
  const seams = new Map<string, Array<[MeshPart, number]>>();
  for (const p of parts) for (let i = 0; i < p.positions.length / 3; i++) {
    const key = `${p.group}|${Math.round(p.positions[i * 3] * 4)},${Math.round(p.positions[i * 3 + 1] * 4)},${Math.round(p.positions[i * 3 + 2] * 4)}`;
    const list = seams.get(key);
    if (list) list.push([p, i]); else seams.set(key, [[p, i]]);
  }
  for (const list of seams.values()) {
    if (list.length < 2) continue;
    const [p0, i0] = list[0];
    const reference: Vec3 = [p0.normals[i0 * 3], p0.normals[i0 * 3 + 1], p0.normals[i0 * 3 + 2]];
    const signs = list.map(([p, i]) => reference[0] * p.normals[i * 3] + reference[1] * p.normals[i * 3 + 1] + reference[2] * p.normals[i * 3 + 2] < -.2 ? -1 : 1);
    let x = 0, y = 0, z = 0;
    list.forEach(([p, i], k) => { x += p.normals[i * 3] * signs[k]; y += p.normals[i * 3 + 1] * signs[k]; z += p.normals[i * 3 + 2] * signs[k]; });
    const l = Math.hypot(x, y, z) || 1;
    list.forEach(([p, i], k) => { p.normals[i * 3] = x / l * signs[k]; p.normals[i * 3 + 1] = y / l * signs[k]; p.normals[i * 3 + 2] = z / l * signs[k]; });
  }
}

/**
 * Bakes ambient occlusion on both sides of every vertex by casting short rays through a voxelized copy of the model.
 * Armpits, folds, the inside of a mug, sleeve or hood, and the underside of a cap visor darken naturally.
 */
export function bakeAO(parts: MeshPart[], resolution = 72, rays = 12): void {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.positions[i + k]); max[k] = Math.max(max[k], p.positions[i + k]); }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const cell = extent / resolution;
  const dims = [0, 1, 2].map(k => Math.max(1, Math.ceil((max[k] - min[k]) / cell) + 3));
  const occupied = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const index = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min[0]) / cell) + 1, j = Math.floor((y - min[1]) / cell) + 1, k = Math.floor((z - min[2]) / cell) + 1;
    return i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2] ? -1 : i + dims[0] * (j + dims[1] * k);
  };
  for (const p of parts) {
    const pos = p.positions;
    for (let t = 0; t < p.indices.length; t += 3) {
      const a = p.indices[t] * 3, b = p.indices[t + 1] * 3, c = p.indices[t + 2] * 3;
      const longest = Math.max(Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]), Math.hypot(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]));
      const steps = Math.max(1, Math.ceil(longest / (cell * .5)));
      for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        const k = index(pos[a] * w + pos[b] * u + pos[c] * v, pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v, pos[a + 2] * w + pos[b + 2] * u + pos[c + 2] * v);
        if (k >= 0) occupied[k] = 1;
      }
    }
  }
  // Cosine-weighted directions on a Fibonacci spiral around +Z.
  const directions: Vec3[] = Array.from({ length: rays }, (_, i) => {
    const r = Math.sqrt((i + .5) / rays), a = i * 2.39996;
    return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))];
  });
  const reach = Math.min(extent * .22, cell * 24), stepSize = cell * .7;
  for (const p of parts) {
    const ao = new Float32Array(p.positions.length / 3 * 2);
    for (let v = 0; v < p.positions.length / 3; v++) {
      const origin: Vec3 = [p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]];
      const normal: Vec3 = [p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2]];
      for (const side of [1, -1]) {
        const n = scale(normal, side);
        const tangent = normalize(Math.abs(n[1]) < .9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), bitangent = cross(n, tangent);
        let hits = 0;
        for (const d of directions) {
          const dir = add(add(scale(tangent, d[0]), scale(bitangent, d[1])), scale(n, d[2]));
          for (let s = cell * 1.6; s < reach; s += stepSize) {
            const k = index(origin[0] + dir[0] * s, origin[1] + dir[1] * s, origin[2] + dir[2] * s);
            if (k >= 0 && occupied[k]) { hits += 1 - s / reach * .6; break; }
          }
        }
        ao[v * 2 + (side === 1 ? 0 : 1)] = 1 - Math.min(1, hits / rays) * .85;
      }
    }
    p.ao = ao;
  }
}

export function hexColor(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return Number.isFinite(n) ? [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] : [1, 1, 1];
}

interface GarmentSpec {
  width: number; length: number; depth: number;
  /** Sleeve length along the top line, angle below horizontal, radius before the cuff, cuff radius and length (0: plain hem), armhole depth. */
  sleeve: { length: number; angle: number; end: number; cuffRadius: number; cuff: number; armhole: number };
  neck: 'crew' | 'hood';
  collar: number;
  band: number;
  pocket: boolean;
  finish: Finish;
  wrinkle: number;
}

/**
 * A garment as shown on an invisible mannequin: a softly tapered torso with rounded shoulders that close at the neckline,
 * sleeves lofted from an armhole on the torso side to the hem or a ribbed cuff, and a ribbed collar and waistband,
 * plus an optional hood (face opening, drawstrings) and kangaroo pocket.
 */
function garment(spec: GarmentSpec, color: RGB): ModelGeometry {
  const W = spec.width, L = spec.length, D = spec.depth, e = .82;
  const partHeight = L + 72;
  const bandFrac = spec.band / L;
  const hug = (v: number) => spec.band ? mix(.93, 1, smoothstep(bandFrac * .7, bandFrac * 1.3, v)) : 1;
  const halfWidth = (v: number) => W / 2 * (.955 + .045 * smoothstep(.3, .8, v) - .02 * smoothstep(.88, 1, v)) * hug(v);
  const halfDepth = (v: number) => D / 2 * (.9 + .1 * smoothstep(.35, .82, v) - .06 * smoothstep(.9, 1, v)) * hug(v);
  const neckX = W * .18, neckZ = W * .16, neckForward = W * .035;
  const neckY = (theta: number) => { const s = Math.sin(theta); return L + 63 - (s > 0 ? 50 * s ** 1.4 : -6 * s); };
  const neck = (theta: number): Vec3 => [neckX * Math.cos(theta), neckY(theta), neckZ * Math.sin(theta) + neckForward];
  const wrinkle = (p: Vec3, weight = 1) => spec.wrinkle * weight * fbm(p[0] * .011 + 3, p[1] * .009, p[2] * .011);
  const torso = (theta: number, v: number): Vec3 => {
    const c = Math.cos(theta), s = Math.sin(theta);
    return [halfWidth(v) * signedPow(c, e), v * L, halfDepth(v) * signedPow(s, e) * (s > 0 ? 1.03 : .98)];
  };
  /** The torso front's depth at a point, for details laid on top of it (pocket, drawstrings). */
  const frontZ = (x: number, y: number) => {
    const v = clamp01(y / L), a = halfWidth(v), b = halfDepth(v);
    const c = Math.min(.999, Math.abs(x) / a) ** (1 / e);
    return b * Math.sqrt(1 - c * c) ** e * 1.03;
  };
  const sl = spec.sleeve;
  const armX = halfWidth(.97) - 8, shoulderY = L - 6, armpitY = L - sl.armhole;
  const around = (W + D) * .29;
  // The torso runs up from the hem, then over a rounded shoulder (a quadratic Bézier) to the neckline.
  const split = .8;
  const body = (theta: number, t: number, front: boolean): Sample => {
    let p: Vec3, s = 0;
    if (t <= split) {
      const v = t / split;
      p = torso(theta, v);
      const radial = normalize([p[0] / halfWidth(v) ** 2, 0, p[2] / halfDepth(v) ** 2]);
      // Soft folds: vertical near the hem at the sides, gentle horizontal drag lines across the waist,
      // diagonal drag lines fanning down from the armpits, and a hem that waves slightly.
      const side = Math.abs(Math.cos(theta)) ** 3, ax = Math.abs(p[0]);
      const drag = smoothstep(armpitY - 300, armpitY - 120, p[1]) * (1 - smoothstep(armpitY - 70, armpitY - 10, p[1])) * smoothstep(W * .18, W * .4, ax);
      const folds = side * (1 - v) ** 2 * Math.sin(v * 38 + theta * 7) * .5
        + Math.sin(p[1] * .055 + fbm(p[0] * .01, 0, p[2] * .01) * 3) * .25 * smoothstep(.15, .45, v) * (1 - smoothstep(.55, .75, v))
        + Math.sin((p[1] + ax * .75) * .05 + fbm(p[0] * .01, p[1] * .01, 2) * 2) * drag * .9
        // Periodic in theta (noise sampled on the unit circle), so front and back meet exactly at the side seams.
        + Math.sin(theta * 6 + fbm(Math.cos(theta) * 2, Math.sin(theta) * 2, 5) * 2) * (1 - v) ** 5 * .7;
      p = add(p, scale(radial, wrinkle(p) + spec.wrinkle * folds * .8));
    } else {
      s = (t - split) / (1 - split);
      const q0 = torso(theta, 1), end = neck(theta);
      const control: Vec3 = [q0[0] * .98, L + Math.min(32, (end[1] - L) * .9), q0[2] * .97];
      p = add(add(scale(q0, (1 - s) ** 2), scale(control, 2 * s * (1 - s))), scale(end, s * s));
      p = add(p, [0, wrinkle(p, .3), 0]);
    }
    // Seams: side seams continuing over the shoulders, a double-needle hem or a waistband seam, and a topstitched neckline.
    const seams: SeamCandidate[] = [];
    if (Math.abs(Math.cos(theta)) > .5) seams.push([Math.abs(p[2] - (t <= split ? 0 : neckForward * s * s)), p[1] + Math.abs(p[0]) * .5, false]);
    if (!spec.band && p[1] < 45) seams.push([26 - p[1], theta * around, true]);
    if (spec.band) seams.push([p[1] - spec.band, theta * around, false]);
    if (spec.neck === 'crew' && t > split) seams.push([Math.hypot(...sub(p, neck(theta))) - spec.collar - 2, theta * (neckX + neckZ) * .5, true]);
    // The side is explicit: on the seam columns sin(theta) is ±0 and cannot tell front from back.
    const ribbed = spec.band && t <= split && t / split < bandFrac;
    return { p, uv: [front ? (p[0] + W / 2) / W : (W / 2 - p[0]) / W, (partHeight - p[1]) / partHeight], detail: [ribbed ? 1 : 0, ribbed ? theta * around : 0, ...nearestSeam(seams)] };
  };
  const front = builder(), back = builder(), trim = builder();
  grid(front, 72, 84, (u, v) => body(u * Math.PI, v, true));
  grid(back, 72, 84, (u, v) => body(Math.PI + u * Math.PI, v, false));
  if (spec.neck === 'crew') tube(trim, t => add(neck(t * Math.PI * 2), [0, spec.collar * .45, 0]), () => spec.collar, 120, 14, true, { squash: 1.3, rib: true });
  if (!spec.band) tube(trim, t => { const p = torso(t * Math.PI * 2, 0); return [p[0] * 1.004, 2.5, p[2] * 1.004]; }, () => 3.4, 120, 8, true);
  const parts = [
    part('front', front, color, spec.finish, { printable: true, group: 'body' }),
    part('back', back, color, spec.finish, { printable: true, group: 'body' }),
  ];

  // A woven care label inside the back neck, visible through the neck opening.
  if (spec.neck === 'crew') {
    const label = builder();
    const samples = Array.from({ length: 41 }, (_, i) => split + (1 - split) * i / 40).map(t => [t, body(Math.PI * 1.5, t, false).p[1]]);
    const tAt = (y: number) => { for (let i = 1; i < samples.length; i++) if (samples[i][1] >= y) return mix(samples[i - 1][0], samples[i][0], (y - samples[i - 1][1]) / (samples[i][1] - samples[i - 1][1] || 1)); return 1; };
    const neckBack = L + 57 - spec.collar * .9;
    grid(label, 6, 4, (u, w) => {
      const p = body(Math.PI * 1.5 + (u - .5) * .55, mix(tAt(neckBack - 4), tAt(neckBack - 30), w), false).p;
      return { p: add(p, scale(normalize([-p[0], 0, -p[2]]), 2.2)) };
    });
    parts.push(part('label', label, [.16, .17, .2], 'twill', { group: 'body', ownColor: true }));
  }

  // Sleeves: a loft from an armhole on the torso side to an end ellipse perpendicular to the sleeve.
  const armholeY = (shoulderY + armpitY) / 2, armholeZ = halfDepth(.9) * .72;
  /**
   * The torso surface (folds included) at a height and depth on one side. Sleeves are sewn on along this surface,
   * so the armhole follows the body round to the front and back instead of hanging beside it.
   */
  const sidePoint = (side: 1 | -1, y: number, z: number): Vec3 => {
    const v = clamp01(y / L), b = halfDepth(v) * (z >= 0 ? 1.03 : .98);
    const angle = Math.asin(Math.min(.995, Math.abs(z) / b) ** (1 / e));
    const theta = side === 1 ? (z >= 0 ? angle : Math.PI * 2 - angle) : (z >= 0 ? Math.PI - angle : Math.PI + angle);
    return body(theta, v * split, z >= 0).p;
  };
  const perimeter = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const armholePerimeter = perimeter((shoulderY - armpitY) / 2, armholeZ), endPerimeter = perimeter(sl.end, sl.end * .82);
  for (const side of [1, -1] as const) {
    const target = builder(), hem = builder();
    const dir = normalize([side * Math.cos(sl.angle), -Math.sin(sl.angle), .05]);
    const e2 = normalize(sub([0, 0, 1], scale(dir, dir[2])));
    let e1 = cross(e2, dir); if (e1[1] < 0) e1 = scale(e1, -1);
    const top: Vec3 = [side * armX, shoulderY, 0];
    const endCenter = sub(add(top, scale(dir, sl.length)), scale(e1, sl.end));
    const rootCenter: Vec3 = [side * armX, armholeY, 0];
    const cuffStart = sl.cuff ? 1 - sl.cuff / sl.length : 2;
    const long = sl.cuff > 0;
    const at = (u: number, s: number): Sample => {
      const phi = (u - .5) * Math.PI * 2;
      // The armhole is sewn to the torso: an upright ellipse from the shoulder point down to the armpit, laid onto the body
      // surface and tucked 4 mm inside it, so no gap opens between sleeve and body from any angle.
      const onBody = sidePoint(side, armholeY + (shoulderY - armpitY) / 2 * Math.cos(phi), armholeZ * Math.sin(phi));
      const armhole = sub(onBody, scale(normalize([onBody[0], 0, onBody[2]]), 4));
      const endOffset = add(scale(e1, Math.cos(phi) * sl.end), scale(e2, Math.sin(phi) * sl.end * .82));
      const sag: Vec3 = long ? [0, -Math.sin(s * Math.PI) * 24, Math.sin(s * Math.PI) * 10] : [0, 0, 0];
      const center = add(lerp3(rootCenter, endCenter, s), sag);
      let offset = lerp3(sub(armhole, rootCenter), endOffset, smoothstep(0, 1, s ** .8));
      // Long sleeves blouse slightly above a narrower ribbed cuff.
      const cuffScale = 1 - (1 - sl.cuffRadius / sl.end) * smoothstep(cuffStart - .012, cuffStart + .008, s);
      offset = scale(offset, (1 + (long ? .1 : .04) * Math.sin(s * Math.PI)) * cuffScale);
      const radial = normalize(offset);
      const inner = Math.max(0, -Math.cos(phi));
      const folds = long ? inner * Math.sin(s * 24) * smoothstep(.15, .5, s) * (1 - smoothstep(cuffStart - .05, cuffStart, s)) : inner * Math.sin(s * 9) * .3;
      const base = add(center, offset);
      const p = add(base, scale(radial, wrinkle(base, .7) + spec.wrinkle * folds));
      // Seams: the armhole, the underarm seam, and a double-needle hem or a plain cuff seam.
      const ring = mix(armholePerimeter, endPerimeter, s);
      const seams: SeamCandidate[] = [[s * sl.length - 5, u * ring, false], [Math.min(u, 1 - u) * ring, s * sl.length, false]];
      if (long) seams.push([(s - cuffStart) * sl.length, u * ring, false]); else seams.push([26 - (1 - s) * sl.length, u * ring, true]);
      const cuff = s > cuffStart;
      return { p, uv: [side === 1 ? 1 - u : u, s], detail: [cuff ? 1 : 0, cuff ? u * Math.PI * 2 * sl.cuffRadius * .9 : 0, ...nearestSeam(seams)] };
    };
    // The seam (u = 0 and 1) runs under the arm, as on a real sleeve; seam normals are welded below.
    grid(target, 56, 56, at, side === 1);
    tube(hem, t => at(t, 1).p, () => long ? 3.5 : 3, 56, 8, true);
    const name = side === 1 ? 'right-sleeve' : 'left-sleeve';
    parts.push(part(name, target, color, spec.finish, { printable: true, group: name }), part(`${name}-hem`, hem, color, spec.finish, { group: name }));
  }

  if (spec.neck === 'hood') {
    const hood = builder(), rim = builder(), cords = builder();
    const center: Vec3 = [0, L + 150, -18], rx = W * .215, ry = 168, rz = 136;
    const base = -.95, middle = -.3, crown = .62, half = 1.2;
    const raw = (phi: number, psi: number): Vec3 => [center[0] + rx * Math.cos(psi) * Math.sin(phi), center[1] + ry * Math.sin(psi), center[2] + rz * Math.cos(psi) * Math.cos(phi)];
    // The hood's lower edge is sewn to the neckline; it blends from the neckline into the hood shell.
    const point = (phi: number, psi: number): Vec3 => {
      const shell = raw(phi, psi);
      const p = add(shell, scale(sub(neck(Math.PI / 2 - phi), raw(phi, base)), 1 - smoothstep(base, base + .6, psi)));
      return add(p, scale(normalize(sub(shell, center)), wrinkle(p, .8) * smoothstep(base, base + .4, psi)));
    };
    // The face opening: two front edges meet at the neckline and arch over the forehead.
    const low = (phi: number) => Math.abs(phi) < half ? base + (middle - base) * (Math.abs(phi) / half) ** 1.3 : middle;
    const high = (phi: number) => Math.abs(phi) < half ? crown - (crown - middle) * (Math.abs(phi) / half) ** 2.2 : middle;
    // A topstitched center seam runs over the crown of the hood.
    grid(hood, 96, 36, (u, t) => { const phi = -Math.PI + u * Math.PI * 2, p = point(phi, mix(high(phi), Math.PI / 2 * .995, t)); return { p, detail: [0, 0, ...nearestSeam([[Math.abs(p[0]), p[1] - p[2] * .5, true]])] }; }, true, true);
    grid(hood, 96, 10, (u, t) => { const phi = -Math.PI + u * Math.PI * 2; return { p: point(phi, mix(base, low(phi), t)) }; }, true, true);
    const edge = (s: number): Vec3 => {
      const phi = s < .25 ? half * s * 4 : s < .75 ? half - (s - .25) * 4 * half : -half + (s - .75) * 4 * half;
      return point(phi, s < .25 || s >= .75 ? low(phi) : high(phi));
    };
    tube(rim, edge, () => 6, 144, 10, true);
    for (const x of [-1, 1]) {
      const from = add(point(x * .5, low(x * .5)), [0, -4, 6]);
      tube(cords, s => {
        const y = from[1] - s * 170;
        return [from[0] + x * 9 * s, y, Math.max(mix(from[2], frontZ(from[0], L) + 9, smoothstep(0, .25, s)), frontZ(from[0], y) + 8) + Math.sin(s * Math.PI) * 4];
      }, s => s > .9 ? 3.9 : 2.7, 40, 8, false);
    }
    parts.push(
      part('hood', hood, color, spec.finish, { group: 'hood' }), part('hood-rim', rim, color, spec.finish, { group: 'hood' }),
      part('cords', cords, shade(color, .95), 'twill', { group: 'cords' }),
    );
  }
  if (spec.pocket) {
    const pocket = builder(), edges = builder();
    const bottom = spec.band + 16, topY = bottom + 200;
    const outline = (w: number, s: number): Vec3 => {
      const half = mix(170, 112, w), x = -half + s * half * 2, y = mix(bottom, topY, w);
      const p: Vec3 = [x, y, frontZ(x, y)];
      return add(p, [0, 0, wrinkle(p) + 7.5 + Math.sin(s * Math.PI) * 4]);
    };
    grid(pocket, 40, 20, (s, w) => {
      // Topstitching runs just inside every pocket edge.
      const width = mix(340, 224, w);
      return { p: outline(w, s), detail: [0, 0, ...nearestSeam([[s * width - 1, w * 200, true], [(1 - s) * width - 1, w * 200, true], [w * 200 - 1, s * width, true], [(1 - w) * 200 - 1, s * width, true]])] };
    });
    tube(edges, s => outline(1, s), () => 2.6, 40, 8, false);
    tube(edges, w => outline(w, 0), () => 2.6, 20, 8, false);
    tube(edges, w => outline(w, 1), () => 2.6, 20, 8, false);
    parts.push(part('pocket', pocket, color, spec.finish, { group: 'body' }), part('pocket-edge', edges, color, spec.finish, { group: 'body' }));
  }
  parts.push(part('trim', trim, color, spec.finish, { group: 'body' }));
  weldNormals(parts);
  const sleeveSize = { width: mix(armholePerimeter, endPerimeter, .3), height: sl.length };
  return {
    parts, images: [], pitch: .1,
    partSizes: { front: { width: W, height: partHeight }, back: { width: W, height: partHeight }, 'right-sleeve': sleeveSize, 'left-sleeve': sleeveSize },
    facing: { front: 0, back: Math.PI, 'right-sleeve': -Math.PI / 2 + .2, 'left-sleeve': Math.PI / 2 - .2 },
    // As on a hanger: the shoulders, neckline and armholes hold; sleeves hinge at the armhole; the hood and drawstrings hang from the neck.
    pin: (x, y, _z, group) => {
      if (group === 'body') return Math.max(smoothstep(L - 70, L + 10, y) * (1 - smoothstep(W * .3, W * .4, Math.abs(x))), smoothstep(armpitY - 50, armpitY + 10, y) * smoothstep(W * .36, W * .44, Math.abs(x)));
      if (group === 'hood') return 1 - smoothstep(L + 50, L + 150, y);
      if (group === 'cords') return smoothstep(L - 50, L, y);
      return 1 - smoothstep(10, 70, Math.abs(x) - armX);
    },
  };
}

/** A structured five-panel baseball cap: upright front panel, crown sloping to the back, sunken seams, eyelets, a top button, and a pre-curved bill. */
function cap(color: RGB): ModelGeometry {
  const rx = 96, rz = 102, H = 100, frontHalf = .93, apexZ = -16;
  const seams = [frontHalf, -frontHalf, 2.1, -2.1, Math.PI];
  const crownPoint = (phi: number, psi: number): Vec3 => {
    // The front stays upright longer than the back, and the apex sits behind the center.
    const front = Math.max(0, Math.cos(phi));
    const ring = Math.cos(psi) ** mix(.85, .5, front), y = H * Math.sin(psi) ** mix(.95, .8, front);
    const groove = seams.reduce((g, s) => Math.max(g, 1 - Math.min(1, Math.abs(Math.atan2(Math.sin(phi - s), Math.cos(phi - s))) / .05)), 0) * (1 - psi / (Math.PI / 2)) * 1.6;
    const panel = front ** 3 * Math.sin(psi * 2) * 5;
    const k = 1 - groove / rz;
    return [rx * ring * Math.sin(phi) * k, y, (rz * ring * Math.cos(phi) + panel) * k + apexZ * Math.sin(psi) ** 2];
  };
  const front = builder(), crown = builder(), brim = builder(), details = builder();
  const uv = (p: Vec3): [number, number] => [(p[0] + 100) / 200, (110 - p[1]) / 110];
  // Rows of stitching on both sides of every panel seam, and one above the sweatband.
  const stitching = (phi: number, psi: number, p: Vec3): Detail => {
    const gap = seams.reduce((g, s) => Math.min(g, Math.abs(Math.atan2(Math.sin(phi - s), Math.cos(phi - s)))), Math.PI);
    return [0, 0, ...nearestSeam([[gap * rx * Math.cos(psi) ** .7, psi * 100, true], [p[1] - 7, phi * rx, true]])];
  };
  grid(front, 44, 40, (u, v) => { const phi = -frontHalf + u * frontHalf * 2, psi = v * Math.PI / 2 * .999, p = crownPoint(phi, psi); return { p, uv: uv(p), detail: stitching(phi, psi, p) }; }, true);
  grid(crown, 64, 40, (u, v) => { const phi = frontHalf + u * (Math.PI * 2 - frontHalf * 2), psi = v * Math.PI / 2 * .999, p = crownPoint(phi, psi); return { p, detail: stitching(phi, psi, p) }; }, true);
  // Button, sweatband edge, and stitched eyelets on the side panels.
  tube(details, t => { const a = t * Math.PI * 2; return [Math.sin(a) * 7.5, H + 1.5, apexZ + Math.cos(a) * 7.5]; }, () => 3.2, 24, 8, true);
  fan(details, Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2; return [Math.sin(a) * 7.5, H + 4.6, apexZ + Math.cos(a) * 7.5] as Vec3; }), [0, H + 5.6, apexZ]);
  tube(details, t => { const a = t * Math.PI * 2; return [rx * Math.sin(a) * 1.003, 2.2, rz * Math.cos(a) * 1.003]; }, () => 2.4, 120, 8, true);
  for (const phi of [1.55, -1.55, 2.65, -2.65]) {
    const c = crownPoint(phi, .95), n = normalize([c[0] / rx, 0, c[2] / rz]), tangent = normalize(cross([0, 1, 0], n));
    tube(details, t => { const a = t * Math.PI * 2; return add(add(c, scale(n, .8)), add(scale(tangent, Math.cos(a) * 3.2), [0, Math.sin(a) * 3.2, 0])); }, () => 1.1, 16, 6, true);
  }
  // The bill is a lens between the crown's front edge and an outer arc 74 mm ahead; its sides curve down.
  const billHalf = 1.22, endZ = rz * Math.cos(billHalf);
  const visor = (u: number, w: number, lift: number): Vec3 => {
    const s = u * 2 - 1, phi = s * billHalf;
    const inner: Vec3 = [rx * Math.sin(phi), 0, rz * Math.cos(phi)];
    const outer: Vec3 = [rx * 1.04 * Math.sin(s * Math.PI / 2), 0, endZ + (rz + 74 - endZ) * Math.cos(s * Math.PI / 2)];
    const p = lerp3(inner, outer, w);
    return [p[0], -w * 7 - 16 * s * s * Math.sin(w * Math.PI / 2) + lift, p[2]];
  };
  grid(brim, 48, 12, (u, w) => ({ p: visor(u, w, 1.4) }));
  grid(brim, 48, 12, (u, w) => ({ p: visor(u, w, -1.4) }), true);
  tube(brim, u => visor(u, 1, 0), () => 1.5, 48, 6, false);
  // Rows of stitching on the bill.
  for (const w of [.35, .55, .75]) tube(brim, u => visor(.05 + u * .9, w, 1.5), () => .35, 48, 4, false);
  const parts = [
    part('front', front, color, 'twill', { printable: true, group: 'crown' }),
    part('crown', crown, color, 'twill', { group: 'crown' }),
    part('details', details, shade(color, .9), 'twill', { group: 'crown' }),
    part('brim', brim, shade(color, .96), 'twill', { group: 'brim' }),
  ];
  weldNormals(parts);
  return {
    parts, images: [], partSizes: { front: { width: 200, height: 110 } }, facing: { front: 0 }, pitch: .3,
    pin: (x, y, z, group) => group === 'brim' ? 1 - smoothstep(1.03, 1.4, Math.hypot(x / rx, z / rz)) : 1 - smoothstep(4, 45, y),
  };
}

/** A stuffed cushion with pinched sides, folds fanning from the corners, and piping along the seam. */
function cushion(color: RGB, size: { width: number; height: number; depth: number }): ModelGeometry {
  const W = size.width, H = size.height, T = size.depth;
  const profile = (t: number) => Math.max(0, 1 - Math.abs(t) ** 2.3) ** .7;
  const point = (u: number, v: number, side: 1 | -1): Sample => {
    const x = u * W / 2 * (1 - .04 * (1 - v * v)), y = v * H / 2 * (1 - .04 * (1 - u * u)) + H / 2;
    let folds = 0;
    for (const [cu, cv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const du = u - cu, dv = v - cv, d = Math.hypot(du, dv);
      folds += Math.exp(-d / .3) * Math.sin(Math.atan2(dv, du) * 9 + cu * 2 + cv);
    }
    const z = side * (T / 2 * profile(u) * profile(v) + (folds * 4.5 + fbm(x * .008, y * .008, side) * 2.4) * (profile(u) * profile(v)) ** .3);
    return { p: [x, y, z], uv: [side === 1 ? (x + W / 2) / W : (W / 2 - x) / W, (H - y) / H] };
  };
  const front = builder(), back = builder(), piping = builder();
  grid(front, 84, 84, (u, v) => point(u * 2 - 1, v * 2 - 1, 1), true);
  grid(back, 84, 84, (u, v) => point(u * 2 - 1, v * 2 - 1, -1));
  const edge = (t: number): Vec3 => {
    const k = t * 4, side = Math.floor(k) % 4, f = (k % 1) * 2 - 1;
    const [u, v] = side === 0 ? [f, -1] : side === 1 ? [1, f] : side === 2 ? [-f, 1] : [-1, -f];
    const p = point(u, v, 1).p;
    return [p[0], p[1], 0];
  };
  tube(piping, edge, () => 4.5, 240, 10, true);
  const parts = [
    part('front', front, color, 'canvas', { printable: true, group: 'body' }),
    part('back', back, color, 'canvas', { printable: true, group: 'body' }),
    part('piping', piping, shade(color, .93), 'canvas', { group: 'body' }),
  ];
  weldNormals(parts);
  return {
    parts, images: [], partSizes: { front: { width: W, height: H }, back: { width: W, height: H } }, facing: { front: 0, back: Math.PI }, pitch: .12,
    pin: (_x, y) => 1 - smoothstep(10, 70, y),
  };
}

/** A glazed ceramic mug with a rounded rim and foot and a D-shaped handle. The wrap starts at the handle; x = 0.75 faces the viewer with the handle on the right. */
function mug(color: RGB, size: { width: number; height: number }): ModelGeometry {
  const r = size.width / 2, H = size.height, wall = Math.max(2.4, r * .085), floor = Math.max(5, H * .09), fillet = Math.min(4, H * .05);
  const ring = (u: number, radius: number, y: number): Vec3 => { const phi = Math.PI / 2 + u * Math.PI * 2; return [radius * Math.sin(phi), y, radius * Math.cos(phi)]; };
  const wrap = builder(), shell = builder(), handle = builder();
  grid(wrap, 128, 28, (u, v) => { const y = fillet + (H - wall / 2 - fillet) * (1 - v); return { p: ring(u, r, y), uv: [u, (H - y) / (H - fillet)] }; });
  // Rounded rim, inner wall, floor, rounded foot and a slightly recessed base.
  grid(shell, 128, 8, (u, v) => { const a = v * Math.PI; return { p: ring(u, r - wall / 2 + Math.cos(a) * wall / 2, H - wall / 2 + Math.sin(a) * wall / 2) }; }, true, true);
  grid(shell, 128, 20, (u, v) => ({ p: ring(u, r - wall, H - wall / 2 - v * (H - wall / 2 - floor)) }), true, true);
  fan(shell, Array.from({ length: 128 }, (_, i) => ring(i / 128, r - wall, floor)), [0, floor, 0]);
  grid(shell, 128, 6, (u, v) => { const a = v * Math.PI / 2; return { p: ring(u, r - fillet + fillet * Math.cos(a), fillet - fillet * Math.sin(a)) }; }, false, true);
  fan(shell, Array.from({ length: 128 }, (_, i) => ring(i / 128, r - fillet, 0)), [0, 1.2, 0], undefined, true);
  // The handle follows a cubic Bézier from the upper wall out and back to the lower wall; its section is an upright oval.
  const p0: Vec3 = [r - 1.5, H * .8, 0], p1: Vec3 = [r + H * .42, H * .82, 0], p2: Vec3 = [r + H * .4, H * .2, 0], p3: Vec3 = [r - 1.5, H * .24, 0];
  const bezier = (t: number): Vec3 => add(add(scale(p0, (1 - t) ** 3), scale(p1, 3 * t * (1 - t) ** 2)), add(scale(p2, 3 * t * t * (1 - t)), scale(p3, t ** 3)));
  tube(handle, bezier, t => Math.max(5.5, H * .07) * (1 - .1 * Math.sin(t * Math.PI)), 48, 16, false, { squash: .64 });
  const parts = [
    part('wrap', wrap, color, 'ceramic', { printable: true, roughness: .12, group: 'mug' }),
    part('body', shell, color, 'ceramic', { roughness: .12, group: 'mug' }),
    part('handle', handle, color, 'ceramic', { roughness: .12, group: 'mug' }),
  ];
  weldNormals(parts);
  return { parts, images: [], partSizes: { wrap: { width: Math.PI * size.width, height: H - fillet } }, facing: { wrap: 0 }, pitch: .38 };
}

/** A box with five printable faces, each oriented to read correctly from outside. */
function box(color: RGB, size: { width: number; height: number; depth: number }): ModelGeometry {
  const { width: w, height: h, depth: d } = size;
  const faces: Array<[string, Vec3, Vec3, Vec3, number, number]> = [
    ['front', [-w / 2, h, d / 2], [1, 0, 0], [0, -1, 0], w, h],
    ['back', [w / 2, h, -d / 2], [-1, 0, 0], [0, -1, 0], w, h],
    ['left', [-w / 2, h, -d / 2], [0, 0, 1], [0, -1, 0], d, h],
    ['right', [w / 2, h, d / 2], [0, 0, -1], [0, -1, 0], d, h],
    ['top', [-w / 2, h, -d / 2], [1, 0, 0], [0, 0, 1], w, d],
    ['bottom', [-w / 2, 0, d / 2], [1, 0, 0], [0, 0, -1], w, d],
  ];
  const parts = faces.map(([name, origin, right, down, fw, fh]) => {
    const b = builder();
    grid(b, 8, 8, (u, v) => ({ p: add(origin, add(scale(right, u * fw), scale(down, v * fh))), uv: [u, v] }));
    return part(name, b, color, 'card', { printable: name !== 'bottom', roughness: .7, group: 'box' });
  });
  return {
    parts, images: [], pitch: .36,
    partSizes: { front: { width: w, height: h }, back: { width: w, height: h }, left: { width: d, height: h }, right: { width: d, height: h }, top: { width: w, height: d } },
    facing: { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2, top: 0 },
  };
}

/** A printed hang tag: rounded card, metal eyelets, and a cotton string. */
function card(color: RGB, size: { width: number; height: number; depth: number }): ModelGeometry {
  const { width: w, height: h } = size, t = Math.max(.6, size.depth), radius = Math.min(w, h) * .08;
  const outline = (z: number): Vec3[] => {
    const points: Vec3[] = [];
    const corners: Array<[number, number, number]> = [[w / 2 - radius, h - radius, 0], [-w / 2 + radius, h - radius, Math.PI / 2], [-w / 2 + radius, radius, Math.PI], [w / 2 - radius, radius, Math.PI * 1.5]];
    for (const [cx, cy, start] of corners) for (let i = 0; i <= 8; i++) { const a = start + i / 8 * Math.PI / 2; points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]); }
    return points;
  };
  const front = builder(), back = builder(), edge = builder(), eyelet = builder(), string = builder();
  fan(front, outline(t / 2), [0, h / 2, t / 2], p => [(p[0] + w / 2) / w, (h - p[1]) / h]);
  fan(back, outline(-t / 2), [0, h / 2, -t / 2], p => [(w / 2 - p[0]) / w, (h - p[1]) / h], true);
  const ring = outline(0);
  grid(edge, ring.length, 1, (u, v) => { const p = ring[Math.round(u * ring.length) % ring.length]; return { p: [p[0], p[1], t / 2 - v * t] }; });
  const hole: Vec3 = [0, h - Math.max(7, h * .085), 0];
  for (const z of [t / 2 + .5, -t / 2 - .5]) tube(eyelet, a => [hole[0] + Math.cos(a * Math.PI * 2) * 3.4, hole[1] + Math.sin(a * Math.PI * 2) * 3.4, z], () => 1.1, 32, 8, true);
  tube(string, s => [hole[0] + Math.sin(s * Math.PI) * 6, hole[1] + s * h * .55, (1 - s) * .5 + Math.sin(s * Math.PI * 2) * 3], () => .9, 40, 6, false);
  const parts = [
    part('front', front, color, 'paper', { printable: true, group: 'card' }),
    part('back', back, color, 'paper', { printable: true, group: 'card' }),
    part('edge', edge, shade(color, .9), 'paper', { group: 'card' }),
    part('eyelet', eyelet, [.72, .72, .74], 'metal', { roughness: .3, group: 'card', ownColor: true }),
    part('string', string, [.93, .91, .86], 'twill', { group: 'card', ownColor: true }),
  ];
  return { parts, images: [], partSizes: { front: { width: w, height: h }, back: { width: w, height: h } }, facing: { front: 0, back: Math.PI }, pitch: .12 };
}

const cache = new Map<string, ModelGeometry>();
/** Builds (and caches) a generated shape. Geometry arrays are shared between calls and must be treated as read-only. */
export function buildPreset(model: Model3D): ModelGeometry {
  const preset = model.preset ?? 'tshirt';
  const size = { ...DEFAULT_PRESET_SIZE[preset], ...(model.size ?? {}) };
  const key = `${preset}|${size.width}|${size.height}|${size.depth}`;
  let base = cache.get(key);
  if (!base) {
    const white: RGB = [1, 1, 1];
    const body = { width: size.width, length: size.height, depth: size.depth };
    base = preset === 'mug' ? mug(white, size)
      : preset === 'box' ? box(white, size)
      : preset === 'card' ? card(white, size)
      : preset === 'cap' ? cap(white)
      : preset === 'cushion' ? cushion(white, size)
      : preset === 'hoodie' ? garment({ ...body, sleeve: { length: 600, angle: 1.16, end: 62, cuffRadius: 44, cuff: 70, armhole: 250 }, neck: 'hood', collar: 0, band: 70, pocket: true, finish: 'fleece', wrinkle: 5 }, white)
      : preset === 'sweater' ? garment({ ...body, sleeve: { length: 580, angle: 1.14, end: 58, cuffRadius: 42, cuff: 65, armhole: 235 }, neck: 'crew', collar: 11, band: 60, pocket: false, finish: 'knit', wrinkle: 4 }, white)
      : garment({ ...body, sleeve: { length: 210, angle: .8, end: 64, cuffRadius: 64, cuff: 0, armhole: 210 }, neck: 'crew', collar: 7, band: 0, pocket: false, finish: 'jersey', wrinkle: 4.5 }, white);
    base.softness = PRESET_SOFTNESS[preset];
    bakeAO(base.parts);
    cache.set(key, base);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  // Tinting keeps the shared vertex data; trims keep their slight shade offsets.
  const color = hexColor(model.color);
  return { ...base, parts: base.parts.map(p => p.ownColor ? p : { ...p, color: [p.color[0] * color[0], p.color[1] * color[1], p.color[2] * color[2]] as RGB }) };
}

/** Where a print surface lands in its part, as a normalized [left, top, width, height] rectangle. */
export function printRect(model: Model3D, binding: ModelBinding, surface: PrintSurface, geometry: Pick<ModelGeometry, 'partSizes'>): [number, number, number, number] {
  const size = geometry.partSizes[binding.part];
  const width = model.kind === 'preset' && size ? surface.widthMm / size.width : binding.width ?? .5;
  const height = model.kind === 'preset' && size ? surface.heightMm / size.height : binding.height ?? .5;
  return [binding.x - width / 2, binding.y - height / 2, width, height];
}
