import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDesign, assertTemplate, clone, constrainLayer, copyDesign, copyTemplate, createDesign, effectiveDpi, exportSize, fitLayer, validateDesign, validateTemplate } from '../dist/lib/core.js';

const picture = { id: 'picture', name: 'Test image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', mimeType: 'image/png', width: 1000, height: 800 };
function fixture() {
  return {
    schemaVersion: 1, id: 'product', revision: 'v1', status: 'published', title: 'Known geometry',
    assets: { picture: clone(picture) },
    surfaces: [{ id: 'front', label: 'Front', widthMm: 100, heightMm: 80, dpi: 254, minDpi: 150, safeMm: 10, bleedMm: 0, required: true, rules: { move: true, resize: true, rotate: true, maxLayers: 4 } }],
    views: [{ id: 'front-view', label: 'Front', assetId: 'picture', bindings: [{ surfaceId: 'front', x: .1, y: .1, width: .8, height: .8, rotation: 0 }] }],
  };
}
function near(actual, expected, epsilon = .000001) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`); }

test('public and component modules import during SSR without DOM globals', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const [api, admin, customer] = await Promise.all([
    import('../dist/lib/index.js'),
    import('../dist/lib/admin.js'),
    import('../dist/lib/customer.js'),
  ]);
  assert.equal(typeof api.Renderer, 'function');
  assert.equal(typeof admin.mountAdmin, 'function');
  assert.equal(typeof customer.mountCustomer, 'function');
});

test('physical output dimensions include bleed and round from mm to pixels', () => {
  const surface = fixture().surfaces[0];
  assert.deepEqual(exportSize(surface), { width: 1000, height: 800 });
  surface.bleedMm = 2;
  assert.deepEqual(exportSize(surface), { width: 1040, height: 840 });
});

test('initial fit preserves aspect ratio inside safe margins with center coordinates', () => {
  const surface = fixture().surfaces[0];
  const layer = fitLayer(picture, surface, 'image');
  near(layer.widthMm, 75);
  near(layer.heightMm, 60);
  near(layer.xMm, 50);
  near(layer.yMm, 40);
  near(layer.widthMm / layer.heightMm, picture.width / picture.height);
});

test('effective DPI depends on actual source pixels and placed physical size', () => {
  const surface = fixture().surfaces[0];
  const layer = fitLayer(picture, surface, 'image');
  near(effectiveDpi(layer, picture), 800 / (60 / 25.4));
  const larger = { ...layer, widthMm: layer.widthMm * 2, heightMm: layer.heightMm * 2 };
  near(effectiveDpi(larger, picture), effectiveDpi(layer, picture) / 2);
});

test('rotated placement constraints keep artwork inside trim plus bleed', () => {
  const surface = fixture().surfaces[0];
  const result = constrainLayer({ ...fitLayer(picture, surface, 'image'), xMm: -100, yMm: 900, rotation: 45 }, surface);
  const theta = result.rotation * Math.PI / 180;
  const halfX = (Math.abs(Math.cos(theta)) * result.widthMm + Math.abs(Math.sin(theta)) * result.heightMm) / 2;
  const halfY = (Math.abs(Math.sin(theta)) * result.widthMm + Math.abs(Math.cos(theta)) * result.heightMm) / 2;
  assert.ok(result.xMm - halfX >= -surface.bleedMm - .000001);
  assert.ok(result.yMm - halfY >= -surface.bleedMm - .000001);
  assert.ok(result.xMm + halfX <= surface.widthMm + surface.bleedMm + .000001);
  assert.ok(result.yMm + halfY <= surface.heightMm + surface.bleedMm + .000001);
});

test('required-area validation is explicit and does not prevent saving an empty draft design', () => {
  const template = fixture();
  const design = createDesign(template);
  assert.deepEqual(validateDesign(template, design), []);
  assert.ok(validateDesign(template, design, { required: true }).some(issue => issue.surfaceId === 'front'));
  design.assets.picture = clone(picture);
  design.layers.push(fitLayer(picture, template.surfaces[0], 'image'));
  assert.deepEqual(validateDesign(template, design, { required: true }), []);
});

test('template readiness detects missing view assets and invalid print geometry', () => {
  const template = fixture();
  assert.deepEqual(validateTemplate(template), []);
  template.surfaces[0].widthMm = -1;
  template.views[0].assetId = 'missing';
  assert.ok(validateTemplate(template).length >= 2);
});

test('schema and template revision mismatch cannot silently reinterpret a saved design', () => {
  const template = fixture();
  assert.throws(() => assertTemplate({ ...template, schemaVersion: 99 }));
  const design = createDesign(template);
  assert.throws(() => assertDesign({ ...template, revision: 'v2' }, design));
  assert.throws(() => assertDesign(template, { ...design, schemaVersion: 99 }));
});

test('inherited Object.prototype names cannot masquerade as imported asset references', () => {
  for (const missing of ['constructor', 'toString']) {
    const template = fixture();
    template.views[0].assetId = missing;
    assert.ok(validateTemplate(template).some(issue => issue.code === 'missing-product-image'), `A missing product photo named ${missing} must not resolve through Object.prototype.`);
    const validTemplate = fixture();
    const design = createDesign(validTemplate);
    design.layers.push({ ...fitLayer(picture, validTemplate.surfaces[0], 'image'), assetId: missing });
    assert.throws(() => assertDesign(validTemplate, design), `A missing artwork asset named ${missing} must not resolve through Object.prototype.`);
  }
});

test('JSON round-trip retains exact print coordinates independently of later template edits', () => {
  const template = fixture();
  const design = createDesign(template);
  design.assets.picture = clone(picture);
  design.layers.push({ ...fitLayer(picture, template.surfaces[0], 'image'), rotation: 12 });
  const restored = assertDesign(template, JSON.parse(JSON.stringify(design)));
  assert.deepEqual(restored, design);
  const snapshot = clone({ template, design });
  template.surfaces[0].widthMm = 200;
  design.layers[0].xMm = 75;
  assert.equal(snapshot.template.surfaces[0].widthMm, 100);
  assert.equal(snapshot.design.layers[0].xMm, 50);
});

test('editor surface affine and the inverse pointer mapping agree under rotation and non-uniform scale', async () => {
  const { surfaceAffine, applyAffine, invertAffine, mapPointToSurface, STAGE_WIDTH, STAGE_HEIGHT } = await import('../dist/lib/render.js');
  const template = fixture();
  template.views[0].bindings[0] = { surfaceId: 'front', x: .15, y: .2, width: .5, height: .7, rotation: 27 };
  const forward = surfaceAffine(template, 'front-view', 'front');
  for (const [x, y] of [[0, 0], [100, 0], [37.5, 61.2], [100, 80]]) {
    const stage = applyAffine(forward, x, y);
    const inverse = mapPointToSurface(template, 'front-view', 'front', stage.x / STAGE_WIDTH, stage.y / STAGE_HEIGHT);
    near(inverse.xMm, x, 1e-6); near(inverse.yMm, y, 1e-6);
    const back = applyAffine(invertAffine(forward), stage.x, stage.y);
    near(back.x, x, 1e-6); near(back.y, y, 1e-6);
  }
});

test('corner resize keeps proportions and the opposite corner fixed, even when rotated', async () => {
  const { resizeBox, boxCorners } = await import('../dist/lib/viewport.js');
  const start = { cx: 50, cy: 40, w: 40, h: 20, rotation: 30 };
  const anchor = boxCorners(start)[0];
  const pointer = boxCorners({ ...start, w: 60, h: 30 })[2];
  const next = resizeBox(start, 'se', { x: pointer.x + 3, y: pointer.y - 2 }, { uniform: true, centered: false, min: 1 });
  near(next.w / next.h, 2, 1e-9);
  const fixed = boxCorners(next)[0];
  near(fixed.x, anchor.x, 1e-9); near(fixed.y, anchor.y, 1e-9);
  const centered = resizeBox(start, 'e', { x: 90, y: 40 }, { uniform: false, centered: true, min: 1 });
  near(centered.cx, start.cx); near(centered.cy, start.cy); near(centered.h, start.h);
  const collapsed = resizeBox(start, 'nw', { x: 500, y: 500 }, { uniform: true, centered: false, min: 2 });
  assert.ok(collapsed.w >= 2 && collapsed.h >= 2, 'Dragging past the anchor clamps instead of flipping.');
});

test('rotation drag snaps to right angles and to 15° steps with Shift', async () => {
  const { rotateBox } = await import('../dist/lib/viewport.js');
  const box = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
  const from = { x: 0, y: 10 };
  const at = deg => ({ x: -Math.sin(deg * Math.PI / 180) * 10, y: Math.cos(deg * Math.PI / 180) * 10 });
  near(rotateBox(box, from, at(88.8), false), 90);
  near(rotateBox(box, from, at(37), false), 37, 1e-9);
  near(rotateBox(box, from, at(37), true), 30);
  near(rotateBox(box, from, at(-170), true), -165);
});

test('viewport zoom keeps the point under the cursor fixed and fit frames the product', async () => {
  const { Viewport } = await import('../dist/lib/viewport.js');
  let changes = 0;
  const viewport = new Viewport(() => { changes += 1; }, 40);
  viewport.resize(1000, 600);
  viewport.setContent({ x: 100, y: 50, width: 400, height: 500 }, true);
  near(viewport.scale, (600 - 80) / 500);
  const center = viewport.toScreen(300, 300);
  assert.ok(center.x > 0 && center.x < 1000 && center.y > 0 && center.y < 600);
  const before = viewport.toStage(700, 250);
  viewport.zoomBy(2.5, 700, 250);
  const after = viewport.toStage(700, 250);
  near(after.x, before.x, 1e-9); near(after.y, before.y, 1e-9);
  assert.equal(viewport.isFitted, false);
  viewport.fit();
  assert.equal(viewport.isFitted, true);
  assert.ok(changes >= 3);
});

test('structural editor copies share immutable image records but not editable geometry', () => {
  const template = fixture();
  const copy = copyTemplate(template);
  assert.equal(copy.assets.picture, template.assets.picture);
  copy.surfaces[0].widthMm = 1; copy.views[0].bindings[0].x = .5; copy.surfaces[0].rules.move = false;
  assert.equal(template.surfaces[0].widthMm, 100);
  assert.equal(template.views[0].bindings[0].x, .1);
  assert.equal(template.surfaces[0].rules.move, true);
  const design = createDesign(template);
  design.layers.push(fitLayer(picture, template.surfaces[0], 'image'));
  const designCopy = copyDesign(design);
  designCopy.layers[0].xMm = 1;
  assert.equal(design.layers[0].xMm, 50);
});

/** Every message the editors can show, read from the sources: t('key', 'English'), plural keys, and error codes. */
async function usedMessages() {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../src/', import.meta.url);
  // Keys whose English text is built at runtime; the catalog defines their wording.
  const used = new Map([['errors.operation', null], ['errors.invalid-template', null], ['errors.invalid-design', null]]);
  const add = (key, text) => { if (!used.has(key)) used.set(key, text); };
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.ts'))) {
    const src = await readFile(new URL(file, dir), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) add(m[1], m[2]);
    for (const m of src.matchAll(/plural\(\s*'([^']+)'[^{]*\{\s*one:\s*'([^']*)',\s*other:\s*'([^']*)'/g)) { add(`${m[1]}.one`, m[2]); add(`${m[1]}.other`, m[3]); }
    // Library errors carry dynamic or detailed English; catalogs give them stable wording.
    for (const m of src.matchAll(/issues\('([^']+)'/g)) add(`errors.${m[1]}`, null);
    // A literal message is untranslated English and needs catalog wording; editors pass t(…) for messages they translated themselves.
    for (const m of src.matchAll(/new EditorError\('([^']+)',\s*['`]/g)) add(`errors.${m[1]}`, null);
    for (const m of src.matchAll(/check\([^;]*?'[^']+',\s*'([a-z-]+)'\)/g)) add(`errors.${m[1]}`, null);
  }
  return used;
}
const placeholders = text => new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]));

