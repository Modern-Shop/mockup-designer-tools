import { assertDesign, assertTemplate, EditorError, copyDesign, copyTemplate, exportSize, MAX_EXPORT_PIXELS, MAX_IMAGE_PIXELS, validateDesign, validateTemplate } from './core.js';
import { withPngDpi } from './png.js';
import type { DesignDocument, ExportResult, ImageAsset, PrintSurface, ProductTemplate, SurfaceBinding } from './types.js';

/** The virtual stage that product views are letterboxed into. Editors zoom/pan this space; exports use it 1:1. */
export const STAGE_WIDTH = 960, STAGE_HEIGHT = 800;
export type Rect = { x: number; y: number; width: number; height: number };
/** 2D affine in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
/** Maps stage pixels to a canvas of CSS size width × height: css = stage · scale + (x, y). */
export interface StageViewport { width: number; height: number; scale: number; x: number; y: number; pixelRatio: number }
export interface PreviewOptions { guides?: boolean; selectedId?: string; activeSurfaceId?: string; viewport?: StageViewport }

function productRect(asset: ImageAsset): Rect {
  const scale = Math.min((STAGE_WIDTH - 64) / asset.width, (STAGE_HEIGHT - 64) / asset.height);
  return { x: (STAGE_WIDTH - asset.width * scale) / 2, y: (STAGE_HEIGHT - asset.height * scale) / 2, width: asset.width * scale, height: asset.height * scale };
}

/** Stage rectangle occupied by a view's product photo, or null when the view or photo is missing. */
export function viewRect(t: ProductTemplate, viewId: string): Rect | null {
  const view = t.views.find(v => v.id === viewId);
  const asset = view && Object.hasOwn(t.assets, view.assetId) ? t.assets[view.assetId] : undefined;
  return asset ? productRect(asset) : null;
}

/** Forward mapping from a print surface (mm) into stage pixels for one view binding. */
export function surfaceAffine(t: ProductTemplate, viewId: string, surfaceId: string): Affine | null {
  const view = t.views.find(v => v.id === viewId);
  const surface = t.surfaces.find(s => s.id === surfaceId);
  const binding = view?.bindings.find(b => b.surfaceId === surfaceId);
  const rect = viewRect(t, viewId);
  if (!rect || !binding || !surface || binding.width <= 0 || binding.height <= 0 || surface.widthMm <= 0 || surface.heightMm <= 0) return null;
  const angle = binding.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const sx = binding.width * rect.width / surface.widthMm, sy = binding.height * rect.height / surface.heightMm;
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  const cx = rect.x + (binding.x + binding.width / 2) * rect.width, cy = rect.y + (binding.y + binding.height / 2) * rect.height;
  return { a, b, c, d, e: cx - a * surface.widthMm / 2 - c * surface.heightMm / 2, f: cy - b * surface.widthMm / 2 - d * surface.heightMm / 2 };
}
export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}
export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

export function mapPointToProduct(t: ProductTemplate, viewId: string, x: number, y: number): { x: number; y: number } | null {
  const view = t.views.find(v => v.id === viewId);
  const asset = view && t.assets[view.assetId];
  if (!asset) return null;
  const rect = productRect(asset);
  return { x: (x * STAGE_WIDTH - rect.x) / rect.width, y: (y * STAGE_HEIGHT - rect.y) / rect.height };
}

