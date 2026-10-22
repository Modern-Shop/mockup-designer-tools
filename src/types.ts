export interface ImageAsset {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
}
export interface SurfaceRules { move: boolean; resize: boolean; rotate: boolean; maxLayers: number }
export interface PrintSurface {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
  minDpi: number;
  safeMm: number;
  bleedMm: number;
  required: boolean;
  rules: SurfaceRules;
  /** Normalized points in trim coordinates. A simple polygon, without holes. */
  clip?: Array<{ x: number; y: number }>;
}
/** Normalized image coordinates; x/y are top-left. Rotates clockwise around rectangle center. */
export interface SurfaceBinding { surfaceId: string; x: number; y: number; width: number; height: number; rotation: number }
export interface ProductView { id: string; label: string; assetId: string; bindings: SurfaceBinding[] }
/** Generated preview shapes. They illustrate the design; they are not a measured product model. */
export type ModelPreset = 'tshirt' | 'hoodie' | 'sweater' | 'cap' | 'mug' | 'cushion' | 'box' | 'card';
/**
 * Places a print surface on part of a 3D model. `x`/`y` are the print area's center in the part's normalized space (0..1, top-left origin).
 * Presets derive the printed size from the surface's millimeters; a glTF part uses its TEXCOORD_0 space, so `width`/`height` (also 0..1) are required.
 */
export interface ModelBinding { surfaceId: string; part: string; x: number; y: number; width?: number; height?: number }
/** Optional 3D preview. Presets are generated; `gltf` loads a prepared binary glTF (GLB) whose material names identify parts. */
export interface Model3D {
  kind: 'preset' | 'gltf';
  preset?: ModelPreset;
  /** GLB source for `gltf`: a `data:model/gltf-binary;base64,…`, https, or blob URL. */
  src?: string;
  name?: string;
  /** Preset surface color, `#rrggbb`. */
  color: string;
  /** Preset size in millimeters: garments chest width/body length/depth, cushion width/height/thickness, mug diameter/height, box width/height/depth, card width/height/thickness. Ignored for the cap. */
  size?: { width: number; height: number; depth: number };
  /** Preview-only fabric softness for the 3D pull tool: 0 is rigid, 1 is very loose. Omitted: the preset's default (rigid for mugs, boxes and cards). */
  softness?: number;
  bindings: ModelBinding[];
}
export interface ProductTemplate {
  schemaVersion: 1;
  id: string;
  revision: string;
  status: 'draft' | 'published';
  title: string;
  assets: Record<string, ImageAsset>;
  surfaces: PrintSurface[];
  views: ProductView[];
  /** Additive optional field: readers that do not know it can ignore it. */
  model3d?: Model3D;
}
/** Millimeters; xMm/yMm are the CENTER, relative to trim upper-left. Size before clockwise rotation. */
export interface ImageLayer { id: string; surfaceId: string; assetId: string; xMm: number; yMm: number; widthMm: number; heightMm: number; rotation: number }
export interface DesignDocument { schemaVersion: 1; id: string; templateId: string; templateRevision: string; assets: Record<string, ImageAsset>; layers: ImageLayer[] }
export interface ValidationIssue { code: string; message: string; surfaceId?: string; layerId?: string }
export interface ExportResult { blob: Blob; width: number; height: number; dpi?: number; surfaceId?: string; templateRevision: string }
export interface AssetAdapter {
  ingest(file: File, options?: { signal?: AbortSignal }): Promise<ImageAsset>;
  /** Optional: store an uploaded GLB and return a durable URL. Without it the builder embeds the file as a data URL. */
  ingestModel?(file: File, options?: { signal?: AbortSignal }): Promise<{ src: string; name: string }>;
}
export type EditorTheme = 'light' | 'dark' | 'auto';
export interface EditorOptions {
  locale?: string;
  direction?: 'ltr' | 'rtl';
  /** Component color scheme. `auto` follows the viewer's operating-system preference. Default: `light`. */
  theme?: EditorTheme;
  messages?: Record<string, string>;
  assets?: AssetAdapter;
}
export interface CustomerOptions extends EditorOptions { template: ProductTemplate; design?: DesignDocument }
export interface AdminOptions extends EditorOptions { template: ProductTemplate }
export interface SubmissionSnapshot { schemaVersion: 1; template: ProductTemplate; design: DesignDocument; createdAt: string }
export interface CustomerController {
  readonly element: HTMLElement;
  getDesign(): DesignDocument;
  setDesign(design: DesignDocument): Promise<void>;
  setTemplate(template: ProductTemplate): Promise<void>;
  addImage(file: File): Promise<void>;
  exportPrint(surfaceId?: string): Promise<ExportResult>;
  exportPreview(): Promise<ExportResult>;
  validate(): ValidationIssue[];
  createSnapshot(): SubmissionSnapshot;
  setTheme(theme: EditorTheme): void;
  destroy(): void;
}
export interface AdminController {
  readonly element: HTMLElement;
  getTemplate(): ProductTemplate;
  setTemplate(template: ProductTemplate): Promise<void>;
  publish(): ProductTemplate;
  setTheme(theme: EditorTheme): void;
  destroy(): void;
}
