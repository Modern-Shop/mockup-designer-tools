/**
 * Preview-only soft-body deformation for the 3D view ("pull" tool and sway when the model turns).
 * Meshless shape matching with overlapping clusters (Müller et al. 2005) drives a coarse set of particles;
 * mesh vertices follow them by blended rigid transforms, so dense meshes stay cheap. Pure math, no DOM or WebGL.
 * It never changes the design or print data.
 */
export interface SoftPart { positions: Float32Array; normals: Float32Array; group?: string }
export interface SoftBodyOptions {
  /** 0 stiff … 1 very loose. */
  softness: number;
  /** How firmly a rest position is held (0 free … 1 fixed). */
  pin?: (x: number, y: number, z: number, group: string) => number;
}
export interface SoftBody {
  /** Advances one display frame. Returns true while anything still moves. */
  step(): boolean;
  /** Starts pulling a part where `rest` (rest-space point) is now at `current`. Returns false when nothing there can move. */
  grab(part: number, rest: readonly number[], current?: readonly number[]): boolean;
  /** Moves the pulled point toward a rest-space target. */
  drag(target: readonly number[]): void;
  release(): void;
  /** Lets loose parts lag behind when the model turns about its vertical axis by `angle` radians in one frame. */
  sway(angle: number, center: readonly number[]): void;
  setSoftness(value: number): void;
  /** Writes a part's deformed positions and normals. */
  deform(part: number, positions: Float32Array, normals: Float32Array): void;
  /** The current deformed position of a part's vertex. */
  vertex(part: number, index: number): [number, number, number];
  reset(): void;
  readonly moving: boolean;
  readonly grabbing: boolean;
  readonly particleCount: number;
}

/** Particles that move each mesh vertex. */
const K = 6;

/** Rotation that best maps the rest cluster onto its current shape (Müller et al. 2016), warm-started from `q`. */
export function extractRotation(a: Float64Array | number[], q: Float64Array, iterations = 6): void {
  for (let iter = 0; iter < iterations; iter++) {
    const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
    // Rotation matrix columns from the quaternion.
    const r = [
      1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
      2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
      2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
    ];
    let ox = 0, oy = 0, oz = 0, d = 0;
    for (let c = 0; c < 3; c++) {
      const rx = r[c * 3], ry = r[c * 3 + 1], rz = r[c * 3 + 2], ax = a[c * 3], ay = a[c * 3 + 1], az = a[c * 3 + 2];
      ox += ry * az - rz * ay; oy += rz * ax - rx * az; oz += rx * ay - ry * ax;
      d += rx * ax + ry * ay + rz * az;
    }
    const scale = 1 / (Math.abs(d) + 1e-9);
    ox *= scale; oy *= scale; oz *= scale;
    const angle = Math.hypot(ox, oy, oz);
    if (angle < 1e-9) break;
    const s = Math.sin(angle / 2) / angle, cw = Math.cos(angle / 2);
    const bx = ox * s, by = oy * s, bz = oz * s;
    // q = b * q
    const nx = cw * x + bx * w + by * z - bz * y;
    const ny = cw * y - bx * z + by * w + bz * x;
    const nz = cw * z + bx * y - by * x + bz * w;
    const nw = cw * w - bx * x - by * y - bz * z;
    const l = Math.hypot(nx, ny, nz, nw) || 1;
    q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = nw / l;
  }
}