test('the English reference catalog lists exactly the messages the editors use, with the same text', async () => {
  const { en } = await import('../dist/lib/locales/en.js');
  const used = await usedMessages();
  assert.ok(used.size > 400, 'The source scan found too few messages; the extraction patterns are out of date.');
  const missing = [...used.keys()].filter(key => !Object.hasOwn(en, key));
  assert.deepEqual(missing, [], `Missing from en.ts: ${missing.join(', ')}`);
  const stale = Object.keys(en).filter(key => !used.has(key));
  assert.deepEqual(stale, [], `en.ts has messages no editor uses: ${stale.join(', ')}`);
  const drift = [...used].filter(([key, text]) => text !== null && en[key] !== text).map(([key]) => key);
  assert.deepEqual(drift, [], `en.ts differs from the code's English: ${drift.join(', ')}`);
});

test('every bundled catalog translates all English messages and keeps their placeholders', async () => {
  const { readdir } = await import('node:fs/promises');
  const { en } = await import('../dist/lib/locales/en.js');
  const languages = (await readdir(new URL('../src/locales/', import.meta.url))).map(name => name.replace(/\.ts$/, '')).filter(name => name !== 'en');
  assert.ok(languages.includes('fa') && languages.includes('de'));
  for (const language of languages) {
    const catalog = (await import(`../dist/lib/locales/${language}.js`))[language];
    assert.ok(catalog, `${language}.ts must export a const named ${language}`);
    const missing = Object.keys(en).filter(key => !Object.hasOwn(catalog, key));
    assert.deepEqual(missing, [], `${language}: missing ${missing.join(', ')}`);
    const stale = Object.keys(catalog).filter(key => !Object.hasOwn(en, key));
    assert.deepEqual(stale, [], `${language}: unused ${stale.join(', ')}`);
    for (const [key, english] of Object.entries(en)) {
      const expected = placeholders(english), actual = placeholders(catalog[key]);
      for (const name of expected) assert.ok(actual.has(name), `${language} ${key} lost {${name}}`);
      for (const name of actual) assert.ok(expected.has(name) || (/\.(one|other)$/.test(key) && name === 'count'), `${language} ${key} uses unknown {${name}}`);
      assert.ok(catalog[key].trim(), `${language} ${key} is empty`);
    }
  }
});

