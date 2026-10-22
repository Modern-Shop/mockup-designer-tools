import { defaultModelBinding } from '../src/presets.js';
import type { ImageAsset, Model3D, ModelPreset, PrintSurface, ProductTemplate, ProductView, SurfaceBinding } from '../src/types.js';
import type { DemoLanguage } from './i18n.js';

/** Ready-made demo products. Each has a generated 3D model; its 2D photos are rendered from that model. */
export const PRODUCTS = ['tshirt', 'hoodie', 'sweater', 'cap', 'mug', 'cushion', 'tag'] as const;
export type ProductKind = typeof PRODUCTS[number];
export const isProduct = (value: unknown): value is ProductKind => PRODUCTS.includes(value as ProductKind);

type Text = Record<ProductKind, string> & { front: string; back: string; sleeve: string; wrap: string; label: string };
/** Template data (names of products, views and print areas) belongs to the host, so the demo localizes it here. */
const labels: Record<DemoLanguage, Text> = {
  en: { tshirt: 'Classic cotton tee', hoodie: 'Fleece hoodie', sweater: 'Knit sweater', cap: 'Baseball cap', mug: 'Ceramic mug', cushion: 'Linen cushion', tag: 'Paper hang tag', front: 'Front', back: 'Back', sleeve: 'Left sleeve', wrap: 'Mug wrap', label: 'Label' },
  fa: { tshirt: 'تی‌شرت نخی کلاسیک', hoodie: 'سویشرت کلاه‌دار', sweater: 'پلیور بافتنی', cap: 'کلاه کپ', mug: 'ماگ سرامیکی', cushion: 'کوسن کتانی', tag: 'برچسب آویز کاغذی', front: 'جلو', back: 'پشت', sleeve: 'آستین چپ', wrap: 'دور ماگ', label: 'برچسب' },
  de: { tshirt: 'Klassisches Baumwoll-T-Shirt', hoodie: 'Fleece-Kapuzenpullover', sweater: 'Strickpullover', cap: 'Baseballkappe', mug: 'Keramikbecher', cushion: 'Leinenkissen', tag: 'Papier-Hängeetikett', front: 'Vorderseite', back: 'Rückseite', sleeve: 'Linker Ärmel', wrap: 'Becherumdruck', label: 'Etikett' },
};

interface Area { id: string; text: 'front' | 'back' | 'sleeve' | 'wrap' | 'label'; part: string; width: number; height: number; required?: boolean; safe?: number }
interface Spec { preset: ModelPreset; color: string; photo: [number, number]; areas: Area[]; size?: Model3D['size'] }
const SPECS: Record<ProductKind, Spec> = {
  tshirt: { preset: 'tshirt', color: '#f4f3ee', photo: [900, 1000], areas: [{ id: 'front', text: 'front', part: 'front', width: 240, height: 300, required: true }, { id: 'back', text: 'back', part: 'back', width: 260, height: 320 }] },
  hoodie: { preset: 'hoodie', color: '#3b4a5a', photo: [900, 1000], areas: [{ id: 'front', text: 'front', part: 'front', width: 260, height: 260, required: true }, { id: 'back', text: 'back', part: 'back', width: 300, height: 340 }, { id: 'sleeve', text: 'sleeve', part: 'left-sleeve', width: 70, height: 220, safe: 4 }] },
  sweater: { preset: 'sweater', color: '#a8473f', photo: [900, 1000], areas: [{ id: 'front', text: 'front', part: 'front', width: 240, height: 240, required: true }, { id: 'back', text: 'back', part: 'back', width: 280, height: 300 }] },
  cap: { preset: 'cap', color: '#1f2a36', photo: [900, 760], areas: [{ id: 'front', text: 'front', part: 'front', width: 100, height: 55, required: true, safe: 3 }] },
  mug: { preset: 'mug', color: '#fbfbf9', photo: [900, 800], size: { width: 82, height: 95, depth: 82 }, areas: [{ id: 'front', text: 'wrap', part: 'wrap', width: 90, height: 80, required: true, safe: 4 }] },
  cushion: { preset: 'cushion', color: '#e9e2d4', photo: [900, 900], areas: [{ id: 'front', text: 'front', part: 'front', width: 360, height: 360, required: true }, { id: 'back', text: 'back', part: 'back', width: 360, height: 360 }] },
  tag: { preset: 'card', color: '#fffdf6', photo: [900, 1000], size: { width: 70, height: 100, depth: 1.4 }, areas: [{ id: 'label', text: 'label', part: 'front', width: 70, height: 100, required: true, safe: 3 }] },
};

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('This browser cannot create a 2D canvas.');
  return [element, context];
}

