import { clone, createDesign } from '../src/core.js';
import { Renderer, mapPointToSurface } from '../src/render.js';
import { mountCustomer } from '../src/customer.js';
import { mountAdmin } from '../src/admin.js';
import type { DesignDocument, ExportResult, ImageAsset, ProductTemplate } from '../src/types.js';
import { fa } from '../src/locales/fa.js';

const results = document.querySelector<HTMLPreElement>('#results')!;
const summary = document.querySelector<HTMLParagraphElement>('#summary')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const fixtures = document.querySelector<HTMLDivElement>('#fixtures')!;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function coloredAsset(id: string, color: string): ImageAsset {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 64);
  return { id, name: `${id}.png`, src: canvas.toDataURL('image/png'), width: 64, height: 64, mimeType: 'image/png' };
}
function rasterFile(asset: ImageAsset, name = asset.name): File {
  const encoded = atob(asset.src.split(',')[1]);
  return new File([Uint8Array.from(encoded, char => char.charCodeAt(0))], name, { type: asset.mimeType });
}
async function jpegFiles(): Promise<{ plain: File; rotated: File }> {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#e12b37'; context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#2758c4'; context.fillRect(32, 0, 32, 32);
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encoding is unavailable.')), 'image/jpeg', 1));
  check(jpeg.type === 'image/jpeg', 'The browser did not encode a genuine JPEG fixture.');
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  // APP1 Exif: little-endian TIFF, one SHORT orientation entry = 6 (90° clockwise).
  const exif = new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return {
    plain: new File([bytes], 'plain-asymmetric.jpg', { type: 'image/jpeg' }),
    rotated: new File([bytes.slice(0, 2), exif, bytes.slice(2)], 'exif-orientation-6.jpg', { type: 'image/jpeg' }),
  };
}
function fixture(): { template: ProductTemplate; design: DesignDocument } {
  const base = coloredAsset('product-photo', '#d2dce6');
  const artwork = coloredAsset('artwork', '#e12b37');
  const template: ProductTemplate = {
    schemaVersion: 1, id: 'pixel-fixture', revision: 'revision-1', status: 'published', title: 'Pixel fixture',
    assets: { [base.id]: base },
    surfaces: [{ id: 'front', label: 'Front', widthMm: 25.4, heightMm: 25.4, dpi: 100, minDpi: 1, safeMm: 0, bleedMm: 2.54, required: true, rules: { move: true, resize: true, rotate: true, maxLayers: 4 } }],
    views: [{ id: 'front-view', label: 'Front', assetId: base.id, bindings: [{ surfaceId: 'front', x: .2, y: .2, width: .6, height: .6, rotation: 0 }] }],
  };
  const design = createDesign(template);
  design.assets[artwork.id] = artwork;
  design.layers.push({ id: 'red-square', surfaceId: 'front', assetId: artwork.id, xMm: 12.7, yMm: 12.7, widthMm: 12.7, heightMm: 12.7, rotation: 0 });
  return { template, design };
}
async function pixels(result: ExportResult) {
  const bitmap = await createImageBitmap(result.blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
  return { width: canvas.width, height: canvas.height, at: (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data] };
}
async function testPrintPixels() {
  const { template, design } = fixture();
  const renderer = new Renderer();
  try {
    const result = await renderer.exportPrint(template, design, 'front');
    const image = await pixels(result);
    check(image.width === 120 && image.height === 120, `Expected 120×120 including bleed, got ${image.width}×${image.height}.`);
    check(image.at(0, 0)[3] === 0, 'Print output must have a transparent corner, without the product photo.');
    const center = image.at(60, 60);
    check(center[0] === 225 && center[1] === 43 && center[2] === 55 && center[3] === 255, 'Print center does not match original artwork pixels.');
    check(result.templateRevision === 'revision-1', 'Print metadata must identify the frozen template revision.');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    let offset = 8;
    let found = false;
    while (offset + 12 <= bytes.length) {
      const view = new DataView(bytes.buffer, offset);
      const length = view.getUint32(0);
      const name = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (name === 'pHYs') {
        const xPpm = view.getUint32(8);
        const yPpm = view.getUint32(12);
        check(Math.abs(xPpm * .0254 - 100) < .1 && xPpm === yPpm && bytes[offset + 16] === 1, 'PNG pHYs metadata must represent 100 DPI.');
        found = true; break;
      }
      offset += 12 + length;
    }
    check(found, 'Print PNG is missing pHYs resolution metadata.');
  } finally { renderer.dispose(); }
}
async function testPreviewPixels() {
  const { template, design } = fixture();
  const renderer = new Renderer();
  try {
    const result = await renderer.exportPreview(template, design, 'front-view');
    const image = await pixels(result);
    const productPixel = image.at(Math.floor(image.width * .2), Math.floor(image.height * .2));
    check(productPixel[0] === 210 && productPixel[1] === 220 && productPixel[2] === 230 && productPixel[3] === 255, 'Preview must include the product photo.');
    const center = image.at(Math.floor(image.width / 2), Math.floor(image.height / 2));
    check(center[0] === 225 && center[1] === 43 && center[2] === 55, 'Preview center must map the same artwork as print output.');
    const point = mapPointToSurface(template, 'front-view', 'front', .5, .5);
    check(point && Math.abs(point.xMm - 12.7) < .00001 && Math.abs(point.yMm - 12.7) < .00001, 'View inverse mapping must preserve physical coordinates.');
  } finally { renderer.dispose(); }
}
async function testContourPixels() {
  const { template, design } = fixture();
  template.surfaces[0].bleedMm = 0;
  template.surfaces[0].clip = [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }];
  design.layers[0].widthMm = 25.4;
  design.layers[0].heightMm = 25.4;
  const renderer = new Renderer();
  try {
    const image = await pixels(await renderer.exportPrint(template, design, 'front'));
    check(image.width === 100 && image.height === 100, 'Contour output has unexpected dimensions.');
    check(image.at(5, 5)[3] === 0, 'Artwork outside the diamond contour must be transparent.');
    check(image.at(50, 50)[3] === 255, 'Artwork inside the contour was unexpectedly removed.');
  } finally { renderer.dispose(); }
}
async function testAssetIdScopes() {
  const { template, design } = fixture();
  const sharedId = template.views[0].assetId;
  const artwork = design.assets.artwork;
  design.assets = { [sharedId]: { ...artwork, id: sharedId } };
  design.layers[0].assetId = sharedId;
  const renderer = new Renderer();
  try {
    const image = await pixels(await renderer.exportPreview(template, design, 'front-view'));
    const productPixel = image.at(Math.floor(image.width * .2), Math.floor(image.height * .2));
    const artworkPixel = image.at(Math.floor(image.width / 2), Math.floor(image.height / 2));
    check(productPixel[0] === 210 && productPixel[1] === 220 && productPixel[2] === 230, 'A design asset sharing the photo ID must not replace the product photo.');
    check(artworkPixel[0] === 225 && artworkPixel[1] === 43 && artworkPixel[2] === 55, 'A template asset sharing the artwork ID must not replace customer artwork.');
    const print = await pixels(await renderer.exportPrint(template, design, 'front'));
    check(print.at(60, 60)[0] === 225 && print.at(0, 0)[3] === 0, 'Scoped asset identities must also preserve the independent print output.');
  } finally { renderer.dispose(); }
}
async function testCachedManifestValidation() {
  const { template, design } = fixture();
  const renderer = new Renderer();
  const firstLoadRenderer = new Renderer();
  async function mustReject(operation: Promise<void>, message: string) {
    let rejected = false;
    try { await operation; } catch { rejected = true; }
    check(rejected, message);
  }
  try {
    await renderer.preload(template, design);
    const wrongArtwork = clone(design);
    wrongArtwork.assets.artwork.width = 63;
    await mustReject(renderer.preload(template, wrongArtwork), 'A decoded source cache must not bypass a later artwork width mismatch.');
    const wrongPhoto = clone(template);
    wrongPhoto.assets['product-photo'].height = 63;
    await mustReject(renderer.preload(wrongPhoto, design), 'Every template photo manifest must be checked even when its source was decoded earlier.');
    const duplicate = clone(design);
    duplicate.assets['same-source-alias'] = { ...duplicate.assets.artwork, id: 'same-source-alias', width: 63 };
    await mustReject(renderer.preload(template, duplicate), 'Two references to one source must each have their dimensions checked.');
    await renderer.preload(template, design);
    const image = await pixels(await renderer.exportPreview(template, design, 'front-view'));
    check(image.at(Math.floor(image.width / 2), Math.floor(image.height / 2))[0] === 225, 'A corrected manifest must render after a cached-source validation failure.');
    await mustReject(firstLoadRenderer.preload(template, wrongArtwork), 'A first-load dimension mismatch must be rejected.');
    await firstLoadRenderer.preload(template, design);
    const recovered = await firstLoadRenderer.exportPreview(template, design, 'front-view');
    check(recovered.blob.size > 0, 'Correcting an initially wrong manifest must not leave a poisoned cache entry.');
  } finally { renderer.dispose(); firstLoadRenderer.dispose(); }
}
async function testIsolationAndLifecycle() {
  const { template, design } = fixture();
  const first = document.createElement('div');
  const second = document.createElement('div');
  const third = document.createElement('div');
  fixtures.append(first, second, third);
  const hostButton = document.createElement('button');
  hostButton.textContent = 'Host button';
  fixtures.prepend(hostButton);
  const hostile = document.createElement('style');
  hostile.textContent = '#fixtures button {background:rgb(255,0,255)!important;font-size:48px!important;border:9px solid red!important} #fixtures * {letter-spacing:3px}';
  document.head.append(hostile);
  const baseline = getComputedStyle(hostButton).cssText || `${getComputedStyle(hostButton).backgroundColor}:${getComputedStyle(hostButton).fontSize}`;
  const a = await mountCustomer(first, { template: clone(template), design: clone(design) });
  const b = await mountCustomer(second, { template: clone(template), locale: 'fa', direction: 'rtl' });
  const merchant = await mountAdmin(third, { template: clone(template) });
  try {
    const insideButton = a.element.shadowRoot?.querySelector('button');
    check(insideButton, 'The customer component must own an isolated shadow tree.');
    check(getComputedStyle(insideButton).backgroundColor !== 'rgb(255, 0, 255)', 'Host button styling leaked into the component.');
    check(getComputedStyle(insideButton).fontSize !== '48px', 'Host font sizing leaked into a component control.');
    check(getComputedStyle(insideButton).letterSpacing === 'normal', 'Inherited host letter-spacing must be reset inside the component.');
    const after = getComputedStyle(hostButton).cssText || `${getComputedStyle(hostButton).backgroundColor}:${getComputedStyle(hostButton).fontSize}`;
    check(after === baseline, 'Mounting the component changed the host button.');
    check(a.getDesign().layers.length === 1 && b.getDesign().layers.length === 0, 'Customer state must be independent between instances.');
    check(b.element.shadowRoot?.querySelector('[dir="rtl"]') || b.element.dir === 'rtl', 'Explicit per-instance RTL direction was not applied.');
    const roundTrip = JSON.parse(JSON.stringify(a.getDesign()));
    await a.setDesign(roundTrip);
    check(JSON.stringify(a.getDesign()) === JSON.stringify(roundTrip), 'Save/restore changed physical artwork placement.');
    const snapshot = a.createSnapshot();
    const originalWidth = snapshot.template.surfaces[0].widthMm;
    const changed = merchant.getTemplate(); changed.surfaces[0].widthMm += 1;
    await merchant.setTemplate(changed);
    check(snapshot.template.surfaces[0].widthMm === originalWidth, 'Later merchant changes mutated a confirmed design snapshot.');
    let rejected = false;
    try { await a.setDesign({ ...roundTrip, templateRevision: 'wrong-revision' }); } catch { rejected = true; }
    check(rejected && a.getDesign().templateRevision === template.revision, 'Mismatched restore must fail without corrupting the active design.');
    a.destroy(); a.destroy();
    check(!first.contains(a.element), 'Destroy must remove the component host.');
    check(b.getDesign().layers.length === 0, 'Destroying one editor must leave another editor usable.');
    await b.addImage(rasterFile(design.assets.artwork, 'real-upload.png'));
    check(b.getDesign().layers.length === 1, 'The real image upload path did not add an artwork layer.');
    let unsupportedRejected = false;
    try { await b.addImage(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'unsupported.svg', { type: 'image/svg+xml' })); } catch { unsupportedRejected = true; }
    check(unsupportedRejected && b.getDesign().layers.length === 1, 'Unsupported input must be rejected without losing the working artwork.');
    const jpeg = await jpegFiles();
    await b.addImage(jpeg.plain);
    const plainDesign = b.getDesign();
    const plainLayer = plainDesign.layers[plainDesign.layers.length - 1];
    const plain = plainDesign.assets[plainLayer.assetId];
    check(plain.width === 64 && plain.height === 32 && plain.mimeType === 'image/png', 'A genuine JPEG upload must normalize to a 64×32 PNG asset.');
    const plainPixels = await pixels({ blob: rasterFile(plain), width: plain.width, height: plain.height, templateRevision: template.revision });
    check(plainPixels.at(8, 16)[0] > 180 && plainPixels.at(56, 16)[2] > 150, 'Normal JPEG upload lost its asymmetric red/blue content.');
    await b.addImage(jpeg.rotated);
    const rotatedDesign = b.getDesign();
    const rotatedLayer = rotatedDesign.layers[rotatedDesign.layers.length - 1];
    const rotated = rotatedDesign.assets[rotatedLayer.assetId];
    check(rotated.width === 32 && rotated.height === 64, 'EXIF orientation 6 must normalize the uploaded image to 32×64.');
    const orientedPixels = await pixels({ blob: rasterFile(rotated), width: rotated.width, height: rotated.height, templateRevision: template.revision });
    check(orientedPixels.at(16, 8)[0] > 180 && orientedPixels.at(16, 56)[2] > 150 && orientedPixels.at(16, 32)[3] === 255, 'EXIF-normalized artwork must be nonblank and rotate red/blue content clockwise.');
    const output = await b.exportPreview();
    check(output.blob.size > 0, 'The remaining editor could not render after another was destroyed.');
  } finally {
    a.destroy(); b.destroy(); merchant.destroy(); hostile.remove();
    fixtures.replaceChildren();
  }
}

