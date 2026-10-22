import type { DesignDocument, ImageAsset, ImageLayer, Model3D, ModelPreset, PrintSurface, ProductTemplate, ValidationIssue } from './types.js';

export const MAX_EXPORT_PIXELS = 24_000_000;
export const MAX_IMAGE_PIXELS = 32_000_000;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const clone = <T>(value: T): T => structuredClone(value);
/** Structural copies for editor history and per-frame rendering. Asset records are treated as immutable and shared, so large source strings are not duplicated. */
export function copyTemplate(t: ProductTemplate): ProductTemplate {
  return {
    ...t, assets: { ...t.assets },
    surfaces: t.surfaces.map(s => ({ ...s, rules: { ...s.rules }, ...(s.clip ? { clip: s.clip.map(p => ({ ...p })) } : {}) })),
    views: t.views.map(v => ({ ...v, bindings: v.bindings.map(b => ({ ...b })) })),
    ...(t.model3d ? { model3d: { ...t.model3d, ...(t.model3d.size ? { size: { ...t.model3d.size } } : {}), bindings: t.model3d.bindings.map(b => ({ ...b })) } } : {}),
  };
}
export function copyDesign(d: DesignDocument): DesignDocument {
  return { ...d, assets: { ...d.assets }, layers: d.layers.map(l => ({ ...l })) };
}
export const newId = (prefix = 'mdt'): string => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500;
/** A user-facing failure with a stable code. Editors show the `errors.<code>` message from their catalog and keep `message` as the English fallback. */
export class EditorError extends Error {
  readonly code: string;
  /** True when an editor already translated `message` (with its variables) for display. */
  readonly localized: boolean;
  constructor(code: string, message: string, localized = false) { super(message); this.name = 'EditorError'; this.code = code; this.localized = localized; }
}
const check = (condition: unknown, message: string, code = 'invalid-data'): void => { if (!condition) throw new EditorError(code, message); };
const issues = (code: string, message: string, surfaceId?: string, layerId?: string): ValidationIssue => ({ code, message, surfaceId, layerId });

function checkAssets(value: unknown): asserts value is Record<string, ImageAsset> {
  check(object(value) && Object.keys(value).length <= 100, 'Invalid asset collection (maximum 100 assets).');
  for (const [id, a] of Object.entries(value as Record<string, ImageAsset>)) {
    check(object(a) && text(a.id) && a.id === id && !Object.hasOwn(Object.prototype, id) && text(a.name), 'Invalid asset identity.');
    check(a.mimeType === 'image/png' || a.mimeType === 'image/jpeg', 'Only PNG and JPEG assets are supported.', 'unsupported-asset');
    check(finite(a.width) && finite(a.height) && a.width > 0 && a.height > 0 && a.width <= 16384 && a.height <= 16384 && a.width * a.height <= MAX_IMAGE_PIXELS, 'Image dimensions exceed the supported limit.', 'image-too-large');
    check(typeof a.src === 'string' && a.src.length > 0 && a.src.length <= 64_000_000, 'Invalid asset URL.');
    let url: URL;
    try { url = new URL(a.src, 'https://mdt.invalid/'); } catch { throw new EditorError('invalid-data', 'Invalid asset URL.'); }
    check(['https:', 'http:', 'data:', 'blob:'].includes(url.protocol) && !url.username && !url.password, 'Unsupported asset URL.');
    if (url.protocol === 'data:') check(/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=\s]+$/.test(a.src), 'Invalid raster data URL.');
  }
}