test('German text differs from English except where the words are genuinely the same', async () => {
  const { en } = await import('../dist/lib/locales/en.js');
  const { de } = await import('../dist/lib/locales/de.js');
  // Units, symbols, number patterns and loanwords that German shares with English.
  const shared = new Set([
    'admin.areaIssue', 'admin.dimensions', 'admin.ellipse', 'admin.outputPixels', 'admin.pixelSize', 'admin.stepLabel', 'admin.summaryLine',
    'customer.areaSpec', 'customer.dimensionsMm', 'customer.dpiValue', 'customer.layerCount', 'customer.layerLabel', 'customer.optional', 'customer.outputPixels',
    'customer.pixels', 'customer.positionMm', 'customer.railUploads', 'customer.surfaceInfo', 'customer.uploadsTitle', 'customer.view3d', 'customer.x', 'customer.y',
    'field.h', 'field.x', 'field.y', 'key.alt', 'key.esc', 'stage.zoomControls', 'unit.degree', 'unit.degreeValue', 'unit.dpi', 'unit.percent',
  ]);
  const untranslated = Object.keys(en).filter(key => de[key] === en[key] && !shared.has(key));
  assert.deepEqual(untranslated, [], `Probably untranslated German: ${untranslated.join(', ')}`);
});

test('generated 3D shapes are finite, indexed in range, and map print areas at physical scale', async () => {
  const { buildPreset, printRect } = await import('../dist/lib/meshes.js');
  const { MODEL_PRESETS, PRESET_PARTS } = await import('../dist/lib/core.js');
  for (const preset of MODEL_PRESETS) {
    const geometry = buildPreset({ kind: 'preset', preset, color: '#ffffff', bindings: [] });
    // Every part a template may bind is printable, sized for millimeter mapping, and has a facing angle.
    const printable = new Set(geometry.parts.filter(part => part.printable).map(part => part.name));
    for (const name of PRESET_PARTS[preset]) {
      assert.ok(printable.has(name), `${preset} has printable part ${name}`);
      assert.ok(geometry.partSizes[name]?.width > 0 && geometry.partSizes[name]?.height > 0, `${preset}/${name} has a physical size`);
      assert.equal(typeof geometry.facing[name], 'number', `${preset}/${name} has a facing angle`);
    }
    for (const part of geometry.parts) {
      assert.ok(part.ao && part.ao.length === part.positions.length / 3 * 2 && part.ao.every(value => value >= 0 && value <= 1), `${preset}/${part.name} has baked occlusion`);
      const vertices = part.positions.length / 3;
      assert.ok(part.positions.every(Number.isFinite) && part.normals.every(Number.isFinite), `${preset}/${part.name} has non-finite data`);
      assert.ok(part.indices.every(index => index < vertices) && part.indices.length % 3 === 0, `${preset}/${part.name} has bad indices`);
      for (let i = 0; i < part.normals.length; i += 3) near(Math.hypot(part.normals[i], part.normals[i + 1], part.normals[i + 2]), 1, 1e-4);
      if (part.printable) assert.ok(part.partUV.every(value => value > -.02 && value < 1.02), `${preset}/${part.name} part space leaves 0..1`);
    }
  }
  const shirt = buildPreset({ kind: 'preset', preset: 'tshirt', color: '#ffffff', bindings: [] });
  // The back panel is read from behind, so the same world side maps to the mirrored horizontal position.
  for (const [name, expectRight] of [['front', true], ['back', false]]) {
    const part = shirt.parts.find(item => item.name === name);
    for (let i = 0; i < part.positions.length / 3; i += 97) if (Math.abs(part.positions[i * 3]) > 20) assert.equal(part.partUV[i * 2] > .5, (part.positions[i * 3] > 0) === expectRight);
  }
  const surface = { ...fixture().surfaces[0], widthMm: 240, heightMm: 300 };
  const rect = printRect({ kind: 'preset', preset: 'tshirt', color: '#ffffff', bindings: [] }, { surfaceId: 'front', part: 'front', x: .5, y: .4 }, surface, shirt);
  near(rect[2], 240 / 520); near(rect[3], 300 / 772); near(rect[0] + rect[2] / 2, .5); near(rect[1] + rect[3] / 2, .4);
  // Sleeves hang outward from the body on their own side.
  const sleeveX = name => { const part = shirt.parts.find(item => item.name === name); let sum = 0; for (let i = 0; i < part.positions.length; i += 3) sum += part.positions[i]; return sum / (part.positions.length / 3); };
  assert.ok(sleeveX('right-sleeve') > 260 && sleeveX('left-sleeve') < -260, 'Sleeves sit outside the torso.');
  // Garment size follows the template: a larger chest makes a wider body.
  const wide = buildPreset({ kind: 'preset', preset: 'hoodie', color: '#ffffff', size: { width: 640, height: 690, depth: 250 }, bindings: [] });
  const front = wide.parts.find(part => part.name === 'front');
  assert.ok(Math.max(...Array.from(front.positions).filter((_, i) => i % 3 === 0)) > 300, 'The body widens with the chest size.');
  const mug = buildPreset({ kind: 'preset', preset: 'mug', color: '#ffffff', size: { width: 80, height: 100, depth: 80 }, bindings: [] });
  const wrap = mug.parts.find(part => part.name === 'wrap');
  // u = 0.75 faces the viewer (+z) when the handle is on the right (+x).
  let best = 0;
  for (let i = 0; i < wrap.partUV.length / 2; i++) if (Math.abs(wrap.partUV[i * 2] - .75) < Math.abs(wrap.partUV[best * 2] - .75)) best = i;
  near(wrap.positions[best * 3 + 2], 40, .5); near(wrap.positions[best * 3], 0, 1.5);
  const handle = mug.parts.find(part => part.name === 'handle');
  assert.ok(Math.max(...Array.from(handle.positions).filter((_, i) => i % 3 === 0)) > 50, 'The handle sits on the +x side.');
});