async function testDirectManipulation() {
  const { template, design } = fixture();
  const host = document.createElement('div');
  host.style.width = '1200px';
  fixtures.append(host);
  const editor = await mountCustomer(host, { template: clone(template), design: clone(design) });
  const merchantHost = document.createElement('div');
  fixtures.append(merchantHost);
  const merchant = await mountAdmin(merchantHost, { template: clone(template) });
  try {
    const root = editor.element.shadowRoot!;
    await new Promise(resolve => setTimeout(resolve, 120));
    const stage = root.querySelector<HTMLElement>('.mdt-stage')!;
    const handle = root.querySelector<SVGElement>('[data-mdt-handle="se"]');
    check(handle, 'A selected artwork must expose on-canvas resize handles.');
    const rect = handle.getBoundingClientRect();
    const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const pointer = (type: string, x: number, y: number, target: Element) => target.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, composed: true }));
    const before = editor.getDesign().layers[0];
    pointer('pointerdown', start.x, start.y, handle);
    pointer('pointermove', start.x + 40, start.y + 25, stage);
    pointer('pointerup', start.x + 40, start.y + 25, stage);
    const after = editor.getDesign().layers[0];
    check(after.widthMm > before.widthMm + 1, 'Dragging a corner handle must enlarge the artwork.');
    check(Math.abs(after.widthMm / after.heightMm - before.widthMm / before.heightMm) < 1e-6, 'Corner resizing must keep the artwork proportions.');
    check(Math.abs((after.xMm - after.widthMm / 2) - (before.xMm - before.widthMm / 2)) < .01 && Math.abs((after.yMm - after.heightMm / 2) - (before.yMm - before.heightMm / 2)) < .01, 'The opposite corner must stay fixed while resizing.');
    root.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    check(JSON.stringify(editor.getDesign().layers[0]) === JSON.stringify(before), 'Ctrl+Z must restore the artwork before the drag.');
    const merchantRoot = merchant.element.shadowRoot!;
    const title = merchantRoot.querySelector<HTMLInputElement>('.mdt-title-input')!;
    title.value = 'Renamed product';
    title.dispatchEvent(new Event('change', { bubbles: true }));
    check(merchant.getTemplate().title === 'Renamed product' && merchant.getTemplate().status === 'draft', 'Renaming must start a draft revision.');
    merchantRoot.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    check(merchant.getTemplate().title === template.title && merchant.getTemplate().revision === template.revision, 'Undo must restore the merchant template and its published revision.');
  } finally { editor.destroy(); merchant.destroy(); fixtures.replaceChildren(); }
}