/** Structural parser accepts incomplete drafts. Publication uses validateTemplate separately. */
export function assertTemplate(value: unknown): ProductTemplate {
  check(object(value) && value.schemaVersion === 1, 'Unsupported template schema. Expected version 1.', 'template-schema');
  const t = value as unknown as ProductTemplate;
  check(text(t.id) && text(t.revision) && text(t.title) && ['draft', 'published'].includes(t.status), 'Invalid template identity or status.');
  checkAssets(t.assets);
  check(Array.isArray(t.surfaces) && t.surfaces.length <= 16 && Array.isArray(t.views) && t.views.length <= 24, 'Invalid template surfaces or views.');
  const surfaceIds = new Set<string>();
  for (const s of t.surfaces) {
    check(object(s) && text(s.id) && text(s.label) && !surfaceIds.has(s.id), 'Surface IDs must be unique and labels nonempty.'); surfaceIds.add(s.id);
    for (const key of ['widthMm', 'heightMm', 'dpi', 'minDpi', 'safeMm', 'bleedMm'] as const) check(finite(s[key]), `Invalid surface ${key}.`);
    check(typeof s.required === 'boolean' && object(s.rules), 'Invalid surface rules.');
    check(['move', 'resize', 'rotate'].every(key => typeof (s.rules as unknown as Record<string, unknown>)[key] === 'boolean') && Number.isInteger(s.rules.maxLayers) && s.rules.maxLayers >= 1 && s.rules.maxLayers <= 20, 'Invalid surface permissions or layer limit.');
    if (s.clip) {
      check(Array.isArray(s.clip) && s.clip.length >= 3 && s.clip.length <= 128, 'Invalid printable polygon.');
      check(s.clip.every(p => object(p) && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), 'Polygon points must be normalized.');
    }
  }
  const viewIds = new Set<string>();
  for (const v of t.views) {
    check(object(v) && text(v.id) && text(v.label) && !viewIds.has(v.id) && typeof v.assetId === 'string', 'Invalid or duplicate product view.'); viewIds.add(v.id);
    check(Array.isArray(v.bindings) && v.bindings.length <= 16, 'Invalid surface bindings.');
    const bindings = new Set<string>();
    for (const b of v.bindings) {
      check(object(b) && text(b.surfaceId) && surfaceIds.has(b.surfaceId) && !bindings.has(b.surfaceId), 'Invalid or duplicate bound surface.'); bindings.add(b.surfaceId);
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) check(finite(b[key]), `Invalid mapping ${key}.`);
    }
  }
  if (t.model3d !== undefined) assertModel(t.model3d, surfaceIds);
  return clone(t);
}

export const MODEL_PRESETS: readonly ModelPreset[] = ['tshirt', 'hoodie', 'sweater', 'cap', 'mug', 'cushion', 'box', 'card'];
/** Printable parts of each generated shape. */
export const PRESET_PARTS: Readonly<Record<ModelPreset, readonly string[]>> = {
  tshirt: ['front', 'back', 'left-sleeve', 'right-sleeve'], hoodie: ['front', 'back', 'left-sleeve', 'right-sleeve'], sweater: ['front', 'back', 'left-sleeve', 'right-sleeve'],
  cap: ['front'], mug: ['wrap'], cushion: ['front', 'back'], box: ['front', 'back', 'left', 'right', 'top'], card: ['front', 'back'],
};
export const MAX_MODEL_BYTES = 15 * 1024 * 1024;

function assertModel(value: unknown, surfaceIds: Set<string>): void {
  const fail = 'Invalid 3D model settings.';
  check(object(value) && (value.kind === 'preset' || value.kind === 'gltf'), fail, 'model-invalid');
  const m = value as unknown as Model3D;
  check(typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color), fail, 'model-invalid');
  if (m.kind === 'preset') check(MODEL_PRESETS.includes(m.preset as ModelPreset), 'Unknown 3D model preset.', 'model-invalid');
  else {
    check(typeof m.src === 'string' && m.src.length > 0 && m.src.length <= Math.ceil(MAX_MODEL_BYTES * 4 / 3) + 64, 'The 3D model is missing or too large.', 'model-invalid');
    let url: URL;
    try { url = new URL(m.src!, 'https://mdt.invalid/'); } catch { throw new EditorError('model-invalid', 'Invalid 3D model URL.'); }
    check(['https:', 'http:', 'data:', 'blob:'].includes(url.protocol) && !url.username && !url.password, 'Unsupported 3D model URL.', 'model-invalid');
    if (url.protocol === 'data:') check(/^data:(model\/gltf-binary|application\/octet-stream);base64,[a-zA-Z0-9+/=\s]+$/.test(m.src!), 'A 3D model data URL must contain a base64 GLB file.', 'model-invalid');
  }
  check(m.name === undefined || text(m.name), fail, 'model-invalid');
  check(m.softness === undefined || (finite(m.softness) && m.softness >= 0 && m.softness <= 1), 'Invalid 3D softness.', 'model-invalid');
  check(m.size === undefined || (object(m.size) && (['width', 'height', 'depth'] as const).every(key => finite(m.size![key]) && m.size![key] > 0 && m.size![key] <= 2000)), 'Invalid 3D model size.', 'model-invalid');
  check(Array.isArray(m.bindings) && m.bindings.length <= 16, fail, 'model-invalid');
  const seen = new Set<string>();
  for (const b of m.bindings) {
    check(object(b) && text(b.surfaceId) && surfaceIds.has(b.surfaceId) && !seen.has(b.surfaceId) && text(b.part) && b.part.length <= 120, 'Invalid or duplicate 3D model print area.', 'model-invalid');
    seen.add(b.surfaceId);
    check(finite(b.x) && finite(b.y) && b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1, 'Invalid 3D model print position.', 'model-invalid');
    if (m.kind === 'gltf') check(finite(b.width) && finite(b.height) && b.width! > 0 && b.width! <= 1 && b.height! > 0 && b.height! <= 1, 'Invalid 3D model print size.', 'model-invalid');
    else check(PRESET_PARTS[m.preset as ModelPreset].includes(b.part), 'This 3D preset has no such part.', 'model-invalid');
  }
}