function asset(element: HTMLCanvasElement, id: string, name: string, type: 'image/png' | 'image/jpeg' = 'image/png'): ImageAsset {
  return { id, name, src: element.toDataURL(type, .9), width: element.width, height: element.height, mimeType: type };
}

// Procedural photos, used when the browser cannot render the 3D model.
function shirtPhoto(back: boolean): HTMLCanvasElement {
  const [element, ctx] = canvas(900, 1040);
  const backdrop = ctx.createLinearGradient(0, 0, 900, 1040);
  backdrop.addColorStop(0, '#f2f0eb');
  backdrop.addColorStop(1, '#e8e9e2');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, 900, 1040);
  const shirt = new Path2D('M320 133 L371 117 Q450 161 529 117 L580 133 L770 256 L697 423 L600 377 L621 907 Q450 931 279 907 L300 377 L203 423 L130 256 Z');
  ctx.save();
  ctx.shadowColor = '#16212622';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#faf9f4';
  ctx.fill(shirt);
  ctx.restore();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#e6e4dd';
  ctx.beginPath();
  ctx.moveTo(372, 125);
  ctx.quadraticCurveTo(450, back ? 166 : 228, 528, 125);
  ctx.stroke();
  return element;
}
function mugPhoto(): HTMLCanvasElement {
  const [element, ctx] = canvas(900, 800);
  const backdrop = ctx.createLinearGradient(0, 0, 0, 800);
  backdrop.addColorStop(0, '#eef0f2'); backdrop.addColorStop(1, '#e2e4e6');
  ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 900, 800);
  ctx.lineWidth = 46; ctx.strokeStyle = '#e9e9e6';
  ctx.beginPath(); ctx.moveTo(612, 300); ctx.bezierCurveTo(760, 290, 760, 545, 612, 535); ctx.stroke();
  const body = ctx.createLinearGradient(250, 0, 615, 0);
  body.addColorStop(0, '#d8d8d4'); body.addColorStop(.18, '#fbfbf9'); body.addColorStop(.55, '#ffffff'); body.addColorStop(.86, '#efefec'); body.addColorStop(1, '#cfcfcb');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.moveTo(250, 210); ctx.lineTo(250, 610); ctx.quadraticCurveTo(250, 642, 432, 642); ctx.quadraticCurveTo(615, 642, 615, 610); ctx.lineTo(615, 210); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ecece9'; ctx.beginPath(); ctx.ellipse(432.5, 210, 182.5, 34, 0, 0, Math.PI * 2); ctx.fill();
  return element;
}
/** A neutral studio card with a soft product silhouette, for products without a hand-drawn fallback. */
function plainPhoto(width: number, height: number, color: string): HTMLCanvasElement {
  const [element, ctx] = canvas(width, height);
  const backdrop = ctx.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#f3f2ee'); backdrop.addColorStop(1, '#e4e3de');
  ctx.fillStyle = backdrop; ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = '#1621262a'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(width * .18, height * .14, width * .64, height * .72, 48); ctx.fill();
  ctx.restore();
  return element;
}
function fallbackPhoto(kind: ProductKind, spec: Spec, area: Area): { image: HTMLCanvasElement; binding: Omit<SurfaceBinding, 'surfaceId'> } {
  if (kind === 'tshirt' || kind === 'hoodie' || kind === 'sweater') {
    if (area.part === 'front' || area.part === 'back') return { image: shirtPhoto(area.part === 'back'), binding: { x: .36, y: .3, width: .28, height: .303 * area.height / area.width * 240 / 300, rotation: 0 } };
  }
  if (kind === 'mug') return { image: mugPhoto(), binding: { x: .342, y: .39, width: .278, height: .278, rotation: 0 } };
  const [width, height] = spec.photo, image = plainPhoto(width, height, spec.color);
  // Center the print area on the silhouette with its real aspect ratio.
  const scale = Math.min(width * .5 / area.width, height * .56 / area.height);
  const w = area.width * scale / width, h = area.height * scale / height;
  return { image, binding: { x: .5 - w / 2, y: .5 - h / 2, width: w, height: h, rotation: 0 } };
}

const photoCache = new Map<ProductKind, Promise<Array<{ part: string; image: HTMLCanvasElement; bindings: SurfaceBinding[] }> | null>>();
/** Studio photos rendered from the product's 3D model, cached per product; null without WebGL2. */
function renderPhotos(kind: ProductKind, model: Model3D, surfaces: PrintSurface[]) {
  let photos = photoCache.get(kind);
  if (!photos) {
    const [width, height] = SPECS[kind].photo;
    photos = import('../src/model3d.js')
      .then(({ renderProductPhotos }) => renderProductPhotos(model, surfaces, { width, height }))
      .catch(() => null);
    photoCache.set(kind, photos);
  }
  return photos;
}