/** Collects what a person can read or hear: visible text, accessible names, tooltips, and shortcut hints. */
function readableText(root: ShadowRoot): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const parent = current.parentElement;
    if (parent && !parent.closest('style') && current.textContent?.trim()) out.push(current.textContent.trim());
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[aria-label],[data-mdt-tip],[data-mdt-kbd]'))) {
    for (const name of ['aria-label', 'data-mdt-tip', 'data-mdt-kbd']) { const value = element.getAttribute(name); if (value) out.push(value); }
  }
  return out;
}
async function testPersianCatalog() {
  const { template, design } = fixture();
  // Template data is host content; give it Persian names so any Latin word left must come from the editors.
  template.title = 'محصول آزمایشی';
  template.surfaces[0].label = 'جلو';
  template.views[0].label = 'نمای جلو';
  template.assets[template.views[0].assetId].name = 'عکس محصول';
  design.assets.artwork.name = 'طرح قرمز';
  template.model3d = { kind: 'preset', preset: 'card', color: '#ffffff', size: { width: 25.4, height: 25.4, depth: 1 }, bindings: [{ surfaceId: 'front', part: 'front', x: .5, y: .5 }] };
  const options = { locale: 'fa', direction: 'rtl' as const, messages: fa };
  const host = document.createElement('div');
  host.style.width = '1300px';
  const merchantHost = document.createElement('div');
  merchantHost.style.width = '1300px';
  fixtures.append(host, merchantHost);
  const editor = await mountCustomer(host, { template: clone(template), design: clone(design), ...options });
  const merchant = await mountAdmin(merchantHost, { template: clone(template), ...options });
  // Latin that is legitimately shown: file formats, units, axis names, physical key caps, and the product-neutral brand of image formats.
  const allowed = new Set(['DPI', 'PNG', 'JPEG', 'JSON', 'GLB', 'UV', 'CORS', 'Canvas', 'X', 'Y', 'Ctrl', 'Shift', 'Alt', 'Space', 'Esc', 'Del', 'V', 'H', 'D', 'Z']);
  const english: string[] = [];
  const scan = (root: ShadowRoot, where: string) => {
    for (const text of readableText(root)) {
      const words = (text.match(/[A-Za-z]{1,}/g) ?? []).filter(word => !allowed.has(word));
      if (words.length) english.push(`${where}: “${text}”`);
    }
  };
  try {
    const shopper = editor.element.shadowRoot!, builder = merchant.element.shadowRoot!;
    await new Promise(resolve => setTimeout(resolve, 150));
    scan(shopper, 'customer');
    for (const tab of Array.from(shopper.querySelectorAll<HTMLButtonElement>('.mdt-rail-item'))) { if (!/میان‌برها/.test(tab.textContent ?? '')) { tab.click(); scan(shopper, 'customer panel'); } }
    shopper.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, composed: true }));
    scan(shopper, 'customer shortcuts');
    shopper.querySelector<HTMLElement>('.mdt-dialog [aria-label]')?.click();
    shopper.querySelector<HTMLButtonElement>('.mdt-top-actions .mdt-btn-primary:not([hidden])')!.click();
    scan(shopper, 'customer preview');
    shopper.querySelector<HTMLButtonElement>('[data-view="mdt-3d"]')!.click();
    for (let i = 0; i < 60 && shopper.querySelector('.mdt-view3d-card[data-busy="true"]'); i++) await new Promise(resolve => setTimeout(resolve, 100));
    scan(shopper, 'customer 3D');
    for (let index = 0; index < 5; index++) {
      builder.querySelectorAll<HTMLButtonElement>('.mdt-step')[index].click();
      await new Promise(resolve => setTimeout(resolve, 20));
      scan(builder, `admin step ${index + 1}`);
    }
    check(english.length === 0, `Untranslated text in Persian mode: ${english.slice(0, 6).join(' | ')}`);
    check(shopper.querySelector('.mdt-shell')?.getAttribute('dir') === 'rtl' && builder.querySelector('.mdt-zoom-value')?.textContent?.includes('٪'), 'Persian mode must use RTL and Persian number formatting.');
  } finally { editor.destroy(); merchant.destroy(); fixtures.replaceChildren(); }
}