export function exportSize(s: PrintSurface): { width: number; height: number } {
  return { width: Math.round((s.widthMm + 2 * s.bleedMm) / 25.4 * s.dpi), height: Math.round((s.heightMm + 2 * s.bleedMm) / 25.4 * s.dpi) };
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  return Math.abs(points.reduce((a, p, i) => { const next = points[(i + 1) % points.length]; return a + p.x * next.y - p.y * next.x; }, 0) / 2);
}

export function validateTemplate(value: ProductTemplate): ValidationIssue[] {
  let t: ProductTemplate;
  try { t = assertTemplate(value); } catch (e) { return [issues('invalid-template', (e as Error).message)]; }
  const errors: ValidationIssue[] = [];
  if (!t.surfaces.length || !t.views.length) errors.push(issues('empty-template', 'Add at least one print area and product view.'));
  for (const s of t.surfaces) {
    if (s.widthMm < 1 || s.heightMm < 1 || s.widthMm > 2000 || s.heightMm > 2000 || s.dpi < 36 || s.dpi > 1200 || s.minDpi < 1 || s.minDpi > 1200 || s.bleedMm < 0 || s.bleedMm > 50 || s.safeMm < 0 || s.safeMm * 2 >= Math.min(s.widthMm, s.heightMm)) errors.push(issues('invalid-dimensions', 'Use positive print dimensions, valid DPI, and a safe inset smaller than half the area.', s.id));
    const size = exportSize(s);
    if (!size.width || !size.height || size.width * size.height > MAX_EXPORT_PIXELS || size.width > 16384 || size.height > 16384) errors.push(issues('export-limit', 'This print area exceeds the 24 megapixel local export limit. Reduce dimensions or DPI.', s.id));
    if (s.clip && polygonArea(s.clip) < .005) errors.push(issues('invalid-contour', 'The printable contour has no usable area.', s.id));
    if (s.clip && s.bleedMm > 0) errors.push(issues('contour-bleed', 'Contour clipping with bleed is not supported yet. Use zero bleed or a rectangular area.', s.id));
    if (!t.views.some(v => v.bindings.some(b => b.surfaceId === s.id))) errors.push(issues('missing-mapping', 'Connect every print area to a product view.', s.id));
  }
  for (const v of t.views) {
    if (!Object.hasOwn(t.assets, v.assetId)) errors.push(issues('missing-product-image', 'Add a product image to every view.'));
    if (!v.bindings.length) errors.push(issues('empty-view', 'Connect this product view to a print area.'));
    for (const b of v.bindings) {
      if (b.width <= .001 || b.height <= .001 || b.x < 0 || b.y < 0 || b.x + b.width > 1.00001 || b.y + b.height > 1.00001 || Math.abs(b.rotation) > 360) errors.push(issues('invalid-mapping', 'Keep the mapping rectangle within the product image.', b.surfaceId));
    }
  }
  return errors;
}

export function createDesign(t: ProductTemplate): DesignDocument {
  return { schemaVersion: 1, id: newId('design'), templateId: t.id, templateRevision: t.revision, assets: {}, layers: [] };
}

export function assertDesign(t: ProductTemplate, value: unknown): DesignDocument {
  check(object(value) && value.schemaVersion === 1, 'Unsupported design schema. Expected version 1.', 'design-schema');
  const d = value as unknown as DesignDocument;
  check(text(d.id) && d.templateId === t.id && d.templateRevision === t.revision, 'This design belongs to a different template revision.', 'design-revision');
  checkAssets(d.assets);
  check(Array.isArray(d.layers) && d.layers.length <= 320, 'Invalid artwork layers.');
  const layerIds = new Set<string>();
  for (const l of d.layers) {
    check(object(l) && text(l.id) && !layerIds.has(l.id) && t.surfaces.some(s => s.id === l.surfaceId), 'Invalid layer identity or surface.'); layerIds.add(l.id);
    check(text(l.assetId) && (Object.hasOwn(d.assets, l.assetId) || Object.hasOwn(t.assets, l.assetId)), 'Artwork asset is missing.', 'missing-asset');
    for (const key of ['xMm', 'yMm', 'widthMm', 'heightMm', 'rotation'] as const) check(finite(l[key]), `Invalid artwork ${key}.`);
    check(l.widthMm > 0 && l.heightMm > 0 && Math.abs(l.rotation) <= 360, 'Invalid artwork size or rotation.');
  }
  return clone(d);
}