/** Maps normalized stage coordinates through photo letterboxing and inverse binding rotation. */
export function mapPointToSurface(t: ProductTemplate, viewId: string, surfaceId: string, x: number, y: number): { xMm: number; yMm: number } | null {
  const view = t.views.find(v => v.id === viewId);
  const surface = t.surfaces.find(s => s.id === surfaceId);
  const binding = view?.bindings.find(b => b.surfaceId === surfaceId);
  const asset = view && t.assets[view.assetId];
  if (!asset || !binding || !surface || binding.width <= 0 || binding.height <= 0) return null;
  const rect = productRect(asset);
  const dx = x * STAGE_WIDTH - rect.x - (binding.x + binding.width / 2) * rect.width;
  const dy = y * STAGE_HEIGHT - rect.y - (binding.y + binding.height / 2) * rect.height;
  const angle = -binding.rotation * Math.PI / 180;
  return { xMm: ((dx * Math.cos(angle) - dy * Math.sin(angle)) / (binding.width * rect.width) + .5) * surface.widthMm, yMm: ((dx * Math.sin(angle) + dy * Math.cos(angle)) / (binding.height * rect.height) + .5) * surface.heightMm };
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new EditorError('canvas-unavailable', 'Canvas 2D is not available in this browser.');
  return ctx;
}
function trimClip(ctx: CanvasRenderingContext2D, s: PrintSurface): void {
  ctx.beginPath();
  if (s.clip) {
    s.clip.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x * s.widthMm, p.y * s.heightMm); else ctx.lineTo(p.x * s.widthMm, p.y * s.heightMm); });
    ctx.closePath();
  } else ctx.rect(0, 0, s.widthMm, s.heightMm);
  ctx.clip();
}
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new EditorError('export-failed', 'PNG export failed. Try a smaller output.')), 'image/png'); }
    catch { reject(new EditorError('export-cors', 'The image server must allow CORS before this canvas can be exported.')); }
  });
}

/** One renderer per editor. Importing this module does not access browser globals. */
export class Renderer {
  private cache = new Map<string, { promise: Promise<HTMLImageElement>; image: HTMLImageElement }>();
  private pending = new Map<HTMLImageElement, (reason: Error) => void>();
  private generations = new WeakMap<HTMLCanvasElement, number>();
  private disposed = false;