async function test3dPreview() {
  const { template, design } = fixture();
  // A card exactly the print area's size, so the artwork's center lands at the center of the render.
  template.model3d = { kind: 'preset', preset: 'card', color: '#ffffff', size: { width: 25.4, height: 25.4, depth: 1 }, bindings: [{ surfaceId: 'front', part: 'front', x: .5, y: .5 }] };
  const host = document.createElement('div');
  host.style.width = '1100px';
  const merchantHost = document.createElement('div');
  merchantHost.style.width = '1300px';
  fixtures.append(host, merchantHost);
  const editor = await mountCustomer(host, { template: clone(template), design: clone(design) });
  const merchant = await mountAdmin(merchantHost, { template: { ...clone(fixture().template), status: 'draft' } });
  try {
    const root = editor.element.shadowRoot!;
    const before = JSON.stringify(editor.getDesign());
    root.querySelector<HTMLButtonElement>('[data-view="mdt-3d"]')!.click();
    for (let i = 0; i < 80 && (!root.querySelector('.mdt-view3d-canvas') || root.querySelector('.mdt-view3d-card')); i++) await new Promise(resolve => setTimeout(resolve, 100));
    check(!root.querySelector('.mdt-view3d-card'), `3D view did not load: ${root.querySelector('.mdt-view3d-card')?.textContent}`);
    await new Promise(resolve => setTimeout(resolve, 1300));
    const shot = await editor.exportPreview();
    const image = await pixels(shot);
    let covered = 0;
    for (let y = 0; y < image.height; y += 8) for (let x = 0; x < image.width; x += 8) if (image.at(x, y)[3] > 200) covered++;
    check(covered > 200, 'The 3D render must draw the model.');
    const center = image.at(Math.floor(image.width / 2), Math.floor(image.height / 2));
    check(center[0] > 150 && center[1] < 110 && center[3] > 200, `The artwork must be textured onto the model (center ${center.join(',')}).`);
    check(JSON.stringify(editor.getDesign()) === before, 'Opening the 3D view must not change print placement.');
    root.querySelector<HTMLButtonElement>('[data-view="front-view"]')!.click();
    check(!root.querySelector('.mdt-shell')!.hasAttribute('data-mdt-view'), 'Choosing a photo view must leave 3D mode.');
    const builder = merchant.element.shadowRoot!;
    const shape = builder.querySelector<HTMLSelectElement>('select[data-mdt-key="model-kind"]')!;
    shape.value = 'mug'; shape.dispatchEvent(new Event('change', { bubbles: true }));
    const model = merchant.getTemplate().model3d;
    check(model?.kind === 'preset' && model.preset === 'mug' && model.bindings[0]?.part === 'wrap', 'Choosing a 3D shape must add a mapped model to the template.');
    await new Promise(resolve => setTimeout(resolve, 30));
    check(!!builder.querySelector('[data-mdt-key="view-3d"]'), 'The builder must list the 3D model with the views.');
  } finally { editor.destroy(); merchant.destroy(); fixtures.replaceChildren(); }
}