export function validateDesign(t: ProductTemplate, value: DesignDocument, options: { required?: boolean } = {}): ValidationIssue[] {
  let d: DesignDocument;
  try { d = assertDesign(t, value); } catch (e) { return [issues('invalid-design', (e as Error).message)]; }
  const errors = validateTemplate(t);
  for (const s of t.surfaces) {
    const layers = d.layers.filter(l => l.surfaceId === s.id);
    if (options.required && s.required && !layers.length) errors.push(issues('missing-artwork', `Add artwork to ${s.label} before continuing.`, s.id));
    if (layers.length > s.rules.maxLayers) errors.push(issues('layer-limit', `The layer limit for ${s.label} has been exceeded.`, s.id));
    for (const l of layers) {
      const b = rotatedExtent(l);
      if (l.xMm - b.x < -s.bleedMm - .01 || l.xMm + b.x > s.widthMm + s.bleedMm + .01 || l.yMm - b.y < -s.bleedMm - .01 || l.yMm + b.y > s.heightMm + s.bleedMm + .01) errors.push(issues('artwork-outside', 'Fit the artwork inside the print boundary.', s.id, l.id));
      if (!s.rules.rotate && l.rotation !== 0) errors.push(issues('rotation-locked', 'Rotation is disabled for this print area.', s.id, l.id));
      // Locked movement/size uses a deterministic fit; imported documents cannot bypass UI permissions.
      const asset = d.assets[l.assetId] ?? t.assets[l.assetId];
      const fitted = fitLayer(asset, s, l.id);
      if (!s.rules.move && (Math.abs(l.xMm - fitted.xMm) > .01 || Math.abs(l.yMm - fitted.yMm) > .01)) errors.push(issues('position-locked', 'Position is locked to the center of this print area.', s.id, l.id));
      if (!s.rules.resize && (Math.abs(l.widthMm - fitted.widthMm) > .01 || Math.abs(l.heightMm - fitted.heightMm) > .01)) errors.push(issues('size-locked', 'Size is locked to the fitted print area.', s.id, l.id));
    }
  }
  return errors;
}

function rotatedExtent(l: ImageLayer): { x: number; y: number } {
  const angle = l.rotation * Math.PI / 180;
  return { x: (Math.abs(Math.cos(angle)) * l.widthMm + Math.abs(Math.sin(angle)) * l.heightMm) / 2, y: (Math.abs(Math.sin(angle)) * l.widthMm + Math.abs(Math.cos(angle)) * l.heightMm) / 2 };
}

export function fitLayer(asset: ImageAsset, s: PrintSurface, id = newId('layer')): ImageLayer {
  const scale = Math.min((s.widthMm - s.safeMm * 2) / asset.width, (s.heightMm - s.safeMm * 2) / asset.height);
  return { id, surfaceId: s.id, assetId: asset.id, xMm: s.widthMm / 2, yMm: s.heightMm / 2, widthMm: asset.width * scale, heightMm: asset.height * scale, rotation: 0 };
}

export function constrainLayer(value: ImageLayer, s: PrintSurface): ImageLayer {
  const l = clone(value);
  if (!s.rules.rotate) l.rotation = 0;
  l.rotation = ((l.rotation % 360) + 540) % 360 - 180;
  l.widthMm = Math.max(.1, l.widthMm); l.heightMm = Math.max(.1, l.heightMm);
  let extent = rotatedExtent(l);
  const scale = Math.min(1, (s.widthMm + 2 * s.bleedMm) / (extent.x * 2), (s.heightMm + 2 * s.bleedMm) / (extent.y * 2));
  l.widthMm *= scale; l.heightMm *= scale; extent = rotatedExtent(l);
  const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
  l.xMm = s.rules.move ? clamp(l.xMm, extent.x - s.bleedMm, s.widthMm + s.bleedMm - extent.x) : s.widthMm / 2;
  l.yMm = s.rules.move ? clamp(l.yMm, extent.y - s.bleedMm, s.heightMm + s.bleedMm - extent.y) : s.heightMm / 2;
  return l;
}

export function effectiveDpi(layer: ImageLayer, asset: ImageAsset): number {
  return Math.min(asset.width / layer.widthMm, asset.height / layer.heightMm) * 25.4;
}