/** Builds a minimal GLB: one quad with UVs, a material name and a node translation. */
function glb({ json: patch = {}, truncate = 0, binPatch } = {}) {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(48 + 32 + 12);
  bin.set(new Uint8Array(positions.buffer), 0); bin.set(new Uint8Array(uvs.buffer), 48); bin.set(new Uint8Array(indices.buffer), 80);
  binPatch?.(bin);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [10, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Print', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], roughnessFactor: .5 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 32 }, { buffer: 0, byteOffset: 80, byteLength: 12 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    ...patch,
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20); padded.set(text); text = padded;
  const total = 12 + 8 + text.length + 8 + bin.length;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  view.setUint32(20 + text.length, bin.length, true); view.setUint32(24 + text.length, 0x004e4942, true); out.set(bin, 28 + text.length);
  return out.buffer.slice(0, total - truncate);
}

test('the GLB reader loads a valid static mesh with node transforms and material names', async () => {
  const { parseGlb } = await import('../dist/lib/glb.js');
  const { parts } = parseGlb(glb());
  assert.equal(parts.length, 1);
  const [part] = parts;
  assert.equal(part.name, 'Print');
  assert.deepEqual(Array.from(part.positions.slice(0, 6)), [10, 0, 0, 12, 0, 0]);
  assert.deepEqual(Array.from(part.partUV.slice(0, 4)), [0, 1, 1, 1]);
  assert.deepEqual(Array.from(part.indices), [0, 1, 2, 0, 2, 3]);
  near(part.color[0], 1); near(part.color[1], 0); near(part.roughness, .5);
});