async function testSoftProducts() {
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const { template, design } = fixture();
  template.surfaces[0] = { ...template.surfaces[0], widthMm: 200, heightMm: 200 };
  design.layers[0] = { ...design.layers[0], xMm: 100, yMm: 100, widthMm: 120, heightMm: 120 };
  template.model3d = { kind: 'preset', preset: 'hoodie', color: '#7a8a99', bindings: [{ surfaceId: 'front', part: 'front', x: .5, y: .38 }] };
  const host = document.createElement('div');
  host.style.width = '1100px';
  const merchantHost = document.createElement('div');
  merchantHost.style.width = '1300px';
  fixtures.append(host, merchantHost);
  const editor = await mountCustomer(host, { template: clone(template), design: clone(design) });
  const merchant = await mountAdmin(merchantHost, { template: { ...clone(template), status: 'draft' } });
  try {
    const root = editor.element.shadowRoot!;
    const before = JSON.stringify(editor.getDesign());
    root.querySelector<HTMLButtonElement>('[data-view="mdt-3d"]')!.click();
    for (let i = 0; i < 100 && (!root.querySelector('.mdt-view3d-canvas') || root.querySelector('.mdt-view3d-card')); i++) await wait(100);
    check(!root.querySelector('.mdt-view3d-card'), `3D view did not load: ${root.querySelector('.mdt-view3d-card')?.textContent}`);
    await wait(1200);
    const pullButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.mdt-view3d-bar button')).find(button => button.getAttribute('aria-label') === 'Pull fabric');
    check(pullButton && !pullButton.hidden, 'A garment must offer the pull tool.');
    pullButton.click();
    const canvas = root.querySelector<HTMLCanvasElement>('.mdt-view3d-canvas')!;
    check(canvas.dataset.mdtTool === 'pull' && !root.querySelector<HTMLElement>('.mdt-view3d-soft')!.hidden, 'The pull tool must be active with its looseness control.');
    const rest = await pixels(await editor.exportPreview());
    const box = canvas.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height * .62;
    const pointer = (type: string, dx: number, dy: number) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y + dy, bubbles: true }));
    pointer('pointerdown', 0, 0);
    for (let i = 1; i <= 12; i++) { pointer('pointermove', i * 14, i * 6); await wait(25); }
    await wait(500);
    const pulled = await pixels(await editor.exportPreview());
    let changed = 0;
    for (let py = 0; py < rest.height; py += 6) for (let px = 0; px < rest.width; px += 6) {
      const a = rest.at(px, py), b = pulled.at(px, py);
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) > 40) changed++;
    }
    pointer('pointerup', 168, 72);
    check(changed > 60, `Pulling the fabric must deform the model (${changed} samples changed).`);
    check(JSON.stringify(editor.getDesign()) === before, 'Pulling the fabric must not change the design.');
    // A rigid product hides the tool.
    const mug = clone(template);
    mug.revision = 'revision-mug';
    mug.model3d = { kind: 'preset', preset: 'mug', color: '#ffffff', bindings: [{ surfaceId: 'front', part: 'wrap', x: .75, y: .5 }] };
    await editor.setTemplate(mug);
    root.querySelector<HTMLButtonElement>('[data-view="mdt-3d"]')?.click();
    for (let i = 0; i < 60 && root.querySelector('.mdt-view3d-card'); i++) await wait(100);
    await wait(600);
    check(pullButton.hidden && canvas.getAttribute('data-mdt-tool') === 'orbit', 'A mug must not offer the pull tool.');
    // The builder renders product photos from the 3D model, with the print area already placed.
    const builder = merchant.element.shadowRoot!;
    const views = merchant.getTemplate().views.length;
    builder.querySelector<HTMLButtonElement>('[data-mdt-key="model-photos"]')!.click();
    for (let i = 0; i < 100 && merchant.getTemplate().views.length === views; i++) await wait(100);
    const next = merchant.getTemplate();
    check(next.views.length === views + 1, `Creating photos from 3D must add one view per placed part (${next.views.length - views}).`);
    const added = next.views[next.views.length - 1], binding = added.bindings[0];
    check(binding?.surfaceId === 'front' && binding.x > .2 && binding.x + binding.width < .8 && binding.width > .05, `The new view must place the print area on the chest (${JSON.stringify(binding)}).`);
    check(next.assets[added.assetId]?.width === 900, 'The new view must carry its studio photo.');
  } finally { editor.destroy(); merchant.destroy(); fixtures.replaceChildren(); }
}