  private load(asset: ImageAsset): Promise<HTMLImageElement> {
    if (this.disposed) return Promise.reject(new EditorError('renderer-destroyed', 'The renderer has been destroyed.'));
    const key = asset.src;
    const existing = this.cache.get(key);
    const validate = (image: HTMLImageElement) => {
      if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw new EditorError('image-mismatch', 'Decoded image dimensions do not match the asset manifest.');
      return image;
    };
    if (existing) return existing.promise.then(validate);
    const image = new Image();
    image.crossOrigin = 'anonymous'; image.decoding = 'async';
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      this.pending.set(image, reason => { image.onload = image.onerror = null; image.src = ''; reject(reason); });
      image.onload = () => {
        this.pending.delete(image);
        image.onload = image.onerror = null;
        if (this.disposed) return reject(new EditorError('renderer-destroyed', 'The renderer has been destroyed.'));
        if (image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) { this.cache.delete(key); return reject(new EditorError('image-too-large', 'The decoded image exceeds the supported size limit.')); }
        resolve(image);
      };
      image.onerror = () => { this.pending.delete(image); image.onload = image.onerror = null; this.cache.delete(key); reject(new EditorError('image-load', 'An image could not be loaded. Check the URL and image server CORS settings.')); };
      image.src = asset.src;
    });
    this.cache.set(key, { promise, image });
    return promise.then(validate);
  }

  private async images(t: ProductTemplate, d?: DesignDocument, signal?: AbortSignal): Promise<Map<string, HTMLImageElement>> {
    signal?.throwIfAborted();
    // Product and artwork manifests have separate namespaces; their IDs may overlap.
    const assets = [...Object.values(t.assets), ...Object.values(d?.assets ?? {})];
    // Only retain current asset references, not every previous upload in the editor's lifetime.
    const active = new Set(assets.map(a => a.src));
    for (const key of this.cache.keys()) if (!active.has(key)) this.cache.delete(key);
    const loaded = Promise.all(assets.map(a => this.load(a)));
    if (!signal) {
      const resolved = await loaded;
      if (this.disposed) throw new EditorError('renderer-destroyed', 'The renderer has been destroyed.');
      return new Map(assets.map((a, index) => [a.src, resolved[index]]));
    }
    let abort: () => void = () => {};
    try {
      const resolved = await Promise.race([loaded, new Promise<never>((_, reject) => { abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); })]);
      signal.throwIfAborted();
      if (this.disposed) throw new EditorError('renderer-destroyed', 'The renderer has been destroyed.');
      return new Map(assets.map((a, index) => [a.src, resolved[index]]));
    } finally { signal.removeEventListener('abort', abort); }
  }

  async preload(t: ProductTemplate, d?: DesignDocument, signal?: AbortSignal): Promise<void> { await this.images(t, d, signal); }

  private drawLayers(ctx: CanvasRenderingContext2D, t: ProductTemplate, d: DesignDocument, surface: PrintSurface, images: Map<string, HTMLImageElement>, options: PreviewOptions = {}): void {
    for (const layer of d.layers.filter(l => l.surfaceId === surface.id)) {
      const asset = d.assets[layer.assetId] ?? t.assets[layer.assetId];
      const image = images.get(asset.src);
      if (!image?.complete || !image.naturalWidth) throw new EditorError('artwork-not-ready', 'An artwork image is not ready.');
      ctx.save();
      ctx.translate(layer.xMm, layer.yMm); ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.drawImage(image, -layer.widthMm / 2, -layer.heightMm / 2, layer.widthMm, layer.heightMm);
      if (options.guides && options.selectedId === layer.id) {
        ctx.strokeStyle = '#3459d1'; ctx.lineWidth = surface.widthMm / 180; ctx.setLineDash([]);
        ctx.strokeRect(-layer.widthMm / 2, -layer.heightMm / 2, layer.widthMm, layer.heightMm);
      }
      ctx.restore();
    }
  }

  private drawBinding(ctx: CanvasRenderingContext2D, rect: Rect, b: SurfaceBinding, t: ProductTemplate, d: DesignDocument, images: Map<string, HTMLImageElement>, options: PreviewOptions): void {
    const s = t.surfaces.find(surface => surface.id === b.surfaceId);
    if (!s || s.widthMm <= 0 || s.heightMm <= 0 || b.width <= 0 || b.height <= 0) return;
    ctx.save();
    ctx.translate(rect.x + (b.x + b.width / 2) * rect.width, rect.y + (b.y + b.height / 2) * rect.height);
    ctx.rotate(b.rotation * Math.PI / 180);
    ctx.scale(b.width * rect.width / s.widthMm, b.height * rect.height / s.heightMm);
    ctx.translate(-s.widthMm / 2, -s.heightMm / 2);
    ctx.save(); trimClip(ctx, s); this.drawLayers(ctx, t, d, s, images, options); ctx.restore();
    if (options.guides) {
      ctx.strokeStyle = options.activeSurfaceId === s.id ? '#3459d1' : '#65758b';
      ctx.fillStyle = 'rgba(52,89,209,.04)'; ctx.lineWidth = s.widthMm / 200; ctx.setLineDash([s.widthMm / 35, s.widthMm / 60]);
      ctx.strokeRect(0, 0, s.widthMm, s.heightMm);
      if (s.safeMm > 0) { ctx.globalAlpha = .45; ctx.strokeRect(s.safeMm, s.safeMm, s.widthMm - s.safeMm * 2, s.heightMm - s.safeMm * 2); ctx.globalAlpha = 1; }
      if (s.clip) { ctx.beginPath(); s.clip.forEach((p, i) => i ? ctx.lineTo(p.x * s.widthMm, p.y * s.heightMm) : ctx.moveTo(p.x * s.widthMm, p.y * s.heightMm)); ctx.closePath(); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** Draws a view. Without a viewport the canvas is the 960 × 800 stage; with one it is sized and transformed for an editor. */
  async renderPreview(canvas: HTMLCanvasElement, template: ProductTemplate, design: DesignDocument, viewId: string, options: PreviewOptions = {}): Promise<void> {
    const ticket = (this.generations.get(canvas) ?? 0) + 1;
    this.generations.set(canvas, ticket);
    // Snapshot structure (not image bytes) so an edit during image loading cannot tear the frame.
    const t = copyTemplate(template), d = copyDesign(design);
    const images = await this.images(t, d);
    if (this.disposed || this.generations.get(canvas) !== ticket) return;
    const view = t.views.find(v => v.id === viewId);
    const asset = view && t.assets[view.assetId];
    const vp = options.viewport;
    const width = vp ? Math.max(1, Math.round(vp.width * vp.pixelRatio)) : STAGE_WIDTH;
    const height = vp ? Math.max(1, Math.round(vp.height * vp.pixelRatio)) : STAGE_HEIGHT;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = context(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (vp) ctx.setTransform(vp.scale * vp.pixelRatio, 0, 0, vp.scale * vp.pixelRatio, vp.x * vp.pixelRatio, vp.y * vp.pixelRatio);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (!view || !asset) return;
    const image = images.get(asset.src);
    if (!image) return;
    const rect = productRect(asset);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    for (const b of view.bindings) this.drawBinding(ctx, rect, b, t, d, images, options);
  }

  /** Draws one print surface's artwork (trim area, contour applied, transparent) for use as a 3D texture. Returns false when it has no artwork. */
  async renderSurface(canvas: HTMLCanvasElement, template: ProductTemplate, design: DesignDocument, surfaceId: string, maxSize = 1024): Promise<boolean> {
    const t = copyTemplate(template), d = copyDesign(design);
    const surface = t.surfaces.find(s => s.id === surfaceId);
    if (!surface || surface.widthMm <= 0 || surface.heightMm <= 0 || !d.layers.some(l => l.surfaceId === surfaceId)) return false;
    const images = await this.images(t, d);
    if (this.disposed) return false;
    const scale = maxSize / Math.max(surface.widthMm, surface.heightMm);
    canvas.width = Math.max(1, Math.round(surface.widthMm * scale)); canvas.height = Math.max(1, Math.round(surface.heightMm * scale));
    const ctx = context(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(canvas.width / surface.widthMm, canvas.height / surface.heightMm);
    if (surface.clip) trimClip(ctx, surface);
    this.drawLayers(ctx, t, d, surface, images);
    return true;
  }

  async exportPreview(template: ProductTemplate, design: DesignDocument, viewId: string): Promise<ExportResult> {
    const t = assertTemplate(template), d = assertDesign(t, design);
    const errors = validateDesign(t, d);
    if (errors.length) throw new EditorError(errors[0].code, errors[0].message);
    if (!t.views.some(v => v.id === viewId)) throw new EditorError('invalid-view', 'Select a valid product view.');
    const canvas = document.createElement('canvas');
    try {
      await this.renderPreview(canvas, t, d, viewId);
      const blob = await canvasBlob(canvas);
      return { blob, width: canvas.width, height: canvas.height, templateRevision: t.revision };
    } finally { canvas.width = canvas.height = 0; }
  }

  async exportPrint(template: ProductTemplate, design: DesignDocument, surfaceId: string): Promise<ExportResult> {
    const t = assertTemplate(template), d = assertDesign(t, design);
    const errors = [...validateTemplate(t), ...validateDesign(t, d)];
    if (errors.length) throw new EditorError(errors[0].code, errors[0].message);
    const surface = t.surfaces.find(s => s.id === surfaceId);
    if (!surface) throw new EditorError('invalid-area', 'Select a valid print area.');
    if (!d.layers.some(l => l.surfaceId === surfaceId)) throw new EditorError('empty-export', 'Add artwork to this print area before exporting.');
    const size = exportSize(surface);
    if (size.width * size.height > MAX_EXPORT_PIXELS) throw new EditorError('export-limit', 'The print output exceeds the local export limit.');
    const images = await this.images(t, d);
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    try {
      const ctx = context(canvas);
      // Scale to the rounded output dimensions exactly; metadata records the requested physical DPI.
      ctx.scale(size.width / (surface.widthMm + 2 * surface.bleedMm), size.height / (surface.heightMm + 2 * surface.bleedMm));
      ctx.translate(surface.bleedMm, surface.bleedMm);
      if (surface.clip) trimClip(ctx, surface);
      this.drawLayers(ctx, t, d, surface, images);
      const blob = await withPngDpi(await canvasBlob(canvas), surface.dpi);
      return { blob, width: size.width, height: size.height, dpi: surface.dpi, surfaceId, templateRevision: t.revision };
    } finally { canvas.width = canvas.height = 0; }
  }

  dispose(): void {
    this.disposed = true;
    for (const cancel of this.pending.values()) cancel(new EditorError('renderer-destroyed', 'The renderer has been destroyed.'));
    this.pending.clear();
    for (const { image } of this.cache.values()) image.src = '';
    this.cache.clear();
  }
}