test('the GLB reader rejects truncated, out-of-range, external, and unsupported files with coded errors', async () => {
  const { parseGlb } = await import('../dist/lib/glb.js');
  const { EditorError } = await import('../dist/lib/core.js');
  const rejects = (buffer, code, why) => assert.throws(() => parseGlb(buffer), error => error instanceof EditorError && error.code === code, why);
  rejects(new ArrayBuffer(8), 'model-invalid', 'tiny file');
  rejects(new TextEncoder().encode('not a model at all, just text').buffer, 'model-invalid', 'wrong magic');
  rejects(glb({ truncate: 20 }), 'model-invalid', 'truncated binary chunk');
  rejects(glb({ json: { accessors: [{ bufferView: 0, componentType: 5126, count: 400, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' }, { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' }] } }), 'model-invalid', 'accessor past its view');
  rejects(glb({ binPatch: bin => { new DataView(bin.buffer).setUint16(82, 40, true); } }), 'model-invalid', 'index beyond vertex count');
  rejects(glb({ json: { extensionsRequired: ['KHR_draco_mesh_compression'] } }), 'model-unsupported', 'required compression extension');
  rejects(glb({ json: { buffers: [{ byteLength: 92, uri: 'https://example.invalid/data.bin' }] } }), 'model-unsupported', 'external buffer URI');
  rejects(glb({ json: { nodes: [{ mesh: 0, children: [0] }] } }), 'model-unsupported', 'cyclic node graph');
});