const tests: Array<[string, () => Promise<void>]> = [
  ['Print output: dimensions, alpha, original pixels, revision, and DPI metadata', testPrintPixels],
  ['Preview composition and inverse physical-coordinate mapping', testPreviewPixels],
  ['Printable polygon clipping in the actual transparent export', testContourPixels],
  ['Asset ID collisions between product templates and customer designs', testAssetIdScopes],
  ['Cached-source manifest validation and corrected-manifest retry', testCachedManifestValidation],
  ['Hostile host CSS, independent instances, RTL, restore, snapshot, and cleanup', testIsolationAndLifecycle],
  ['Direct manipulation: corner resize, proportions, keyboard undo, and merchant history', testDirectManipulation],
  ['Persian catalog: no English UI text in either editor, RTL, and Persian digits', testPersianCatalog],
  ['3D preview: WebGL render with textured artwork, unchanged placement, and builder shape picker', test3dPreview],
  ['Soft products: fabric pull deforms only the preview, rigid mugs cannot be pulled, photos from 3D', testSoftProducts],
];
runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  results.textContent = '';
  summary.textContent = 'Running browser checks…';
  let passed = 0;
  for (const [name, action] of tests) {
    try { await action(); passed += 1; results.textContent += `PASS  ${name}\n`; }
    catch (error) { results.textContent += `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}\n`; }
  }
  summary.textContent = `${passed}/${tests.length} browser checks passed.`;
  summary.dataset.result = passed === tests.length ? 'pass' : 'fail';
  runButton.disabled = false;
});
