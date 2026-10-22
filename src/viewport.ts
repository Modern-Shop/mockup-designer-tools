import { STAGE_HEIGHT, STAGE_WIDTH, type Rect, type StageViewport } from './render.js';

export type Point = { x: number; y: number };
/** A rotated rectangle in an isotropic model space. Rotation is clockwise degrees around the center. */
export interface Box { cx: number; cy: number; w: number; h: number; rotation: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

const MIN_SCALE = .05, MAX_SCALE = 8;
const SIGNS: Record<Exclude<Handle, 'rotate'>, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

const rad = (deg: number) => deg * Math.PI / 180;
const rotate = (p: Point, deg: number): Point => { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };
export const normalizeAngle = (deg: number) => ((deg % 360) + 540) % 360 - 180;

/** Corners in nw, ne, se, sw order. */
export function boxCorners(b: Box): Point[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => { const p = rotate({ x: sx * b.w / 2, y: sy * b.h / 2 }, b.rotation); return { x: b.cx + p.x, y: b.cy + p.y }; });
}
export function boxPoint(b: Box, sx: number, sy: number): Point { const p = rotate({ x: sx * b.w / 2, y: sy * b.h / 2 }, b.rotation); return { x: b.cx + p.x, y: b.cy + p.y }; }
export function handleSigns(handle: Exclude<Handle, 'rotate'>): [number, number] { return SIGNS[handle]; }
export function insideBox(b: Box, p: Point, margin = 0): boolean {
  const local = rotate({ x: p.x - b.cx, y: p.y - b.cy }, -b.rotation);
  return Math.abs(local.x) <= b.w / 2 + margin && Math.abs(local.y) <= b.h / 2 + margin;
}

/** Resize from a handle. Uniform keeps the box proportions; centered scales around the center (fixed position). */
export function resizeBox(start: Box, handle: Exclude<Handle, 'rotate'>, pointer: Point, options: { uniform: boolean; centered: boolean; min: number }): Box {
  const [sx, sy] = SIGNS[handle];
  const p = rotate({ x: pointer.x - start.cx, y: pointer.y - start.cy }, -start.rotation);
  const anchor = options.centered ? { x: 0, y: 0 } : { x: -sx * start.w / 2, y: -sy * start.h / 2 };
  const factor = options.centered ? 2 : 1;
  let w = start.w, h = start.h;
  if (options.uniform && sx && sy) {
    const diagonal = Math.hypot(start.w, start.h);
    const length = ((p.x - anchor.x) * sx * start.w + (p.y - anchor.y) * sy * start.h) / diagonal;
    const k = Math.max(length * factor / diagonal, options.min / Math.min(start.w, start.h));
    w = start.w * k; h = start.h * k;
  } else {
    if (sx) w = Math.max(options.min, sx * (p.x - anchor.x) * factor);
    if (sy) h = Math.max(options.min, sy * (p.y - anchor.y) * factor);
  }
  const local = options.centered ? { x: 0, y: 0 } : { x: sx ? anchor.x + sx * w / 2 : 0, y: sy ? anchor.y + sy * h / 2 : 0 };
  const offset = rotate(local, start.rotation);
  return { ...start, cx: start.cx + offset.x, cy: start.cy + offset.y, w, h };
}

/** Rotation from a drag around the box center. Shift snaps to 15°; near-right angles snap gently. */
export function rotateBox(start: Box, from: Point, to: Point, snap: boolean): number {
  const a0 = Math.atan2(from.y - start.cy, from.x - start.cx), a1 = Math.atan2(to.y - start.cy, to.x - start.cx);
  let angle = normalizeAngle(start.rotation + (a1 - a0) * 180 / Math.PI);
  if (snap) angle = Math.round(angle / 15) * 15;
  else { const right = Math.round(angle / 90) * 90; if (Math.abs(angle - right) < 2.5) angle = right; }
  return normalizeAngle(angle);
}