test('garment sleeves are sewn onto the body and the side seams are closed', async () => {
  const { buildPreset } = await import('../dist/lib/meshes.js');
  for (const preset of ['tshirt', 'hoodie', 'sweater']) {
    const geometry = buildPreset({ kind: 'preset', preset, color: '#ffffff', bindings: [] });
    const front = geometry.parts.find(part => part.name === 'front'), back = geometry.parts.find(part => part.name === 'back');
    // Front and back panels share their side-seam columns exactly (73 columns, 85 rows).
    for (let row = 0; row < 85; row++) for (const [a, b] of [[0, 72], [72, 0]]) {
      const i = (row * 73 + a) * 3, j = (row * 73 + b) * 3;
      near(Math.hypot(front.positions[i] - back.positions[j], front.positions[i + 1] - back.positions[j + 1], front.positions[i + 2] - back.positions[j + 2]), 0, 1e-3);
    }
    // Every point of a sleeve's armhole ring lies on the torso surface, so no gap opens from any angle.
    const body = [front, back];
    for (const name of ['left-sleeve', 'right-sleeve']) {
      const sleeve = geometry.parts.find(part => part.name === name);
      let worst = 0;
      for (let k = 0; k <= 56; k++) {
        const [x, y, z] = sleeve.positions.slice(k * 3, k * 3 + 3);
        let nearest = Infinity;
        for (const panel of body) for (let i = 0; i < panel.positions.length; i += 3) nearest = Math.min(nearest, Math.hypot(panel.positions[i] - x, panel.positions[i + 1] - y, panel.positions[i + 2] - z));
        worst = Math.max(worst, nearest);
      }
      assert.ok(worst < 15, `${preset} ${name}: the armhole is ${worst.toFixed(1)} mm from the body.`);
    }
  }
});