export function createSoftBody(parts: SoftPart[], options: SoftBodyOptions): SoftBody {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.positions[i + k]); max[k] = Math.max(max[k], p.positions[i + k]); }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const h = extent / 18;
  const cell = (value: number, axis: number) => Math.floor((value - min[axis]) / h) + 4;
  const keyOf = (g: number, cx: number, cy: number, cz: number) => ((g * 256 + cx) * 256 + cy) * 256 + cz;
  const cellKey = (x: number, y: number, z: number, g: number) => keyOf(g, cell(x, 0), cell(y, 1), cell(z, 2));

  // Particles: the centroid of each group's vertices per cell.
  const groupIds = new Map<string, number>();
  const partGroup = parts.map(p => { const name = p.group ?? ''; if (!groupIds.has(name)) groupIds.set(name, groupIds.size); return groupIds.get(name)!; });
  const cells = new Map<number, { sum: [number, number, number]; count: number; group: number }>();
  parts.forEach((p, pi) => {
    for (let i = 0; i < p.positions.length; i += 3) {
      const key = cellKey(p.positions[i], p.positions[i + 1], p.positions[i + 2], partGroup[pi]);
      const entry = cells.get(key) ?? { sum: [0, 0, 0], count: 0, group: partGroup[pi] };
      entry.sum[0] += p.positions[i]; entry.sum[1] += p.positions[i + 1]; entry.sum[2] += p.positions[i + 2]; entry.count++;
      cells.set(key, entry);
    }
  });
  const list = [...cells.values()];
  const n = list.length;
  const rest = new Float64Array(n * 3), group = new Int32Array(n), pins = new Float64Array(n);
  const groupNames = [...groupIds.keys()];
  list.forEach((entry, i) => {
    for (let k = 0; k < 3; k++) rest[i * 3 + k] = entry.sum[k] / entry.count;
    group[i] = entry.group;
    pins[i] = Math.max(0, Math.min(1, options.pin?.(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], groupNames[entry.group]) ?? 0));
  });
  // Spatial hash of particles for neighbor and skinning queries.
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const key = cellKey(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], group[i]);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
  }
  const found = new Map<number, number[]>();
  const nearby = (x: number, y: number, z: number, g: number, reach: number) => {
    const cx = cell(x, 0), cy = cell(y, 1), cz = cell(z, 2), memo = keyOf(g, cx, cy, cz) * 4 + reach;
    let result = found.get(memo);
    if (result) return result;
    result = [];
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
      const bucket = buckets.get(keyOf(g, cx + dx, cy + dy, cz + dz));
      if (bucket) result.push(...bucket);
    }
    found.set(memo, result);
    return result;
  };
  const distance2 = (i: number, x: number, y: number, z: number) => (rest[i * 3] - x) ** 2 + (rest[i * 3 + 1] - y) ** 2 + (rest[i * 3 + 2] - z) ** 2;

  // Clusters: each particle with its neighbors within 1.8 cells (at least 4 members where the group allows).
  const members: number[][] = [];
  for (let i = 0; i < n; i++) {
    const candidates = nearby(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], group[i], 2)
      .map(j => [j, distance2(j, rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2])] as const).sort((a, b) => a[1] - b[1]);
    const within = candidates.filter(([, d]) => d <= (h * 1.8) ** 2).map(([j]) => j);
    members.push(within.length >= 4 ? within : candidates.slice(0, 4).map(([j]) => j));
  }
  const restCenter = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (const j of members[i]) for (let k = 0; k < 3; k++) restCenter[i * 3 + k] += rest[j * 3 + k];
    for (let k = 0; k < 3; k++) restCenter[i * 3 + k] /= members[i].length;
  }

  // Skinning: each vertex follows nearby particles of its group, weighted by a smooth compact kernel (Wendland C2),
  // so the weights change continuously across the mesh and pulled fabric stays smooth.
  const support = h * 2.4;
  const kernel = (d2: number) => { const q = Math.sqrt(d2) / support; return q >= 1 ? 0 : (1 - q) ** 4 * (4 * q + 1); };
  const bindings = parts.map((p, pi) => {
    const count = p.positions.length / 3, index = new Int32Array(count * K), weight = new Float32Array(count * K);
    for (let v = 0; v < count; v++) {
      const x = p.positions[v * 3], y = p.positions[v * 3 + 1], z = p.positions[v * 3 + 2];
      let candidates = nearby(x, y, z, partGroup[pi], 3);
      if (!candidates.length) candidates = nearby(x, y, z, partGroup[pi], 6);
      // Keep the K nearest by insertion.
      const bestIndex = new Array<number>(K).fill(-1), bestDistance = new Array<number>(K).fill(Infinity);
      for (const j of candidates) {
        const d = distance2(j, x, y, z);
        if (d >= bestDistance[K - 1]) continue;
        let k = K - 1;
        while (k > 0 && bestDistance[k - 1] > d) { bestDistance[k] = bestDistance[k - 1]; bestIndex[k] = bestIndex[k - 1]; k--; }
        bestDistance[k] = d; bestIndex[k] = j;
      }
      let total = 0;
      for (let k = 0; k < K; k++) {
        const w = bestIndex[k] < 0 ? 0 : kernel(bestDistance[k]);
        index[v * K + k] = Math.max(0, bestIndex[k]); weight[v * K + k] = w; total += w;
      }
      // Beyond every particle's support (rare), follow the nearest one rigidly.
      if (!total && bestIndex[0] >= 0) { weight[v * K] = 1; total = 1; }
      for (let k = 0; k < K; k++) weight[v * K + k] = total ? weight[v * K + k] / total : 0;
    }
    return { index, weight };
  });

  const x = new Float64Array(rest), velocity = new Float64Array(n * 3), rotation = new Float64Array(n * 4);
  const goal = new Float64Array(n * 3), goalCount = new Float64Array(n), matrix = new Float64Array(n * 9);
  const reset = () => { x.set(rest); velocity.fill(0); for (let i = 0; i < n; i++) rotation.set([0, 0, 0, 1], i * 4); updateMatrices(); };
  const updateMatrices = () => {
    for (let i = 0; i < n; i++) {
      const [qx, qy, qz, qw] = rotation.subarray(i * 4, i * 4 + 4);
      matrix.set([
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy),
        2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx),
        2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy),
      ], i * 9);
    }
  };
  let softness = 0, alpha = 0, anchor = 0, damping = 0, pull = 0;
  const setSoftness = (value: number) => {
    softness = Math.max(0, Math.min(1, value));
    alpha = .78 - .58 * softness; anchor = .11 - .1 * softness; damping = .86 + .1 * softness; pull = .35 + .4 * softness;
  };
  setSoftness(options.softness);
  reset();

  let grabbed: { weights: Float64Array; start: Float64Array; point: number[]; target: number[] } | null = null;
  let moving = false;
  const maxDrag = extent * .45;

  const substep = () => {
    goal.fill(0); goalCount.fill(0);
    const a = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const m = members[i];
      let cx = 0, cy = 0, cz = 0;
      for (const j of m) { cx += x[j * 3]; cy += x[j * 3 + 1]; cz += x[j * 3 + 2]; }
      cx /= m.length; cy /= m.length; cz /= m.length;
      a.fill(0);
      for (const j of m) {
        const px = x[j * 3] - cx, py = x[j * 3 + 1] - cy, pz = x[j * 3 + 2] - cz;
        const qx = rest[j * 3] - restCenter[i * 3], qy = rest[j * 3 + 1] - restCenter[i * 3 + 1], qz = rest[j * 3 + 2] - restCenter[i * 3 + 2];
        // Column c of A = sum p * q[c].
        a[0] += px * qx; a[1] += py * qx; a[2] += pz * qx;
        a[3] += px * qy; a[4] += py * qy; a[5] += pz * qy;
        a[6] += px * qz; a[7] += py * qz; a[8] += pz * qz;
      }
      const q = rotation.subarray(i * 4, i * 4 + 4);
      extractRotation(a, q, 3);
      const [rx, ry, rz, rw] = q;
      for (const j of m) {
        const qx = rest[j * 3] - restCenter[i * 3], qy = rest[j * 3 + 1] - restCenter[i * 3 + 1], qz = rest[j * 3 + 2] - restCenter[i * 3 + 2];
        // Rotate (qx, qy, qz) by the quaternion.
        const tx = 2 * (ry * qz - rz * qy), ty = 2 * (rz * qx - rx * qz), tz = 2 * (rx * qy - ry * qx);
        goal[j * 3] += qx + rw * tx + (ry * tz - rz * ty) + cx;
        goal[j * 3 + 1] += qy + rw * ty + (rz * tx - rx * tz) + cy;
        goal[j * 3 + 2] += qz + rw * tz + (rx * ty - ry * tx) + cz;
        goalCount[j]++;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const c = i * 3 + k;
        const predicted = x[c] + velocity[c] * damping;
        let next = predicted + (goal[c] / goalCount[i] - predicted) * alpha + (rest[c] - predicted) * anchor;
        if (grabbed && grabbed.weights[i]) next += (grabbed.start[c] + grabbed.target[k] - grabbed.point[k] - next) * grabbed.weights[i] * pull;
        next += (rest[c] - next) * pins[i];
        velocity[c] = next - x[c];
        x[c] = next;
      }
    }
  };

  return {
    get moving() { return moving; },
    get grabbing() { return !!grabbed; },
    get particleCount() { return n; },
    step() {
      if (!moving) return false;
      substep(); substep();
      updateMatrices();
      if (!grabbed) {
        let energy = 0;
        for (let c = 0; c < n * 3; c++) energy = Math.max(energy, Math.abs(velocity[c]), Math.abs(x[c] - rest[c]) * .2);
        if (energy < h * .0015) { reset(); moving = false; }
      }
      return moving;
    },
    grab(part, point, current = point) {
      const g = partGroup[part];
      if (g === undefined || softness <= 0) return false;
      const weights = new Float64Array(n), radius = h * 2.4;
      let any = false;
      for (const i of nearby(point[0], point[1], point[2], g, 3)) {
        const d = Math.sqrt(distance2(i, point[0], point[1], point[2]));
        if (d < radius && pins[i] < .98) { weights[i] = (1 - d / radius) ** 2 * (1 - pins[i]); any = true; }
      }
      if (!any) return false;
      grabbed = { weights, start: new Float64Array(x), point: [...current], target: [...current] };
      moving = true;
      return true;
    },
    drag(target) {
      if (!grabbed) return;
      const d = [target[0] - grabbed.point[0], target[1] - grabbed.point[1], target[2] - grabbed.point[2]];
      const length = Math.hypot(d[0], d[1], d[2]), k = length > maxDrag ? maxDrag / length : 1;
      grabbed.target = [grabbed.point[0] + d[0] * k, grabbed.point[1] + d[1] * k, grabbed.point[2] + d[2] * k];
    },
    release() { grabbed = null; },
    sway(angle, center) {
      if (softness <= 0 || !angle) return;
      const k = -angle * .3 * softness, limit = extent * .02;
      for (let i = 0; i < n; i++) {
        const free = 1 - pins[i];
        if (free <= 0) continue;
        const rx = x[i * 3] - center[0], rz = x[i * 3 + 2] - center[2];
        velocity[i * 3] = Math.max(-limit, Math.min(limit, velocity[i * 3] + rz * k * free));
        velocity[i * 3 + 2] = Math.max(-limit, Math.min(limit, velocity[i * 3 + 2] - rx * k * free));
      }
      moving = true;
    },
    setSoftness,
    deform(part, positions, normals) {
      const source = parts[part], { index, weight } = bindings[part];
      const count = source.positions.length / 3;
      for (let v = 0; v < count; v++) {
        const vx = source.positions[v * 3], vy = source.positions[v * 3 + 1], vz = source.positions[v * 3 + 2];
        const nx = source.normals[v * 3], ny = source.normals[v * 3 + 1], nz = source.normals[v * 3 + 2];
        let px = 0, py = 0, pz = 0, mx = 0, my = 0, mz = 0;
        for (let k = 0; k < K; k++) {
          const w = weight[v * K + k];
          if (!w) continue;
          const j = index[v * K + k], r = j * 9;
          const dx = vx - rest[j * 3], dy = vy - rest[j * 3 + 1], dz = vz - rest[j * 3 + 2];
          px += w * (matrix[r] * dx + matrix[r + 3] * dy + matrix[r + 6] * dz + x[j * 3]);
          py += w * (matrix[r + 1] * dx + matrix[r + 4] * dy + matrix[r + 7] * dz + x[j * 3 + 1]);
          pz += w * (matrix[r + 2] * dx + matrix[r + 5] * dy + matrix[r + 8] * dz + x[j * 3 + 2]);
          mx += w * (matrix[r] * nx + matrix[r + 3] * ny + matrix[r + 6] * nz);
          my += w * (matrix[r + 1] * nx + matrix[r + 4] * ny + matrix[r + 7] * nz);
          mz += w * (matrix[r + 2] * nx + matrix[r + 5] * ny + matrix[r + 8] * nz);
        }
        positions[v * 3] = px; positions[v * 3 + 1] = py; positions[v * 3 + 2] = pz;
        const l = Math.hypot(mx, my, mz) || 1;
        normals[v * 3] = mx / l; normals[v * 3 + 1] = my / l; normals[v * 3 + 2] = mz / l;
      }
    },
    vertex(part, v) {
      const source = parts[part], { index, weight } = bindings[part];
      const out: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < K; k++) {
        const w = weight[v * K + k];
        if (!w) continue;
        const j = index[v * K + k], r = j * 9;
        const dx = source.positions[v * 3] - rest[j * 3], dy = source.positions[v * 3 + 1] - rest[j * 3 + 1], dz = source.positions[v * 3 + 2] - rest[j * 3 + 2];
        for (let c = 0; c < 3; c++) out[c] += w * (matrix[r + c] * dx + matrix[r + 3 + c] * dy + matrix[r + 6 + c] * dz + x[j * 3 + c]);
      }
      return out;
    },
    reset() { grabbed = null; moving = false; reset(); },
  };
}