export async function createProduct(kind: ProductKind, language: DemoLanguage = 'en'): Promise<ProductTemplate> {
  const text = labels[language], spec = SPECS[kind];
  // Localized starters are different template content, so they carry their own revision.
  const revision = language === 'en' ? 'starter-2' : `starter-2-${language}`;
  const surfaces: PrintSurface[] = spec.areas.map(area => ({
    id: area.id, label: text[area.text], widthMm: area.width, heightMm: area.height, dpi: 300, minDpi: 150, safeMm: area.safe ?? 8, bleedMm: 0,
    required: !!area.required, rules: { move: true, resize: true, rotate: true, maxLayers: 8 },
  }));
  const model: Model3D = { kind: 'preset', preset: spec.preset, color: spec.color, ...(spec.size ? { size: spec.size } : {}), bindings: spec.areas.map(area => defaultModelBinding(spec.preset, area.id, area.part)) };
  const assets: Record<string, ImageAsset> = {};
  const views: ProductView[] = [];
  const photos = await renderPhotos(kind, model, surfaces);
  for (const area of spec.areas) {
    const label = area.text === 'label' ? text.front : text[area.text];
    const id = `${kind}-${area.part}`;
    if (views.some(view => view.id === `${id}-view`)) continue;
    const photo = photos?.find(item => item.part === area.part);
    if (photo && photo.bindings.length) {
      assets[`${id}-photo`] = asset(photo.image, `${id}-photo`, `${text[kind]} · ${label}`, 'image/jpeg');
      views.push({ id: `${id}-view`, label, assetId: `${id}-photo`, bindings: photo.bindings.map(binding => ({ ...binding })) });
    } else {
      const fallback = fallbackPhoto(kind, spec, area);
      assets[`${id}-photo`] = asset(fallback.image, `${id}-photo`, `${text[kind]} · ${label}`);
      views.push({ id: `${id}-view`, label, assetId: `${id}-photo`, bindings: [{ surfaceId: area.id, ...fallback.binding }] });
    }
  }
  return { schemaVersion: 1, id: `demo-${kind}`, revision, status: 'published', title: text[kind], assets, surfaces, views, model3d: model };
}

/** A small square preview of a product for the gallery, from its first photo. */
export async function productThumbnail(kind: ProductKind, size = 112): Promise<string | null> {
  const spec = SPECS[kind];
  const surfaces = spec.areas.map(area => ({ id: area.id, label: area.id, widthMm: area.width, heightMm: area.height, dpi: 300, minDpi: 150, safeMm: 3, bleedMm: 0, required: false, rules: { move: true, resize: true, rotate: true, maxLayers: 8 } }));
  const model: Model3D = { kind: 'preset', preset: spec.preset, color: spec.color, ...(spec.size ? { size: spec.size } : {}), bindings: spec.areas.map(area => defaultModelBinding(spec.preset, area.id, area.part)) };
  const photo = (await renderPhotos(kind, model, surfaces))?.[0];
  if (!photo) return null;
  const [element, ctx] = canvas(size * 2, size * 2);
  const crop = Math.min(photo.image.width, photo.image.height) * .82;
  ctx.drawImage(photo.image, (photo.image.width - crop) / 2, (photo.image.height - crop) / 2, crop, crop, 0, 0, size * 2, size * 2);
  return element.toDataURL('image/jpeg', .85);
}

export async function sampleArtwork(): Promise<File> {
  const [element, ctx] = canvas(1400, 1800);
  ctx.fillStyle = '#243b48';
  ctx.beginPath();
  ctx.roundRect(10, 10, 1380, 1780, 44);
  ctx.fill();
  ctx.fillStyle = '#eab78b';
  ctx.beginPath();
  ctx.arc(700, 520, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#263d49';
  ctx.beginPath();
  ctx.moveTo(340, 681);
  ctx.lineTo(545, 410);
  ctx.lineTo(755, 680);
  ctx.lineTo(860, 549);
  ctx.lineTo(1090, 840);
  ctx.lineTo(340, 840);
  ctx.fill();
  ctx.fillStyle = '#f8f0df';
  ctx.textAlign = 'center';
  ctx.font = '500 150px Georgia, serif';
  ctx.fillText('MAKE', 700, 1130);
  ctx.fillText('ROOM', 700, 1320);
  ctx.font = '400 43px system-ui, sans-serif';
  ctx.letterSpacing = '12px';
  ctx.fillText('FOR THE OUTSIDE', 700, 1510);
  const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare the sample artwork.')), 'image/png'));
  return new File([blob], 'make-room.png', { type: 'image/png' });
}