test('soft-body rotation extraction recovers a known rotation', async () => {
  const { extractRotation } = await import('../dist/lib/softbody.js');
  const angle = .7, axis = [.3, .8, -.52], length = Math.hypot(...axis);
  const [x, y, z] = axis.map(value => value / length * Math.sin(angle / 2)), w = Math.cos(angle / 2);
  const rotate = ([px, py, pz]) => {
    const tx = 2 * (y * pz - z * py), ty = 2 * (z * px - x * pz), tz = 2 * (x * py - y * px);
    return [px + w * tx + (y * tz - z * ty), py + w * ty + (z * tx - x * tz), pz + w * tz + (x * ty - y * tx)];
  };
  const points = [[1, 0, 0], [0, 2, 0], [0, 0, 1.5], [-1, -1, .5], [.4, -.3, -1]];
  const a = new Float64Array(9);
  for (const q of points) { const p = rotate(q); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) a[c * 3 + r] += p[r] * q[c]; }
  const q = new Float64Array([0, 0, 0, 1]);
  extractRotation(a, q, 30);
  const sign = Math.sign(q[3]) || 1;
  near(q[0] * sign, x, 1e-5); near(q[1] * sign, y, 1e-5); near(q[2] * sign, z, 1e-5); near(q[3] * sign, w, 1e-5);
});

test('the soft body stays at rest, follows a pull, keeps pinned points, and springs back', async () => {
  const { createSoftBody } = await import('../dist/lib/softbody.js');
  // A 400 × 400 mm cloth panel held along its top edge.
  const n = 21, positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; positions[k] = i * 20 - 200; positions[k + 1] = 400 - j * 20; normals[k + 2] = 1; }
  const body = createSoftBody([{ positions, normals, group: 'cloth' }], { softness: .7, pin: (_x, y) => y > 330 ? 1 : 0 });
  assert.equal(body.step(), false, 'Nothing moves until it is pulled.');
  const out = new Float32Array(positions.length), outNormals = new Float32Array(normals.length);
  body.deform(0, out, outNormals);
  for (let i = 0; i < out.length; i++) near(out[i], positions[i], 1e-3);
  const corner = (n * n - 1) * 3;
  assert.ok(body.grab(0, [200, 0, 0]), 'A free corner can be grabbed.');
  body.drag([200, 0, 150]);
  for (let i = 0; i < 40; i++) body.step();
  body.deform(0, out, outNormals);
  assert.ok(out[corner + 2] > 60, `The pulled corner follows the pointer (${out[corner + 2]}).`);
  near(out[2], 0, .5); near(out[(n - 1) * 3 + 2], 0, .5);
  for (let i = 0; i < outNormals.length; i += 3) near(Math.hypot(outNormals[i], outNormals[i + 1], outNormals[i + 2]), 1, 1e-4);
  body.release();
  let steps = 0;
  while (body.step() && steps < 2000) steps++;
  assert.ok(steps < 2000, 'The fabric settles after it is released.');
  body.deform(0, out, outNormals);
  for (let i = 0; i < out.length; i++) near(out[i], positions[i], 1e-3);
  assert.equal(body.grab(0, [0, 400, 0]), false, 'Pinned fabric cannot be pulled.');
});