/** CSS cursor for a resize handle, accounting for the on-screen orientation of the box. */
export function handleCursor(handle: Handle, screenAngle: number): string {
  if (handle === 'rotate') return 'var(--mdt-ui-cursor-rotate)';
  const [sx, sy] = SIGNS[handle];
  const angle = ((Math.atan2(sy, sx) * 180 / Math.PI + screenAngle) % 180 + 180) % 180;
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return cursors[Math.round(angle / 45) % 4];
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, className = ''): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (className) element.setAttribute('class', className);
  return element;
}
export const pointsAttr = (points: Point[]) => points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** Zoom and pan state for one editor stage. Screen coordinates are CSS pixels relative to the stage element. */
export class Viewport {
  scale = 1; x = 0; y = 0; width = 0; height = 0;
  private following = true;
  private content: Rect = { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
  constructor(private onChange: () => void, private padding = 56) {}

  get fitScale(): number {
    if (!this.width || !this.height) return 1;
    const pad = Math.min(this.padding, this.width / 8, this.height / 8);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, (this.width - pad * 2) / this.content.width, (this.height - pad * 2) / this.content.height));
  }
  get isFitted(): boolean { return this.following; }
  get state(): StageViewport {
    let ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    // Keep the backing store bounded on very large screens.
    const pixels = this.width * this.height * ratio * ratio;
    if (pixels > 9_000_000) ratio = Math.sqrt(9_000_000 / (this.width * this.height));
    return { width: this.width, height: this.height, scale: this.scale, x: this.x, y: this.y, pixelRatio: Math.max(.5, ratio) };
  }
  resize(width: number, height: number): void {
    if (Math.abs(width - this.width) < .5 && Math.abs(height - this.height) < .5) return;
    const center = this.width ? this.toStage(this.width / 2, this.height / 2) : null;
    this.width = width; this.height = height;
    if (this.following || !center) this.fit();
    else { this.x = width / 2 - center.x * this.scale; this.y = height / 2 - center.y * this.scale; this.clamp(); this.onChange(); }
  }
  /** Content is what Fit frames, normally the product photo. */
  setContent(rect: Rect | null, refit = false): void {
    this.content = rect && rect.width > 0 && rect.height > 0 ? rect : { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
    if (refit || this.following) this.fit();
  }
  fit(): void {
    this.following = true;
    this.scale = this.fitScale;
    this.x = (this.width - this.content.width * this.scale) / 2 - this.content.x * this.scale;
    this.y = (this.height - this.content.height * this.scale) / 2 - this.content.y * this.scale;
    this.onChange();
  }
  zoomTo(scale: number, cx = this.width / 2, cy = this.height / 2): void {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const anchor = this.toStage(cx, cy);
    this.scale = next; this.x = cx - anchor.x * next; this.y = cy - anchor.y * next;
    this.following = Math.abs(next - this.fitScale) < .001 && this.following;
    if (!this.following) this.clamp();
    this.onChange();
  }
  zoomBy(factor: number, cx?: number, cy?: number): void { this.following = false; this.zoomTo(this.scale * factor, cx, cy); }
  /** Step through familiar zoom levels. */
  step(direction: 1 | -1): void {
    const levels = [.1, .25, .33, .5, .67, .75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
    const next = direction > 0 ? levels.find(level => level > this.scale * 1.01) ?? MAX_SCALE : [...levels].reverse().find(level => level < this.scale * .99) ?? MIN_SCALE;
    this.following = false; this.zoomTo(next);
  }
  panBy(dx: number, dy: number): void { this.following = false; this.x += dx; this.y += dy; this.clamp(); this.onChange(); }
  toStage(px: number, py: number): Point { return { x: (px - this.x) / this.scale, y: (py - this.y) / this.scale }; }
  toScreen(sx: number, sy: number): Point { return { x: sx * this.scale + this.x, y: sy * this.scale + this.y }; }
  /** Keep part of the content reachable so the product cannot be panned out of sight. */
  private clamp(): void {
    const keep = 64;
    const left = this.content.x * this.scale + this.x, right = (this.content.x + this.content.width) * this.scale + this.x;
    const top = this.content.y * this.scale + this.y, bottom = (this.content.y + this.content.height) * this.scale + this.y;
    if (right < keep) this.x += keep - right;
    if (left > this.width - keep) this.x -= left - (this.width - keep);
    if (bottom < keep) this.y += keep - bottom;
    if (top > this.height - keep) this.y -= top - (this.height - keep);
  }
}