test('generated products know whether they can be pulled', async () => {
  const { PRESET_SOFTNESS, defaultModelBinding } = await import('../dist/lib/presets.js');
  for (const rigid of ['mug', 'box', 'card']) assert.equal(PRESET_SOFTNESS[rigid], 0, `${rigid} is rigid`);
  for (const soft of ['tshirt', 'hoodie', 'sweater', 'cushion', 'cap']) assert.ok(PRESET_SOFTNESS[soft] > 0, `${soft} is soft`);
  assert.deepEqual(defaultModelBinding('mug', 'front', 'wrap'), { surfaceId: 'front', part: 'wrap', x: .75, y: .5 });
  assert.equal(defaultModelBinding('hoodie', 'sleeve', 'left-sleeve').part, 'left-sleeve');
});

test('templates accept a valid 3D model and reject unsafe or inconsistent ones', () => {
  const template = fixture();
  const ok = { ...template, model3d: { kind: 'preset', preset: 'mug', color: '#ffffff', bindings: [{ surfaceId: 'front', part: 'wrap', x: .75, y: .5 }] } };
  assert.equal(assertTemplate(ok).model3d.preset, 'mug');
  const bad = model3d => () => assertTemplate({ ...template, model3d: { kind: 'preset', preset: 'mug', color: '#ffffff', bindings: [], ...model3d } });
  assert.throws(bad({ preset: 'spaceship' }));
  assert.throws(bad({ color: 'red' }));
  assert.throws(bad({ bindings: [{ surfaceId: 'front', part: 'front', x: .5, y: .5 }] }), 'A mug has no front part.');
  assert.throws(bad({ bindings: [{ surfaceId: 'missing', part: 'wrap', x: .5, y: .5 }] }));
  assert.throws(bad({ bindings: [{ surfaceId: 'front', part: 'wrap', x: 1.5, y: .5 }] }));
  assert.throws(bad({ kind: 'gltf', src: 'data:text/html;base64,PHNjcmlwdD4=' }), 'Only GLB data URLs are allowed.');
  assert.throws(bad({ kind: 'gltf', src: 'javascript:alert(1)' }));
  assert.throws(bad({ softness: 2 }), 'Softness stays within 0..1.');
  assert.equal(assertTemplate({ ...template, model3d: { kind: 'preset', preset: 'hoodie', color: '#334455', softness: .4, bindings: [{ surfaceId: 'front', part: 'left-sleeve', x: .5, y: .3 }] } }).model3d.softness, .4);
  assert.throws(bad({ kind: 'gltf', src: 'https://example.com/model.glb', bindings: [{ surfaceId: 'front', part: 'Print', x: .5, y: .5 }] }), 'glTF bindings need a UV size.');
  assert.equal(assertTemplate({ ...template, model3d: { kind: 'gltf', src: 'https://example.com/model.glb', color: '#ffffff', bindings: [{ surfaceId: 'front', part: 'Print', x: .5, y: .5, width: .4, height: .4 }] } }).model3d.kind, 'gltf');
});
