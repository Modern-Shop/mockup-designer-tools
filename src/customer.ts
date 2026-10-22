import type { CustomerController, CustomerOptions, DesignDocument, ExportResult, ImageAsset, ImageLayer, PrintSurface, ProductTemplate, SubmissionSnapshot, ValidationIssue } from './types.js';
import { assertDesign, assertTemplate, clone, constrainLayer, copyDesign, EditorError, createDesign, effectiveDpi, exportSize, fitLayer, newId, validateDesign, validateTemplate } from './core.js';
import { Renderer, applyAffine, invertAffine, surfaceAffine, viewRect, type Affine } from './render.js';
import { downloadBlob, ingestImage } from './assets.js';
import { icon } from './icons.js';
import { StageController, type GestureHandlers } from './stage.js';
import { View3D, VIEW_3D } from './view3d.js';
import { boxCorners, handleCursor, insideBox, normalizeAngle, pointsAttr, resizeBox, rotateBox, svg, type Box, type Handle, type Point } from './viewport.js';
import { button, callout, chip, createUI, iconButton, isTyping, node, numberField, section, segmented, setLabel, shortcutList } from './ui.js';

const CSS = `
.mdt-customer[data-mdt-mode=preview] .mdt-rail,.mdt-customer[data-mdt-mode=preview] .mdt-left,.mdt-customer[data-mdt-mode=preview] .mdt-tools{display:none!important}
.mdt-customer[data-mdt-layout=narrow][data-mdt-mobile=adjust] .mdt-left{display:none}
.mdt-customer[data-mdt-layout=narrow] .mdt-tools{display:none}
.mdt-customer[data-mdt-layout=narrow]:not([data-mdt-mobile=adjust]):not([data-mdt-mode=preview]) .mdt-right{display:none}
.mdt-customer[data-mdt-layout=narrow][data-mdt-mode=preview] .mdt-right{display:flex}
.mdt-tab-panel{display:flex;flex-direction:column;min-block-size:100%}
.mdt-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px}
.mdt-thumb{appearance:none;position:relative;aspect-ratio:1;padding:7px;border:1px solid var(--mdt-ui-line);border-radius:11px;background:var(--mdt-ui-checker);cursor:pointer;overflow:hidden;transition:border-color .12s,box-shadow .12s,transform .12s}
.mdt-thumb:hover:not(:disabled){border-color:var(--mdt-ui-accent);box-shadow:0 0 0 3px var(--mdt-ui-accent-soft)}
.mdt-thumb:disabled{opacity:.45;cursor:not-allowed}
.mdt-thumb img{inline-size:100%;block-size:100%;object-fit:contain}
.mdt-thumb-add{position:absolute;inset-block-end:6px;inset-inline-end:6px;display:grid;place-items:center;inline-size:22px;block-size:22px;border-radius:50%;background:var(--mdt-ui-accent);color:var(--mdt-ui-on-accent);box-shadow:var(--mdt-ui-shadow-1);opacity:0;transform:scale(.85);transition:opacity .12s,transform .12s}
.mdt-thumb:hover:not(:disabled) .mdt-thumb-add,.mdt-thumb:focus-visible .mdt-thumb-add{opacity:1;transform:none}
.mdt-layer-list{display:grid;gap:2px;padding:2px 8px 10px}
.mdt-layer{display:flex;align-items:center;gap:2px;padding-inline-end:4px;border-radius:10px;transition:background-color .12s}
.mdt-layer:hover{background:var(--mdt-ui-hover)}
.mdt-layer[data-selected=true]{background:var(--mdt-ui-accent-soft)}
.mdt-layer-main{appearance:none;flex:1;min-inline-size:0;display:flex;align-items:center;gap:10px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.mdt-layer-thumb{flex:none;inline-size:40px;block-size:40px;padding:3px;border:1px solid var(--mdt-ui-line);border-radius:8px;background:var(--mdt-ui-checker)}
.mdt-layer-thumb img,.mdt-sel-thumb img{inline-size:100%;block-size:100%;object-fit:contain}
.mdt-layer-text{display:grid;gap:1px;min-inline-size:0}
.mdt-layer-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-layer-meta{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--mdt-ui-text-3);font-variant-numeric:tabular-nums}
.mdt-layer-meta[data-tone=warn]{color:var(--mdt-ui-warn)}
.mdt-layer-actions{display:flex;opacity:0;transition:opacity .12s}
.mdt-layer:hover .mdt-layer-actions,.mdt-layer:focus-within .mdt-layer-actions,.mdt-layer[data-selected=true] .mdt-layer-actions{opacity:1}
.mdt-sel-head{display:flex;align-items:center;gap:11px;min-inline-size:0}
.mdt-sel-thumb{flex:none;inline-size:46px;block-size:46px;padding:4px;border:1px solid var(--mdt-ui-line);border-radius:10px;background:var(--mdt-ui-checker)}
.mdt-sel-text{display:grid;gap:1px;flex:1;min-inline-size:0}
.mdt-sel-name{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-size-row{display:grid;grid-template-columns:minmax(0,1fr) 84px;gap:12px;align-items:center}
.mdt-rotate-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px;align-items:center}
.mdt-quality-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mdt-quality-value{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--mdt-ui-text-2)}
.mdt-area-card{display:grid;gap:14px;padding:16px;border-radius:14px;background:var(--mdt-ui-bg-2)}
.mdt-area-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.mdt-area-card h3{font-size:15px;font-weight:650;letter-spacing:-.01em}
.mdt-perms{display:flex;flex-wrap:wrap;gap:6px}
.mdt-perms .mdt-chip{gap:5px}
.mdt-review-areas{display:grid;gap:6px}
.mdt-review-area{appearance:none;display:flex;align-items:center;gap:10px;inline-size:100%;padding:10px 12px;border:1px solid var(--mdt-ui-line);border-radius:11px;background:var(--mdt-ui-bg);color:var(--mdt-ui-text);font:inherit;font-size:12.5px;text-align:start;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.mdt-review-area:hover{border-color:var(--mdt-ui-line-2)}
.mdt-review-area[aria-pressed=true]{border-color:var(--mdt-ui-accent);box-shadow:0 0 0 3px var(--mdt-ui-accent-soft)}
.mdt-review-area>.mdt-icon{color:var(--mdt-ui-text-3)}
.mdt-review-area[data-state=done]>.mdt-icon{color:var(--mdt-ui-ok)}
.mdt-review-area[data-state=missing]>.mdt-icon{color:var(--mdt-ui-danger)}
.mdt-review-text{display:grid;gap:1px;flex:1;min-inline-size:0}
.mdt-review-text strong{font-weight:650}
.mdt-review-text span{color:var(--mdt-ui-text-3);font-size:11.5px}
.mdt-area-tabs{max-inline-size:100%}
`;

type Tab = 'uploads' | 'adjust' | 'layers';

/** Mount an independent shopper editor. No registration, styles, or state is installed globally. */
export async function mountCustomer(container: HTMLElement, options: CustomerOptions): Promise<CustomerController> {
  let template = assertTemplate(clone(options.template));
  if (template.status !== 'published') throw new EditorError('published-required', 'The customer editor requires a published template.');
  const initialIssues = validateTemplate(template);
  if (initialIssues.length) throw new EditorError(initialIssues[0].code, initialIssues[0].message);
  let design = options.design ? assertDesign(template, clone(options.design)) : createDesign(template);
  const initialDesignIssues = validateDesign(template, design);
  if (initialDesignIssues.length) throw new EditorError(initialDesignIssues[0].code, initialDesignIssues[0].message);
  // Pass only UI configuration: retaining the shell must not retain the caller's media documents.
  const uiOptions = { locale: options.locale, direction: options.direction, messages: options.messages, theme: options.theme };
  const assetAdapter = options.assets;
  const ui = createUI(container, 'customer', uiOptions, CSS);
  const t = ui.t, f = ui.format;
  const mod = ui.keys.mod;
  const renderer = new Renderer();
  const abort = new AbortController();
  const signal = abort.signal;
  let destroyed = false;
  let operation = 0;
  let activeSurfaceId = template.surfaces[0].id;
  let activeViewId = template.views[0].id;
  let selectedId = design.layers.find(layer => layer.surfaceId === activeSurfaceId)?.id ?? '';
  let hoverId = '';
  let preview = false;
  let busy = false;
  let needsDraw = false;
  let drawTask: Promise<void> | null = null;
  let drawError: unknown = null;
  let rangeBefore: DesignDocument | null = null;
  const undo: DesignDocument[] = [];
  const redo: DesignDocument[] = [];
  let gesture: 'move' | 'resize' | 'rotate' | null = null;
  let guides: Array<'v' | 'h'> = [];
  let readout: { text: string; at: Point } | null = null;
  let leftTab: Exclude<Tab, 'adjust'> = 'uploads';
  let mobileTab: Tab = 'uploads';
  let leftOpen = true;
  let library: ImageAsset[] = Object.values(design.assets);
  let thumbTimer = 0;
  // Start on a photo that shows the first print area.
  activeViewId = template.views.find(view => view.bindings.some(binding => binding.surfaceId === activeSurfaceId))?.id ?? activeViewId;

  ui.canvas.setAttribute('aria-label', t('customer.canvas', 'Product design preview. Select artwork and use the position controls, or drag to move.'));

  // ── Top bar ────────────────────────────────────────────────────────────
  const brand = node('div', 'mdt-brand mdt-hide-narrow'); brand.append(icon('shirt', 18));
  const titleBlock = node('div', 'mdt-title-block');
  const title = node('h2', 'mdt-title');
  titleBlock.append(title, node('p', 'mdt-subtitle', t('customer.subtitle', 'Customize your product')));
  ui.topStart.append(brand, titleBlock);
  const areaTabsHost = node('div', 'mdt-area-tabs');
  ui.topCenter.append(areaTabsHost);
  const undoButton = iconButton(t('customer.undo', 'Undo'), 'undo', () => restoreHistory(undo, redo), { shortcut: `${mod}Z` });
  const redoButton = iconButton(t('customer.redo', 'Redo'), 'redo', () => restoreHistory(redo, undo), { shortcut: ui.keys.redo });
  const editButton = button(t('customer.edit', 'Edit design'), () => togglePreview(), 'mdt-btn-ghost', 'edit');
  const previewButton = button(t('customer.preview', 'Preview'), () => togglePreview(), 'mdt-btn-primary', 'eye');
  const confirmButton = button(t('customer.confirm', 'Use this design'), confirm, 'mdt-btn-primary', 'check');
  ui.topTools.append(undoButton, redoButton);
  ui.topActions.append(editButton, previewButton, confirmButton);

  // ── Rail ───────────────────────────────────────────────────────────────
  const railItem = (tab: Tab | 'help', name: Parameters<typeof icon>[0], label: string, className = '') => {
    const item = node('button', `mdt-rail-item ${className}`.trim());
    item.type = 'button'; item.append(icon(name, 22), node('span', '', label));
    item.addEventListener('click', () => tab === 'help' ? openShortcuts() : selectTab(tab));
    return item;
  };
  const railUploads = railItem('uploads', 'upload', t('customer.railUploads', 'Uploads'));
  const railAdjust = railItem('adjust', 'sliders', t('customer.railAdjust', 'Adjust'), 'mdt-rail-mobile');
  const railLayers = railItem('layers', 'layers', t('customer.railLayers', 'Layers'));
  const railHelp = railItem('help', 'keyboard', t('customer.railShortcuts', 'Shortcuts'), 'mdt-rail-desktop');
  railHelp.setAttribute('aria-haspopup', 'dialog');
  ui.rail.setAttribute('aria-label', t('customer.panels', 'Editor panels'));
  ui.rail.append(railUploads, railAdjust, railLayers, node('div', 'mdt-rail-spacer'), railHelp);
  ui.shell.dataset.mdtRail = 'true';

  // ── Uploads panel ──────────────────────────────────────────────────────
  const panelHead = (text: string, extra?: Node) => {
    const head = node('div', 'mdt-panel-head');
    const heading = node('h2', 'mdt-panel-title', text);
    const end = node('div', 'mdt-row');
    if (extra) end.append(extra);
    const close = iconButton(t('customer.closePanel', 'Close panel'), 'close', () => { leftOpen = false; renderChrome(); ui.canvas.focus({ preventScroll: true }); }, { className: 'mdt-btn-sm mdt-hide-narrow' });
    end.append(close);
    head.append(heading, end);
    return head;
  };
  const uploadsPanel = node('div', 'mdt-tab-panel');
  const fileInput = node('input');
  fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg'; fileInput.hidden = true;
  fileInput.setAttribute('aria-label', t('customer.upload', 'Upload artwork'));
  const replaceInput = node('input');
  replaceInput.type = 'file'; replaceInput.accept = 'image/png,image/jpeg'; replaceInput.hidden = true;
  replaceInput.setAttribute('aria-label', t('customer.replace', 'Replace artwork'));
  const dropzone = node('button', 'mdt-dropzone');
  dropzone.type = 'button';
  const dropIcon = node('span', 'mdt-dropzone-icon'); dropIcon.append(icon('upload', 22));
  dropzone.append(dropIcon, node('strong', '', t('customer.addArtwork', 'Add your artwork')), node('span', '', t('customer.dropHint', 'Click, drop, or paste an image')), node('span', 'mdt-hint', t('customer.fileHelp', 'PNG or JPEG · up to 12 MB. Your original artwork is kept for print export.')));
  dropzone.addEventListener('click', () => fileInput.click(), { signal });
  for (const type of ['dragenter', 'dragover'] as const) dropzone.addEventListener(type, event => { if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dropzone.dataset.over = 'true'; } }, { signal });
  dropzone.addEventListener('dragleave', () => { dropzone.dataset.over = 'false'; }, { signal });
  dropzone.addEventListener('drop', event => {
    event.preventDefault(); dropzone.dataset.over = 'false';
    const file = Array.from(event.dataTransfer?.files ?? [])[0];
    if (file) void addImage(file).catch(() => {});
  }, { signal });
  const uploadError = node('div');
  uploadError.setAttribute('role', 'alert');
  const limitNote = node('p', 'mdt-hint');
  const libraryGrid = node('div', 'mdt-thumbs');
  const librarySection = section(t('customer.yourImages', 'Your images'), libraryGrid);
  uploadsPanel.append(panelHead(t('customer.uploadsTitle', 'Uploads')), section(undefined, dropzone, uploadError, limitNote, fileInput, replaceInput), librarySection);

  // ── Layers panel ───────────────────────────────────────────────────────
  const layersPanel = node('div', 'mdt-tab-panel');
  const layerCount = chip('0');
  const layerList = node('ul', 'mdt-layer-list');
  layerList.setAttribute('aria-label', t('customer.layers', 'Artwork layers'));
  const layersEmpty = node('p', 'mdt-lead');
  const layersEmptyWrap = section(undefined, layersEmpty);
  layersPanel.append(panelHead(t('customer.layersTitle', 'Layers'), layerCount), layerList, layersEmptyWrap);
  ui.left.append(uploadsPanel, layersPanel);

  // ── Inspector ──────────────────────────────────────────────────────────
  const inspectorHead = node('div', 'mdt-panel-head');
  const inspectorTitle = node('h2', 'mdt-panel-title');
  inspectorHead.append(inspectorTitle);
  const editBody = node('div', 'mdt-panel-body');
  const reviewBody = node('div', 'mdt-panel-body');

  const selThumb = node('img'); selThumb.alt = '';
  const selThumbBox = node('div', 'mdt-sel-thumb'); selThumbBox.append(selThumb);
  const selName = node('p', 'mdt-sel-name');
  const selMeta = node('p', 'mdt-hint');
  const selText = node('div', 'mdt-sel-text'); selText.append(selName, selMeta);
  const selRemove = iconButton(t('customer.remove', 'Remove artwork'), 'trash', () => removeSelected(), { className: 'mdt-btn-danger', shortcut: ui.keys.del });
  const selHead = node('div', 'mdt-sel-head'); selHead.append(selThumbBox, selText, selRemove);
  const selectionSection = section(undefined, selHead);

  const sizeRange = node('input', 'mdt-range');
  sizeRange.type = 'range'; sizeRange.min = '10'; sizeRange.max = '200'; sizeRange.step = '1';
  sizeRange.setAttribute('aria-label', t('customer.sizePercent', 'Artwork size in percent'));
  const sizeField = numberField({ label: t('customer.sizePercent', 'Artwork size in percent'), unit: t('unit.percent', '%'), min: 10, max: 200, step: 1, digits: 0, onCommit: value => applySize(value, true) });
  const sizeRow = node('div', 'mdt-size-row'); sizeRow.append(sizeRange, sizeField.element);
  const fitButton = button(t('customer.fit', 'Fit'), () => fitSelected(), 'mdt-btn-sm', 'shrink');
  const maxButton = button(t('customer.maxSize', 'Max size'), () => maximizeSelected(), 'mdt-btn-sm', 'fit');
  const sizeActions = node('div', 'mdt-btn-row'); sizeActions.append(fitButton, maxButton);
  const sizeSection = section(t('customer.size', 'Size'), sizeRow, sizeActions);

  const scrubbed = (patch: (layer: ImageLayer, value: number) => ImageLayer) => ({
    onInput: (value: number) => liveUpdate(layer => patch(layer, value)),
    onCommit: (value: number) => updateSelected(layer => patch(layer, value)),
  });
  const xField = numberField({ label: t('customer.x', 'Position X · mm'), prefix: t('field.x', 'X'), step: .5, digits: 1, ...scrubbed((layer, value) => ({ ...layer, xMm: value })) });
  const yField = numberField({ label: t('customer.y', 'Position Y · mm'), prefix: t('field.y', 'Y'), step: .5, digits: 1, ...scrubbed((layer, value) => ({ ...layer, yMm: value })) });
  const wField = numberField({ label: t('customer.width', 'Width · mm'), prefix: t('field.w', 'W'), step: .5, digits: 1, min: .1, ...scrubbed((layer, value) => ({ ...layer, widthMm: value, heightMm: layer.heightMm * value / layer.widthMm })) });
  const hField = numberField({ label: t('customer.height', 'Height · mm'), prefix: t('field.h', 'H'), step: .5, digits: 1, min: .1, ...scrubbed((layer, value) => ({ ...layer, heightMm: value, widthMm: layer.widthMm * value / layer.heightMm })) });
  const rotField = numberField({ label: t('customer.rotation', 'Rotation · °'), prefixIcon: 'rotateCw', unit: t('unit.degree', '°'), step: 1, digits: 1, min: -180, max: 180, ...scrubbed((layer, value) => ({ ...layer, rotation: value })) });
  const rotateLeft = iconButton(t('customer.rotateLeft', 'Rotate 90° left'), 'rotateCcw', () => updateSelected(layer => ({ ...layer, rotation: normalizeAngle(layer.rotation - 90) })), { className: 'mdt-btn-sm' });
  const rotateRight = iconButton(t('customer.rotateRight', 'Rotate 90° right'), 'rotateCw', () => updateSelected(layer => ({ ...layer, rotation: normalizeAngle(layer.rotation + 90) })), { className: 'mdt-btn-sm' });
  const positionGrid = node('div', 'mdt-grid-2'); positionGrid.append(xField.element, yField.element, wField.element, hField.element);
  const rotateRow = node('div', 'mdt-rotate-row'); rotateRow.append(rotField.element, rotateLeft, rotateRight);
  const keyboardHelp = node('p', 'mdt-hint mdt-hide-narrow', t('customer.keyboardHelp', 'On the preview: arrow keys move artwork by 0.5 mm; Shift + arrow moves by 5 mm.'));
  const positionSection = section(t('customer.positionMm', 'Position · mm'), positionGrid, rotateRow, keyboardHelp);

  const alignButtons = ([
    ['left', 'alignLeft', t('customer.alignLeft', 'Align left')], ['hcenter', 'alignHCenter', t('customer.alignHCenter', 'Center horizontally')], ['right', 'alignRight', t('customer.alignRight', 'Align right')],
    ['top', 'alignTop', t('customer.alignTop', 'Align top')], ['vcenter', 'alignVCenter', t('customer.alignVCenter', 'Center vertically')], ['bottom', 'alignBottom', t('customer.alignBottom', 'Align bottom')],
  ] as const).map(([kind, name, label]) => iconButton(label, name, () => align(kind), { className: 'mdt-btn-sm' }));
  const alignGrid = node('div', 'mdt-grid-6'); alignGrid.append(...alignButtons);
  const alignSection = section(t('customer.alignTitle', 'Align to safe area'), alignGrid);

  const qualityChip = chip('', 'ok', true);
  const qualityValue = node('span', 'mdt-quality-value');
  const qualityHead = node('div', 'mdt-quality-head'); qualityHead.append(qualityChip, qualityValue);
  const meter = node('div', 'mdt-meter'); meter.append(node('span'));
  const quality = node('p', 'mdt-hint');
  quality.className = 'mdt-hint mdt-customer-quality';
  const qualitySection = section(t('customer.printQuality', 'Print quality'), qualityHead, meter, quality);

  const replaceButton = button(t('customer.replace', 'Replace artwork'), () => replaceInput.click(), '', 'replace');
  const duplicateButton = button(t('customer.duplicate', 'Duplicate'), () => duplicateSelected(), '', 'duplicate');
  const assetActions = node('div', 'mdt-btn-row'); assetActions.append(replaceButton, duplicateButton);
  const lockNote = node('div');
  const actionsSection = section(undefined, assetActions, lockNote);
  const selectionBlock = node('div'); selectionBlock.append(selectionSection, sizeSection, positionSection, alignSection, qualitySection, actionsSection);

  const areaName = node('h3');
  const areaRequirement = chip('');
  const areaCardHead = node('div', 'mdt-area-card-head'); areaCardHead.append(areaName, areaRequirement);
  const areaDims = node('p', 'mdt-lead');
  const addButton = button(t('customer.upload', 'Upload artwork'), () => fileInput.click(), 'mdt-btn-primary mdt-btn-block', 'upload');
  const perms = node('div', 'mdt-perms');
  const emptyNote = node('p', 'mdt-hint mdt-empty');
  const areaCard = node('div', 'mdt-area-card'); areaCard.append(areaCardHead, areaDims, addButton, perms, emptyNote);
  const viewNote = node('p', 'mdt-hint');
  const emptyBlock = section(undefined, areaCard, viewNote);
  editBody.append(selectionBlock, emptyBlock);
  ui.right.append(inspectorHead, editBody, reviewBody);

  // ── Floating stage UI ──────────────────────────────────────────────────
  const selbar = node('div', 'mdt-float mdt-selbar');
  selbar.setAttribute('role', 'toolbar');
  selbar.setAttribute('aria-label', t('customer.artworkActions', 'Artwork actions'));
  const sb = {
    replace: iconButton(t('customer.replace', 'Replace artwork'), 'replace', () => replaceInput.click(), { side: 'top' }),
    fit: iconButton(t('customer.fit', 'Fit'), 'shrink', () => fitSelected(), { side: 'top' }),
    center: iconButton(t('customer.center', 'Center'), 'center', () => align('center'), { side: 'top' }),
    duplicate: iconButton(t('customer.duplicate', 'Duplicate'), 'duplicate', () => duplicateSelected(), { side: 'top', shortcut: `${mod}D` }),
    forward: iconButton(t('customer.forward', 'Bring forward'), 'arrowUp', () => reorder(1), { side: 'top', shortcut: ']' }),
    backward: iconButton(t('customer.backward', 'Send backward'), 'arrowDown', () => reorder(-1), { side: 'top', shortcut: '[' }),
    remove: iconButton(t('customer.remove', 'Remove artwork'), 'trash', () => removeSelected(), { side: 'top', className: 'mdt-btn-danger', shortcut: ui.keys.del }),
  };
  selbar.append(sb.replace, sb.fit, sb.center, sb.duplicate, node('span', 'mdt-divider'), sb.forward, sb.backward, node('span', 'mdt-divider'), sb.remove);
  const banner = node('div', 'mdt-float mdt-banner');
  const bannerText = node('span');
  const bannerButton = button('', () => { chooseBoundView(true); }, 'mdt-btn-soft mdt-btn-sm');
  banner.append(icon('info', 16), bannerText, bannerButton);
  const views = node('div', 'mdt-float mdt-views');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', t('customer.view', 'Product view'));
  const readoutTag = node('div', 'mdt-readout');
  ui.floating.append(selbar, banner, views);
  const areaInfo = node('span', 'mdt-hide-narrow');
  const helpButton = iconButton(t('customer.shortcuts', 'Keyboard shortcuts'), 'keyboard', () => openShortcuts(), { className: 'mdt-btn-sm', shortcut: '?' });
  ui.statusEnd.append(areaInfo, helpButton);

  const stageCtl = new StageController({
    ui, signal,
    begin, hover,
    changed: () => { requestDraw(); drawOverlay(); },
    files: files => { const file = files.find(item => /^image\/(png|jpeg)$/.test(item.type)) ?? files[0]; if (file) void addImage(file).catch(() => {}); },
    dropLabel: t('customer.dropHere', 'Drop to add artwork'),
  });

  const view3d = new View3D({ ui, renderer, template: () => template, design: () => design, onFallback: () => selectView(template.views[0].id) });

  // ── Document helpers ───────────────────────────────────────────────────
  function surface(): PrintSurface { return template.surfaces.find(item => item.id === activeSurfaceId)!; }
  function selected(): ImageLayer | undefined { return design.layers.find(item => item.id === selectedId && item.surfaceId === activeSurfaceId); }
  function layerAsset(layer: ImageLayer) { return design.assets[layer.assetId] ?? template.assets[layer.assetId]; }
  function layersOf(surfaceId: string): ImageLayer[] { return design.layers.filter(layer => layer.surfaceId === surfaceId); }
  function currentView() { return template.views.find(view => view.id === activeViewId); }
  function boxOf(layer: ImageLayer): Box { return { cx: layer.xMm, cy: layer.yMm, w: layer.widthMm, h: layer.heightMm, rotation: layer.rotation }; }
  function surfaceMap(surfaceId = activeSurfaceId): { forward: Affine; inverse: Affine } | null {
    const forward = surfaceAffine(template, activeViewId, surfaceId);
    return forward ? { forward, inverse: invertAffine(forward) } : null;
  }
  // Assets are immutable inside the component. History can share their large source strings.
  function copyDocument(value = design): DesignDocument { return copyDesign(value); }
  function sameLayout(a: DesignDocument, b: DesignDocument): boolean { return JSON.stringify(a.layers) === JSON.stringify(b.layers); }
  function pruneAssets(): void {
    const used = new Set(design.layers.map(layer => layer.assetId));
    design.assets = Object.fromEntries(Object.entries(design.assets).filter(([id]) => used.has(id)));
  }
  function ensureAlive(): void { if (destroyed) throw new DOMException('The editor has been destroyed.', 'AbortError'); }
  function notifyChange(): void { scheduleThumbs(); ui.element.dispatchEvent(new CustomEvent('mdt:change', { bubbles: true, composed: true, detail: { design: clone(design) } })); }
  function report(error: unknown): void {
    if (destroyed || (error instanceof DOMException && error.name === 'AbortError')) return;
    const message = ui.errorText(error);
    ui.setStatus(message, true);
    ui.element.dispatchEvent(new CustomEvent('mdt:error', { bubbles: true, composed: true, detail: { message } }));
  }
  function remember(before: DesignDocument): void {
    undo.push(before); if (undo.length > 60) undo.shift(); redo.length = 0;
  }
  function commit(change: () => void, message?: string): void {
    ensureAlive();
    finishRange();
    const before = copyDocument();
    change();
    pruneAssets();
    if (!sameLayout(before, design)) { remember(before); notifyChange(); }
    renderControls(); requestDraw();
    if (message) ui.setStatus(message);
  }
  function finishRange(): void {
    if (!rangeBefore) return;
    if (!sameLayout(rangeBefore, design)) { remember(rangeBefore); notifyChange(); }
    rangeBefore = null;
  }
  function restoreHistory(from: DesignDocument[], to: DesignDocument[]): void {
    if (busy || preview) return;
    finishRange();
    const next = from.pop(); if (!next) return;
    to.push(copyDocument()); design = next;
    if (!selected()) selectedId = layersOf(activeSurfaceId).at(-1)?.id ?? '';
    renderControls(); requestDraw(); notifyChange();
    ui.setStatus(t('customer.historyRestored', 'Previous design state restored.'));
  }
  function replaceLayer(next: ImageLayer): void { design.layers = design.layers.map(layer => layer.id === next.id ? next : layer); }
  function updateSelected(update: (layer: ImageLayer) => ImageLayer, message?: string): void {
    if (busy || preview) return;
    const target = selected(); if (!target) return;
    commit(() => replaceLayer(allowedTransform(target, update(clone(target)))), message);
  }
  /** Live edit (scrubbing): history is recorded once when the gesture finishes. */
  function liveUpdate(update: (layer: ImageLayer) => ImageLayer): void {
    const target = selected(); if (!target || busy || preview) return;
    rangeBefore ??= copyDocument();
    replaceLayer(allowedTransform(target, update(target)));
    renderControls(); requestDraw();
  }
  function allowedTransform(previous: ImageLayer, candidate: ImageLayer): ImageLayer {
    const area = surface();
    const next = { ...candidate };
    if (!area.rules.rotate) next.rotation = previous.rotation;
    if (!area.rules.resize) { next.widthMm = previous.widthMm; next.heightMm = previous.heightMm; }
    if (!area.rules.move) {
      next.xMm = previous.xMm; next.yMm = previous.yMm;
      const angle = next.rotation * Math.PI / 180;
      const halfWidth = (Math.abs(Math.cos(angle)) * next.widthMm + Math.abs(Math.sin(angle)) * next.heightMm) / 2;
      const halfHeight = (Math.abs(Math.sin(angle)) * next.widthMm + Math.abs(Math.cos(angle)) * next.heightMm) / 2;
      const availableX = Math.min(next.xMm + area.bleedMm, area.widthMm + area.bleedMm - next.xMm);
      const availableY = Math.min(next.yMm + area.bleedMm, area.heightMm + area.bleedMm - next.yMm);
      const ratio = Math.min(1, availableX / halfWidth, availableY / halfHeight);
      if (!area.rules.resize && ratio < 1 - 0.000001) return previous;
      next.widthMm *= ratio; next.heightMm *= ratio;
    }
    const constrained = constrainLayer(next, area);
    if (!area.rules.resize && (Math.abs(constrained.widthMm - previous.widthMm) > 0.000001 || Math.abs(constrained.heightMm - previous.heightMm) > 0.000001)) return previous;
    return constrained;
  }
  function extent(layer: ImageLayer): Point {
    const angle = layer.rotation * Math.PI / 180;
    return { x: (Math.abs(Math.cos(angle)) * layer.widthMm + Math.abs(Math.sin(angle)) * layer.heightMm) / 2, y: (Math.abs(Math.sin(angle)) * layer.widthMm + Math.abs(Math.cos(angle)) * layer.heightMm) / 2 };
  }
  function fitSelected(): void {
    updateSelected(layer => {
      const fitted = fitLayer(layerAsset(layer), surface(), layer.id);
      return { ...fitted, assetId: layer.assetId, surfaceId: layer.surfaceId, rotation: layer.rotation, ...(surface().rules.move ? {} : { xMm: layer.xMm, yMm: layer.yMm }) };
    }, t('customer.fitted', 'Artwork fitted inside the print area.'));
  }
  function maximizeSelected(): void {
    updateSelected(layer => {
      const area = surface(), box = extent(layer);
      const k = Math.min((area.widthMm + 2 * area.bleedMm) / (box.x * 2), (area.heightMm + 2 * area.bleedMm) / (box.y * 2));
      return { ...layer, widthMm: layer.widthMm * k, heightMm: layer.heightMm * k, xMm: area.widthMm / 2, yMm: area.heightMm / 2 };
    }, t('customer.maximized', 'Artwork enlarged to the full print area.'));
  }
  function align(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'center'): void {
    if (!surface().rules.move) return;
    updateSelected(layer => {
      const area = surface(), box = extent(layer), s = area.safeMm;
      const next = { ...layer };
      if (kind === 'left') next.xMm = s + box.x;
      if (kind === 'right') next.xMm = area.widthMm - s - box.x;
      if (kind === 'hcenter' || kind === 'center') next.xMm = area.widthMm / 2;
      if (kind === 'top') next.yMm = s + box.y;
      if (kind === 'bottom') next.yMm = area.heightMm - s - box.y;
      if (kind === 'vcenter' || kind === 'center') next.yMm = area.heightMm / 2;
      return next;
    }, kind === 'center' ? t('customer.centered', 'Artwork centered.') : t('customer.aligned', 'Artwork aligned.'));
  }
  function duplicateSelected(): void {
    const layer = selected(); const area = surface();
    if (!layer || busy || preview) return;
    if (layersOf(area.id).length >= area.rules.maxLayers) { ui.setStatus(t('customer.layerLimit', 'This print area has reached its artwork layer limit. Remove a layer first.'), true); return; }
    const offset = area.rules.move ? Math.max(4, area.widthMm * .04) : 0;
    const copy = allowedTransform(layer, { ...layer, id: newId('layer'), xMm: layer.xMm + offset, yMm: layer.yMm + offset });
    commit(() => { design.layers.splice(design.layers.findIndex(item => item.id === layer.id) + 1, 0, copy); selectedId = copy.id; }, t('customer.duplicated', 'Artwork duplicated.'));
  }
  function removeSelected(): void {
    const target = selected();
    if (!target || busy || preview) return;
    commit(() => { design.layers = design.layers.filter(layer => layer.id !== target.id); selectedId = ''; }, t('customer.removed', 'Artwork removed.'));
    ui.canvas.focus({ preventScroll: true });
  }
  function reorder(direction: number, id = selectedId): void {
    const layer = design.layers.find(item => item.id === id && item.surfaceId === activeSurfaceId); if (!layer || busy || preview) return;
    const siblings = layersOf(activeSurfaceId);
    const sibling = siblings[siblings.findIndex(item => item.id === layer.id) + direction];
    if (!sibling) return;
    commit(() => {
      const first = design.layers.findIndex(item => item.id === layer.id);
      const second = design.layers.findIndex(item => item.id === sibling.id);
      [design.layers[first], design.layers[second]] = [design.layers[second], design.layers[first]];
    }, t('customer.layerOrderChanged', 'Artwork layer order updated.'));
  }
  function issueText(issue: ValidationIssue): string { return t(`errors.${issue.code}`, issue.message, { area: template.surfaces.find(item => item.id === issue.surfaceId)?.label ?? '' }); }
  function issueError(issue: ValidationIssue): EditorError { return new EditorError(issue.code, issueText(issue), true); }
  function blockingIssues(required = true): ValidationIssue[] { return validateDesign(template, design, { required }).filter(issue => issue.code !== 'low-dpi'); }
  function selectLayer(id: string): void {
    finishRange();
    selectedId = id;
    if (ui.layout === 'narrow' && id && mobileTab === 'uploads') mobileTab = 'adjust';
    renderControls(); requestDraw();
  }
  function selectArea(id: string, message = true): void {
    if (id === activeSurfaceId) return;
    finishRange();
    activeSurfaceId = id;
    selectedId = layersOf(id).at(-1)?.id ?? '';
    chooseBoundView();
    if (activeViewId === VIEW_3D) view3d.focus(id);
    renderControls(); requestDraw();
    if (message) ui.setStatus(t('customer.areaChanged', 'Print area selected.'));
  }
  function selectView(id: string): void {
    if (id === activeViewId) return;
    finishRange();
    activeViewId = id;
    show3d(id === VIEW_3D);
    renderControls(); requestDraw();
    ui.setStatus(id === VIEW_3D ? t('customer.view3dOpened', '3D view opened. Drag the product to turn it.') : t('customer.viewChanged', 'Product view selected. Print placement is unchanged.'));
  }
  /** Switches the stage between the photo canvas and the 3D model. Print placement never changes. */
  function show3d(on: boolean): void {
    stageCtl.suspended = on;
    if (on) void view3d.show().then(() => view3d.focus(activeSurfaceId));
    else { view3d.hide(); stageCtl.setContent(viewRect(template, activeViewId), true); }
  }
  /** Keep the active print area visible. `force` is the explicit "show this area" action. */
  function chooseBoundView(force = false): void {
    if (activeViewId === VIEW_3D && !force) return;
    const shows = (viewId: string) => template.views.find(view => view.id === viewId)?.bindings.some(binding => binding.surfaceId === activeSurfaceId);
    if (shows(activeViewId)) return;
    if (activeViewId === VIEW_3D) view3d.hide();
    stageCtl.suspended = false;
    const next = template.views.find(view => view.bindings.some(binding => binding.surfaceId === activeSurfaceId))?.id ?? template.views[0].id;
    if (next === activeViewId) return;
    activeViewId = next;
    stageCtl.setContent(viewRect(template, activeViewId), true);
    if (force) { renderControls(); requestDraw(); }
  }
  function togglePreview(): void {
    if (busy) return;
    finishRange();
    preview = !preview;
    hoverId = '';
    if (!preview && ui.layout === 'narrow') mobileTab = selected() ? 'adjust' : 'uploads';
    renderControls(); requestDraw();
    ui.setStatus(preview ? t('customer.previewOpened', 'Preview opened. Editing guides are hidden.') : t('customer.editorOpened', 'Editing resumed.'));
    (preview ? confirmButton : previewButton).focus({ preventScroll: true });
  }
  function selectTab(tab: Tab): void {
    if (ui.layout === 'narrow') mobileTab = tab;
    else if (tab !== 'adjust') {
      if (leftTab === tab && leftOpen) leftOpen = false;
      else { leftTab = tab; leftOpen = true; }
    }
    renderChrome();
  }

  // ── Rendering of controls ─────────────────────────────────────────────
  function renderChrome(): void {
    const narrow = ui.layout === 'narrow';
    const shown = narrow ? mobileTab : leftOpen ? leftTab : null;
    ui.shell.dataset.mdtLeft = narrow || leftOpen ? 'open' : 'closed';
    ui.shell.dataset.mdtMobile = mobileTab;
    railUploads.setAttribute('aria-pressed', String(shown === 'uploads'));
    railLayers.setAttribute('aria-pressed', String(shown === 'layers'));
    railAdjust.setAttribute('aria-pressed', String(shown === 'adjust'));
    uploadsPanel.hidden = (narrow ? mobileTab : leftTab) !== 'uploads';
    layersPanel.hidden = (narrow ? mobileTab : leftTab) !== 'layers';
  }
  function renderAreaTabs(): void {
    const key = template.surfaces.map(area => `${area.id}:${area.label}:${area.required}:${layersOf(area.id).length > 0}`).join('|') + `|${activeSurfaceId}|${busy}`;
    if (areaTabsHost.dataset.mdtKey === key) return;
    areaTabsHost.dataset.mdtKey = key;
    ui.preserveFocus(() => {
      const tabs = segmented(t('customer.printArea', 'Print area'), template.surfaces.map(area => {
        const filled = layersOf(area.id).length > 0;
        const extra = node('span', 'mdt-row');
        if (filled) { const ok = node('span', 'mdt-seg-ok'); ok.append(icon('check', 14)); extra.append(ok); }
        else if (area.required) extra.append(node('span', 'mdt-seg-dot'));
        return { value: area.id, label: area.label, extra };
      }), activeSurfaceId, value => selectArea(value));
      tabs.querySelectorAll('button').forEach(item => {
        const area = template.surfaces.find(surface => surface.id === (item as HTMLButtonElement).dataset.value)!;
        const filled = layersOf(area.id).length > 0;
        item.setAttribute('aria-label', filled ? t('customer.areaTabFilled', '{area}, has artwork', { area: area.label }) : area.required ? t('customer.areaTabRequired', '{area}, required', { area: area.label }) : area.label);
        item.dataset.mdtKey = `area-${area.id}`; item.disabled = busy;
      });
      areaTabsHost.replaceChildren(tabs);
    });
    ui.topCenter.hidden = template.surfaces.length < 2;
  }
  function renderLibrary(full: boolean): void {
    const area = surface();
    const key = library.map(asset => asset.id).join('|') + `|${full}|${busy}|${preview}|${area.id}`;
    librarySection.hidden = !library.length;
    if (libraryGrid.dataset.mdtKey === key) return;
    libraryGrid.dataset.mdtKey = key;
    ui.preserveFocus(() => libraryGrid.replaceChildren(...library.map(asset => {
      const tile = node('button', 'mdt-thumb');
      tile.type = 'button'; tile.disabled = full || busy || preview; tile.dataset.mdtKey = `lib-${asset.id}`;
      const label = t('customer.addFromLibrary', 'Add {name} to {area}', { name: asset.name, area: area.label });
      tile.setAttribute('aria-label', label); tile.dataset.mdtTip = label;
      const image = node('img'); image.alt = ''; image.src = asset.src; image.decoding = 'async'; image.loading = 'lazy';
      const add = node('span', 'mdt-thumb-add'); add.append(icon('plus', 14));
      tile.append(image, add);
      tile.addEventListener('click', () => void placeAsset(asset).catch(() => {}));
      return tile;
    })));
  }
  function renderLayers(siblings: ImageLayer[]): void {
    const area = surface();
    layerCount.textContent = t('customer.layerCount', '{count} / {max}', { count: siblings.length, max: area.rules.maxLayers });
    layersEmpty.textContent = t('customer.noLayers', 'No artwork on {area} yet. Upload an image to start.', { area: area.label });
    layersEmptyWrap.hidden = siblings.length > 0;
    const key = siblings.map(layer => {
      const asset = layerAsset(layer);
      return `${layer.id}:${asset?.id}:${layer.id === selectedId}:${Math.round(layer.widthMm)}x${Math.round(layer.heightMm)}:${effectiveDpi(layer, asset) < area.minDpi}`;
    }).join('|') + `|${busy}|${preview}`;
    if (layerList.dataset.mdtKey === key) return;
    layerList.dataset.mdtKey = key;
    ui.preserveFocus(() => layerList.replaceChildren(...siblings.map((layer, index) => {
      const asset = layerAsset(layer);
      const name = asset?.name ?? t('customer.artwork', 'Artwork');
      const row = node('li', 'mdt-layer');
      row.dataset.selected = String(layer.id === selectedId);
      const main = node('button', 'mdt-layer-main');
      main.type = 'button'; main.dataset.mdtKey = `layer-${layer.id}`;
      main.setAttribute('aria-pressed', String(layer.id === selectedId));
      main.setAttribute('aria-label', t('customer.layerLabel', '{index}. {name}', { index: siblings.length - index, name }));
      const thumb = node('span', 'mdt-layer-thumb');
      const image = node('img'); image.alt = ''; image.src = asset.src; image.decoding = 'async';
      thumb.append(image);
      const text = node('span', 'mdt-layer-text');
      const low = effectiveDpi(layer, asset) < area.minDpi;
      const meta = node('span', 'mdt-layer-meta');
      if (low) { meta.dataset.tone = 'warn'; meta.append(icon('warning', 12), t('customer.layerLow', 'Low resolution')); }
      else meta.textContent = t('customer.dimensionsMm', '{width} × {height} mm', { width: Math.round(layer.widthMm), height: Math.round(layer.heightMm) });
      text.append(node('span', 'mdt-layer-name', name), meta);
      main.append(thumb, text);
      main.addEventListener('click', () => { selectLayer(layer.id); });
      const actions = node('span', 'mdt-layer-actions');
      const up = iconButton(t('customer.forward', 'Bring forward'), 'arrowUp', () => reorder(1, layer.id), { className: 'mdt-btn-sm', size: 16 });
      const down = iconButton(t('customer.backward', 'Send backward'), 'arrowDown', () => reorder(-1, layer.id), { className: 'mdt-btn-sm', size: 16 });
      const remove = iconButton(t('customer.remove', 'Remove artwork'), 'trash', () => { selectedId = layer.id; removeSelected(); }, { className: 'mdt-btn-sm mdt-btn-danger', size: 16 });
      up.dataset.mdtKey = `layer-up-${layer.id}`; down.dataset.mdtKey = `layer-down-${layer.id}`;
      up.disabled = busy || preview || index === siblings.length - 1; down.disabled = busy || preview || index === 0; remove.disabled = busy || preview;
      actions.append(up, down, remove);
      row.append(main, actions);
      return row;
    }).reverse()));
  }
  function permissionChip(allowed: boolean, label: string, lockedLabel: string, name: Parameters<typeof icon>[0]): HTMLSpanElement {
    const item = chip(allowed ? label : lockedLabel, allowed ? 'neutral' : 'warn');
    item.prepend(icon(allowed ? name : 'lock', 12));
    return item;
  }
  function renderControls(): void {
    if (destroyed) return;
    const area = surface();
    const target = selected();
    const siblings = layersOf(area.id);
    const full = siblings.length >= area.rules.maxLayers;
    title.textContent = template.title;
    ui.shell.dataset.mdtMode = preview ? 'preview' : 'edit';
    ui.setBusy(busy);
    ui.element.setAttribute('aria-busy', String(busy));
    renderAreaTabs();
    undoButton.disabled = busy || undo.length === 0 || preview;
    redoButton.disabled = busy || redo.length === 0 || preview;
    editButton.hidden = !preview; previewButton.hidden = preview; confirmButton.hidden = !preview;
    previewButton.disabled = busy; editButton.disabled = busy; confirmButton.disabled = busy;
    renderChrome();

    dropzone.disabled = busy || full || preview; fileInput.disabled = busy || full;
    limitNote.hidden = !full;
    limitNote.textContent = t('customer.layerLimit', 'This print area has reached its artwork layer limit. Remove a layer first.');
    renderLibrary(full);
    renderLayers(siblings);

    inspectorTitle.textContent = preview ? t('customer.review', 'Your design preview') : target ? t('customer.adjustArtwork', 'Adjust your artwork') : t('customer.printAreaTitle', 'Print area');
    editBody.hidden = preview; reviewBody.hidden = !preview;
    selectionBlock.hidden = !target; emptyBlock.hidden = !!target;
    if (target) {
      const asset = layerAsset(target);
      if (selThumb.dataset.assetId !== asset.id) { selThumb.src = asset.src; selThumb.dataset.assetId = asset.id; }
      selName.textContent = asset.name;
      selMeta.textContent = t('customer.pixels', '{width} × {height} px', { width: asset.width, height: asset.height });
      const fitted = fitLayer(asset, area, target.id);
      const scale = target.widthMm / fitted.widthMm * 100;
      if (ui.root.activeElement !== sizeRange) sizeRange.value = String(Math.round(Math.min(200, Math.max(10, scale))));
      sizeRange.style.setProperty('--mdt-ui-fill', `${(Number(sizeRange.value) - 10) / 190 * 100}%`);
      sizeField.set(scale);
      xField.set(target.xMm); yField.set(target.yMm); wField.set(target.widthMm); hField.set(target.heightMm); rotField.set(target.rotation);
      sizeSection.hidden = !area.rules.resize;
      sizeRange.disabled = busy || !area.rules.resize; sizeField.disable(busy || !area.rules.resize);
      fitButton.disabled = busy || !area.rules.resize; maxButton.disabled = busy || !area.rules.resize;
      xField.disable(busy || !area.rules.move); yField.disable(busy || !area.rules.move);
      wField.disable(busy || !area.rules.resize); hField.disable(busy || !area.rules.resize);
      rotField.disable(busy || !area.rules.rotate); rotateLeft.disabled = rotateRight.disabled = busy || !area.rules.rotate;
      for (const item of alignButtons) item.disabled = busy || !area.rules.move;
      alignSection.hidden = !area.rules.move;
      selRemove.disabled = busy; replaceButton.disabled = busy; duplicateButton.disabled = busy || full;
      const dpi = effectiveDpi(target, asset);
      const low = dpi < area.minDpi;
      qualityChip.textContent = low ? t('customer.qualityLow', 'Low resolution') : t('customer.qualityGood', 'Good for print');
      qualityChip.dataset.tone = low ? 'warn' : 'ok';
      qualityValue.textContent = t('customer.dpiValue', '{dpi} DPI', { dpi: Math.round(dpi) });
      meter.dataset.tone = low ? 'warn' : 'ok';
      meter.style.setProperty('--mdt-ui-value', `${Math.max(4, Math.min(100, dpi / Math.max(area.dpi, 1) * 100))}%`);
      quality.dataset.low = String(low);
      quality.textContent = low
        ? `${t('customer.lowResolution', '{dpi} DPI at this size. Use a larger image or make it smaller; target {target} DPI.', { dpi: Math.round(dpi), target: area.minDpi })} ${t('customer.recommendSize', 'Recommended: at least {width} × {height} px.', { width: Math.ceil(target.widthMm / 25.4 * area.minDpi), height: Math.ceil(target.heightMm / 25.4 * area.minDpi) })}`
        : t('customer.goodResolution', '{dpi} DPI at this size · target {target} DPI.', { dpi: Math.round(dpi), target: area.minDpi });
      const locked = [!area.rules.move && t('customer.lockMove', 'position'), !area.rules.resize && t('customer.lockResize', 'size'), !area.rules.rotate && t('customer.lockRotate', 'rotation')].filter(Boolean) as string[];
      lockNote.replaceChildren(...(locked.length ? [callout(t('customer.lockedBy', 'Locked by the store: {items}.', { items: ui.list(locked) }), 'info')] : []));
    } else {
      areaName.textContent = area.label;
      areaRequirement.textContent = area.required ? t('customer.required', 'Required') : t('customer.optional', 'Optional');
      areaRequirement.dataset.tone = area.required ? 'accent' : 'neutral';
      areaDims.textContent = t('customer.areaSpec', '{width} × {height} mm · {dpi} DPI', { width: area.widthMm, height: area.heightMm, dpi: area.dpi });
      addButton.disabled = busy || full;
      perms.replaceChildren(
        permissionChip(area.rules.move, t('customer.canMove', 'Move'), t('customer.fixedPosition', 'Fixed position'), 'move'),
        permissionChip(area.rules.resize, t('customer.canResize', 'Resize'), t('customer.fixedSize', 'Fixed size'), 'resize'),
        permissionChip(area.rules.rotate, t('customer.canRotate', 'Rotate'), t('customer.noRotation', 'No rotation'), 'rotateCw'),
      );
      emptyNote.textContent = siblings.length ? t('customer.selectHint', 'Select artwork on the product or in Layers to adjust it.') : t('customer.empty', 'Upload an image to start. It will fit automatically inside this print area.');
    }
    const mapped = currentView()?.bindings.some(binding => binding.surfaceId === area.id);
    viewNote.hidden = !!mapped;
    viewNote.textContent = t('customer.areaNotVisible', 'This print area is not visible in this view. Choose another product view to adjust it.');
    if (preview) renderReview();
    areaInfo.textContent = t('customer.surfaceInfo', '{area} · {width} × {height} mm · {dpi} DPI', { area: area.label, width: area.widthMm, height: area.heightMm, dpi: area.dpi });
    const selectedIndex = siblings.findIndex(item => item.id === selectedId);
    sb.forward.disabled = busy || selectedIndex < 0 || selectedIndex === siblings.length - 1;
    sb.backward.disabled = busy || selectedIndex <= 0;
    sb.duplicate.disabled = busy || full;
    sb.fit.disabled = busy || !area.rules.resize;
    sb.center.disabled = busy || !area.rules.move;
    sb.replace.disabled = sb.remove.disabled = busy;
    renderViews();
    drawOverlay();
  }
  function renderReview(): void {
    const area = surface();
    const size = exportSize(area);
    const issues = blockingIssues();
    const list = node('div', 'mdt-review-areas');
    for (const item of template.surfaces) {
      const count = layersOf(item.id).length;
      const state = count ? 'done' : item.required ? 'missing' : 'optional';
      const row = node('button', 'mdt-review-area');
      row.type = 'button'; row.dataset.state = state; row.dataset.mdtKey = `review-${item.id}`;
      row.setAttribute('aria-pressed', String(item.id === activeSurfaceId));
      const text = node('span', 'mdt-review-text');
      text.append(node('strong', '', item.label), node('span', '', count
        ? ui.plural('customer.artworkCount', count, { one: '{count} artwork layer', other: '{count} artwork layers' })
        : item.required ? t('customer.needsArtwork', 'Required · add artwork') : t('customer.optionalEmpty', 'Optional · empty')));
      row.append(icon(state === 'done' ? 'checkCircle' : state === 'missing' ? 'warning' : 'info', 18), text, icon('chevronRight', 16, 'mdt-icon mdt-icon-dir'));
      row.addEventListener('click', () => selectArea(item.id));
      list.append(row);
    }
    const blocks: Node[] = [section(undefined, node('p', 'mdt-lead', t('customer.reviewHelp', 'Review every print area before using this design. Preview colors may differ from the printed product.')), list)];
    const notices: Node[] = issues.map(issue => { const notice = callout(issueText(issue), 'danger'); notice.setAttribute('role', 'alert'); return notice; });
    const lows = design.layers.filter(layer => effectiveDpi(layer, layerAsset(layer)) < template.surfaces.find(item => item.id === layer.surfaceId)!.minDpi);
    if (lows.length) notices.push(callout(t('customer.previewLowResolution', 'Some artwork is below the configured resolution target. Review its size before printing.'), 'warn'));
    if (notices.length) blocks.push(section(undefined, ...notices));
    const rows: Array<[string, string]> = [
      [t('customer.printArea', 'Print area'), area.label],
      [t('customer.printSize', 'Print size'), t('customer.dimensionsMm', '{width} × {height} mm', { width: area.widthMm, height: area.heightMm })],
      [t('customer.output', 'Output'), t('customer.outputPixels', '{width} × {height} px · {dpi} DPI', { width: size.width, height: size.height, dpi: area.dpi })],
    ];
    if (area.bleedMm > 0) rows.push([t('customer.bleed', 'Bleed'), t('customer.bleedDescription', '{bleed} mm per edge', { bleed: area.bleedMm })]);
    const meta = node('dl', 'mdt-meta');
    for (const [label, value] of rows) { const row = node('div'); row.append(node('dt', '', label), node('dd', '', value)); meta.append(row); }
    const printButton = button(t('customer.exportPrint', 'Download print PNG'), () => runExport('print'), 'mdt-btn-block', 'download');
    const previewExportButton = button(t('customer.exportPreview', 'Download preview PNG'), () => runExport('preview'), 'mdt-btn-block mdt-btn-ghost', 'image');
    printButton.dataset.mdtKey = 'export-print'; previewExportButton.dataset.mdtKey = 'export-preview';
    printButton.disabled = busy || !layersOf(area.id).length; previewExportButton.disabled = busy;
    blocks.push(section(t('customer.files', 'Files'), meta, printButton, previewExportButton, node('p', 'mdt-hint', t('customer.printHelp', 'The print PNG is transparent artwork at the configured DPI. Product photography and editing guides are excluded.'))));
    ui.preserveFocus(() => reviewBody.replaceChildren(...blocks));
  }
  function renderViews(): void {
    const has3d = !!template.model3d;
    views.hidden = template.views.length + (has3d ? 1 : 0) < 2;
    const key = template.views.map(view => `${view.id}:${view.label}`).join('|') + `|${has3d}`;
    if (views.dataset.mdtKey !== key) {
      views.dataset.mdtKey = key;
      const items = template.views.map(view => {
        const item = node('button', 'mdt-view-thumb');
        item.type = 'button'; item.dataset.view = view.id;
        const thumb = node('canvas'); thumb.width = 96; thumb.height = 80;
        item.append(thumb, node('span', '', view.label));
        item.addEventListener('click', () => selectView(view.id));
        return item;
      });
      if (has3d) {
        const item = node('button', 'mdt-view-thumb');
        item.type = 'button'; item.dataset.view = VIEW_3D;
        item.setAttribute('aria-label', t('customer.view3dLabel', 'Rotatable 3D view'));
        const badge = node('span', 'mdt-view-icon'); badge.append(icon('cube', 22));
        item.append(badge, node('span', '', t('customer.view3d', '3D')));
        item.addEventListener('click', () => selectView(VIEW_3D));
        items.push(item);
      }
      views.replaceChildren(...items);
      scheduleThumbs();
    }
    for (const item of Array.from(views.querySelectorAll<HTMLButtonElement>('button'))) {
      item.setAttribute('aria-pressed', String(item.dataset.view === activeViewId));
      item.disabled = busy;
    }
  }
  function scheduleThumbs(): void {
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => {
      if (destroyed || template.views.length + (template.model3d ? 1 : 0) < 2) return;
      for (const item of Array.from(views.querySelectorAll<HTMLButtonElement>('button'))) {
        const canvas = item.querySelector('canvas'); const rect = viewRect(template, item.dataset.view ?? '');
        if (!canvas || !rect) continue;
        const scale = Math.min(48 / rect.width, 40 / rect.height);
        void renderer.renderPreview(canvas, template, design, item.dataset.view!, { viewport: { width: 48, height: 40, scale, x: (48 - rect.width * scale) / 2 - rect.x * scale, y: (40 - rect.height * scale) / 2 - rect.y * scale, pixelRatio: 2 } }).catch(() => {});
      }
    }, 160);
  }

  // ── Canvas overlay ────────────────────────────────────────────────────
  function drawOverlay(): void {
    if (destroyed) return;
    const overlay = ui.overlay, labels = ui.labels;
    overlay.replaceChildren(); labels.replaceChildren();
    const view = currentView();
    const area = surface();
    const in3d = activeViewId === VIEW_3D;
    const visible = in3d ? !!template.model3d?.bindings.some(binding => binding.surfaceId === area.id) : !!view?.bindings.some(binding => binding.surfaceId === area.id);
    banner.hidden = preview || visible;
    if (!visible) {
      bannerText.textContent = in3d ? t('customer.areaHidden3d', '{area} isn’t shown on the 3D model.', { area: area.label }) : t('customer.areaHidden', '{area} isn’t shown in this view.', { area: area.label });
      setLabel(bannerButton, t('customer.showArea', 'Show {area}', { area: area.label }));
    }
    const vp = stageCtl.viewport;
    const screen = (m: Affine, x: number, y: number) => { const p = applyAffine(m, x, y); return vp.toScreen(p.x, p.y); };
    if (preview || !view) { selbar.hidden = true; return; }
    let tagTop = Infinity;
    for (const binding of view.bindings) {
      const item = template.surfaces.find(s => s.id === binding.surfaceId);
      const m = surfaceAffine(template, view.id, binding.surfaceId);
      if (!item || !m) continue;
      const active = item.id === activeSurfaceId;
      const rect = (inset: number) => [[inset, inset], [item.widthMm - inset, inset], [item.widthMm - inset, item.heightMm - inset], [inset, item.heightMm - inset]].map(([x, y]) => screen(m, x, y));
      const trim = rect(0);
      if (active && item.bleedMm > 0) overlay.append(svg('polygon', { points: pointsAttr(rect(-item.bleedMm)) }, 'mdt-ov-bleed'));
      if (item.clip) {
        overlay.append(svg('polygon', { points: pointsAttr(trim) }, 'mdt-ov-area'));
        overlay.append(svg('polygon', { points: pointsAttr(item.clip.map(p => screen(m, p.x * item.widthMm, p.y * item.heightMm))), 'data-active': String(active) }, 'mdt-ov-area'));
      } else overlay.append(svg('polygon', { points: pointsAttr(trim), 'data-active': String(active) }, 'mdt-ov-area'));
      if (active && item.safeMm > 0 && !item.clip) overlay.append(svg('polygon', { points: pointsAttr(rect(item.safeMm)) }, 'mdt-ov-safe'));
      const corner = trim.reduce((best, p) => p.y < best.y - .5 || (Math.abs(p.y - best.y) <= .5 && p.x < best.x) ? p : best, trim[0]);
      const tag = node('div', 'mdt-area-tag');
      tag.dataset.active = String(active);
      tag.append(item.label, node('span', '', t('customer.dimensionsMm', '{width} × {height} mm', { width: item.widthMm, height: item.heightMm })));
      tag.style.left = `${corner.x}px`; tag.style.top = `${corner.y}px`;
      labels.append(tag);
      if (active) tagTop = corner.y - 30;
    }
    const map = surfaceMap();
    const outline = (layer: ImageLayer) => boxCorners(boxOf(layer)).map(p => screen(map!.forward, p.x, p.y));
    const hover = hoverId && hoverId !== selectedId && !gesture ? design.layers.find(layer => layer.id === hoverId && layer.surfaceId === area.id) : undefined;
    if (hover && map) overlay.append(svg('polygon', { points: pointsAttr(outline(hover)) }, 'mdt-ov-hover'));
    const target = selected();
    if (!target || !map) { selbar.hidden = true; return; }
    const corners = outline(target);
    const points = pointsAttr(corners);
    overlay.append(svg('polygon', { points }, 'mdt-ov-halo'), svg('polygon', { points }, 'mdt-ov-line'));
    if (gesture === 'move' && guides.length) {
      for (const guide of guides) {
        const [a, b] = guide === 'v' ? [screen(map.forward, area.widthMm / 2, -area.bleedMm), screen(map.forward, area.widthMm / 2, area.heightMm + area.bleedMm)] : [screen(map.forward, -area.bleedMm, area.heightMm / 2), screen(map.forward, area.widthMm + area.bleedMm, area.heightMm / 2)];
        overlay.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 'mdt-ov-guide'));
      }
    }
    const angle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI;
    const grip = ui.coarse ? 36 : 18;
    if (gesture !== 'move') {
      if (area.rules.rotate) {
        // Rotation sits below the box so it never competes with the label and toolbar above.
        const bottom = { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
        const center = { x: corners.reduce((sum, p) => sum + p.x, 0) / 4, y: corners.reduce((sum, p) => sum + p.y, 0) / 4 };
        const length = Math.hypot(bottom.x - center.x, bottom.y - center.y) || 1;
        const handle = { x: bottom.x + (bottom.x - center.x) / length * 24, y: bottom.y + (bottom.y - center.y) / length * 24 };
        overlay.append(svg('line', { x1: bottom.x, y1: bottom.y, x2: handle.x, y2: handle.y }, 'mdt-ov-stem'));
        overlay.append(svg('circle', { cx: handle.x, cy: handle.y, r: 6 }, 'mdt-ov-handle mdt-ov-rotate'));
        const hit = svg('circle', { cx: handle.x, cy: handle.y, r: grip / 2, 'data-mdt-handle': 'rotate' }, 'mdt-ov-grip');
        hit.style.cursor = handleCursor('rotate', angle);
        overlay.append(hit);
      }
      if (area.rules.resize) (['nw', 'ne', 'se', 'sw'] as const).forEach((name, index) => {
        const p = corners[index];
        overlay.append(svg('rect', { x: p.x - 4.5, y: p.y - 4.5, width: 9, height: 9, rx: 2 }, 'mdt-ov-handle'));
        const hit = svg('rect', { x: p.x - grip / 2, y: p.y - grip / 2, width: grip, height: grip, 'data-mdt-handle': name }, 'mdt-ov-grip');
        hit.style.cursor = handleCursor(name, angle);
        overlay.append(hit);
      });
    }
    if (readout) {
      readoutTag.textContent = readout.text;
      readoutTag.style.left = `${readout.at.x}px`; readoutTag.style.top = `${readout.at.y}px`;
      labels.append(readoutTag);
    }
    // Contextual toolbar above (or below) the selection, kept inside the stage.
    selbar.hidden = !!gesture || busy;
    if (selbar.hidden) return;
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const width = selbar.offsetWidth || 300, stageWidth = vp.width;
    let x = (Math.min(...xs) + Math.max(...xs)) / 2;
    x = Math.max(width / 2 + 8, Math.min(stageWidth - width / 2 - 8, x));
    const top = Math.min(...ys);
    let y = (top - tagTop < 70 ? Math.min(top, tagTop) : top) - 10;
    const below = y - 46 < 4;
    if (below) y = Math.max(...ys) + (area.rules.rotate ? 42 : 14);
    selbar.dataset.below = String(below);
    selbar.style.left = `${x}px`; selbar.style.top = `${Math.min(y, vp.height - 50)}px`;
  }

  // ── Stage interaction ─────────────────────────────────────────────────
  function toMm(map: { inverse: Affine }, at: Point): Point { return applyAffine(map.inverse, at.x, at.y); }
  function hitLayer(surfaceId: string, mm: Point): ImageLayer | undefined {
    return layersOf(surfaceId).reverse().find(layer => insideBox(boxOf(layer), mm));
  }
  function begin(at: Point, event: PointerEvent): GestureHandlers | null {
    if (preview || busy) return null;
    if (ui.layout === 'medium' && leftOpen) { leftOpen = false; renderChrome(); }
    finishRange();
    const handle = (event.target as Element).closest?.('[data-mdt-handle]')?.getAttribute('data-mdt-handle') as Handle | null;
    const map = surfaceMap();
    const current = selected();
    if (handle && current && map) return transform(handle, current, map, at, event);
    if (map) {
      const hit = hitLayer(activeSurfaceId, toMm(map, at));
      if (hit) return grab(hit, map, at);
    }
    for (const binding of currentView()?.bindings ?? []) {
      if (binding.surfaceId === activeSurfaceId) continue;
      const other = surfaceMap(binding.surfaceId); const item = template.surfaces.find(s => s.id === binding.surfaceId);
      if (!other || !item) continue;
      const mm = toMm(other, at);
      if (mm.x < 0 || mm.y < 0 || mm.x > item.widthMm || mm.y > item.heightMm) continue;
      selectArea(item.id);
      const hit = hitLayer(item.id, mm);
      const map2 = surfaceMap();
      if (hit && map2) return grab(hit, map2, at);
      return { move() {}, end() {} };
    }
    if (selectedId) { selectedId = ''; renderControls(); }
    return null;
  }
  function grab(layer: ImageLayer, map: { forward: Affine; inverse: Affine }, at: Point): GestureHandlers {
    if (layer.id !== selectedId) selectLayer(layer.id);
    const area = surface();
    if (!area.rules.move) return { move() {}, end() {} };
    const start = toMm(map, at), origin = { ...layer }, before = copyDocument();
    const pxPerMm = Math.hypot(map.forward.a, map.forward.b) * stageCtl.viewport.scale;
    gesture = 'move';
    return {
      move(point, event) {
        const mm = toMm(map, point);
        let x = origin.xMm + mm.x - start.x, y = origin.yMm + mm.y - start.y;
        guides = [];
        if (!event.altKey) {
          const threshold = 6 / Math.max(pxPerMm, .0001);
          if (Math.abs(x - area.widthMm / 2) < threshold) { x = area.widthMm / 2; guides.push('v'); }
          if (Math.abs(y - area.heightMm / 2) < threshold) { y = area.heightMm / 2; guides.push('h'); }
        }
        replaceLayer(constrainLayer({ ...origin, xMm: x, yMm: y }, area));
        renderControls(); requestDraw();
      },
      end(_event, cancelled) {
        gesture = null; guides = [];
        if (cancelled) design = before;
        else if (!sameLayout(before, design)) { remember(before); notifyChange(); ui.setStatus(t('customer.moved', 'Artwork moved.')); }
        renderControls(); requestDraw();
      },
    };
  }
  function transform(handle: Handle, layer: ImageLayer, map: { forward: Affine; inverse: Affine }, at: Point, event: PointerEvent): GestureHandlers | null {
    const area = surface();
    if (handle === 'rotate' ? !area.rules.rotate : !area.rules.resize) return null;
    const startBox = boxOf(layer), origin = { ...layer }, from = toMm(map, at), before = copyDocument();
    gesture = handle === 'rotate' ? 'rotate' : 'resize';
    const pointer = (point: Point) => stageCtl.viewport.toScreen(point.x, point.y);
    event.preventDefault();
    return {
      move(point, moveEvent) {
        const mm = toMm(map, point);
        let next: ImageLayer;
        if (handle === 'rotate') {
          next = allowedTransform(origin, { ...origin, rotation: rotateBox(startBox, from, mm, moveEvent.shiftKey) });
          readout = { text: t('unit.degreeValue', '{value}°', { value: Math.round(next.rotation * 10) / 10 }), at: pointer(point) };
        } else {
          const box = resizeBox(startBox, handle, mm, { uniform: true, centered: !area.rules.move || moveEvent.altKey, min: 1 });
          next = allowedTransform(origin, { ...origin, xMm: box.cx, yMm: box.cy, widthMm: box.w, heightMm: box.h });
          readout = { text: t('customer.dimensionsMm', '{width} × {height} mm', { width: Math.round(next.widthMm * 10) / 10, height: Math.round(next.heightMm * 10) / 10 }), at: pointer(point) };
        }
        replaceLayer(next);
        renderControls(); requestDraw();
      },
      end(_event, cancelled) {
        gesture = null; readout = null;
        if (cancelled) design = before;
        else if (!sameLayout(before, design)) { remember(before); notifyChange(); ui.setStatus(handle === 'rotate' ? t('customer.rotated', 'Artwork rotated.') : t('customer.sizeChanged', 'Artwork size updated.')); }
        renderControls(); requestDraw();
      },
    };
  }
  function hover(at: Point | null): void {
    if (preview || busy) return;
    let next = '', cursor = '';
    if (at) {
      const map = surfaceMap();
      const hit = map && hitLayer(activeSurfaceId, toMm(map, at));
      if (hit) { next = hit.id; cursor = surface().rules.move ? 'move' : 'pointer'; }
      else for (const binding of currentView()?.bindings ?? []) {
        if (binding.surfaceId === activeSurfaceId) continue;
        const other = surfaceMap(binding.surfaceId); const item = template.surfaces.find(s => s.id === binding.surfaceId);
        const mm = other && toMm(other, at);
        if (item && mm && mm.x >= 0 && mm.y >= 0 && mm.x <= item.widthMm && mm.y <= item.heightMm) { cursor = 'pointer'; break; }
      }
    }
    stageCtl.setCursor(cursor);
    if (next !== hoverId) { hoverId = next; drawOverlay(); }
  }

  // ── Drawing, upload and export ────────────────────────────────────────
  function requestDraw(): Promise<void> {
    needsDraw = true;
    if (destroyed) return Promise.resolve();
    // The 3D view repaints its print textures; the photo canvas catches up when it is shown again.
    if (activeViewId === VIEW_3D) { view3d.refresh(); return Promise.resolve(); }
    if (drawTask) return drawTask;
    drawTask = (async () => {
      try {
        while (needsDraw && !destroyed) {
          needsDraw = false; drawError = null;
          await renderer.renderPreview(ui.canvas, template, design, activeViewId, { guides: false, viewport: stageCtl.viewport.state });
        }
      } catch (error) {
        drawError = error; report(error);
      } finally {
        drawTask = null;
      }
    })();
    return drawTask;
  }
  function rememberAsset(asset: ImageAsset): void {
    library = [asset, ...library.filter(item => item.id !== asset.id)].slice(0, 24);
  }
  async function addImage(file: File, replacingId?: string): Promise<void> {
    ensureAlive();
    const areaId = activeSurfaceId;
    const area = surface();
    const replacing = replacingId ? design.layers.find(layer => layer.id === replacingId && layer.surfaceId === areaId) : undefined;
    if (!replacing && layersOf(areaId).length >= area.rules.maxLayers) throw new EditorError('layer-limit-reached', t('customer.layerLimit', 'This print area has reached its artwork layer limit. Remove a layer first.'), true);
    const ticket = ++operation;
    busy = true; uploadError.replaceChildren(); renderControls();
    ui.setStatus(t('customer.preparing', 'Preparing your artwork…'));
    try {
      const asset = await (assetAdapter?.ingest(file, { signal }) ?? ingestImage(file, { signal }));
      ensureAlive();
      if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
      await place(asset, areaId, replacing, ticket);
    } catch (error) {
      if (!destroyed && ticket === operation) {
        uploadError.replaceChildren(callout(ui.errorText(error), 'danger'));
        report(error);
      }
      throw error;
    } finally {
      if (!destroyed && ticket === operation) { busy = false; fileInput.value = ''; replaceInput.value = ''; renderControls(); }
    }
  }
  async function placeAsset(asset: ImageAsset): Promise<void> {
    if (busy || preview) return;
    const area = surface();
    if (layersOf(area.id).length >= area.rules.maxLayers) { ui.setStatus(t('customer.layerLimit', 'This print area has reached its artwork layer limit. Remove a layer first.'), true); return; }
    const ticket = ++operation;
    busy = true; renderControls();
    try { await place(asset, area.id, undefined, ticket); }
    catch (error) { if (!destroyed && ticket === operation) report(error); }
    finally { if (!destroyed && ticket === operation) { busy = false; renderControls(); } }
  }
  async function place(asset: ImageAsset, areaId: string, replacing: ImageLayer | undefined, ticket: number): Promise<void> {
    const area = template.surfaces.find(item => item.id === areaId)!;
    const candidate = copyDocument();
    candidate.assets[asset.id] = asset;
    let layer = fitLayer(asset, area, replacing?.id);
    layer.assetId = asset.id; layer.surfaceId = areaId;
    if (replacing && area.rules.resize) {
      // Keep the previous artwork box's center and rotation. Contain the new aspect ratio.
      const scale = Math.min(replacing.widthMm / asset.width, replacing.heightMm / asset.height);
      layer = { ...layer, xMm: replacing.xMm, yMm: replacing.yMm, widthMm: asset.width * scale, heightMm: asset.height * scale, rotation: replacing.rotation };
      layer = constrainLayer(layer, area);
    }
    if (replacing) candidate.layers = candidate.layers.map(item => item.id === replacing.id ? layer : item);
    else candidate.layers.push(layer);
    assertDesign(template, candidate);
    const candidateIssues = validateDesign(template, candidate); if (candidateIssues.length) throw issueError(candidateIssues[0]);
    await renderer.preload(template, candidate, signal);
    ensureAlive();
    if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
    rememberAsset(asset);
    commit(() => { design = candidate; activeSurfaceId = areaId; selectedId = layer.id; preview = false; }, replacing ? t('customer.replaced', 'Artwork replaced.') : t('customer.uploaded', 'Artwork added. Resize or move it to make it yours.'));
    if (ui.layout === 'narrow') mobileTab = 'adjust';
    if (ui.layout === 'medium') leftOpen = false;
    renderChrome();
    await requestDraw(); ensureAlive();
    if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
    if (drawError) throw drawError;
  }
  async function runExport(kind: 'print' | 'preview'): Promise<void> {
    if (busy) return;
    const ticket = operation;
    busy = true; renderControls();
    ui.setStatus(t('customer.exporting', 'Preparing your PNG…'));
    try {
      const area = surface();
      const result = kind === 'print' ? await controller.exportPrint(area.id) : await controller.exportPreview();
      if (destroyed) return;
      downloadBlob(result.blob, `mockup-${kind}-${kind === 'print' ? area.id : activeViewId}.png`);
      ui.setStatus(t('customer.exported', 'PNG downloaded.'));
    } catch (error) { report(error); }
    finally { if (!destroyed && ticket === operation) { busy = false; renderControls(); } }
  }
  function confirm(): void {
    const issues = blockingIssues();
    if (issues.length) {
      const target = issues.find(issue => issue.surfaceId)?.surfaceId;
      if (target) { activeSurfaceId = target; selectedId = layersOf(target).at(-1)?.id ?? ''; chooseBoundView(true); }
      renderControls(); requestDraw(); ui.setStatus(issueText(issues[0]), true); return;
    }
    ui.element.dispatchEvent(new CustomEvent('mdt:confirm', { bubbles: true, composed: true, detail: { snapshot: controller.createSnapshot() } }));
    ui.setStatus(t('customer.handedOff', 'Design passed to the host application.'));
  }
  function applySize(percent: number, transaction: boolean): void {
    const layer = selected(); if (!layer || busy || preview || !surface().rules.resize || !Number.isFinite(percent)) return;
    const fitted = fitLayer(layerAsset(layer), surface(), layer.id);
    const ratio = Math.min(200, Math.max(10, percent)) / 100;
    const next = allowedTransform(layer, { ...layer, widthMm: fitted.widthMm * ratio, heightMm: fitted.heightMm * ratio });
    if (transaction) updateSelected(() => next);
    else { rangeBefore ??= copyDocument(); replaceLayer(next); renderControls(); requestDraw(); }
  }
  function openShortcuts(): void {
    ui.openDialog(t('customer.shortcuts', 'Keyboard shortcuts'), shortcutList([
      [t('shortcuts.general', 'General'), [
        [t('customer.undo', 'Undo'), [`${mod}Z`]], [t('customer.redo', 'Redo'), [ui.keys.redo]],
        [t('customer.paste', 'Paste an image'), [`${mod}V`]], [t('customer.shortcuts', 'Keyboard shortcuts'), ['?']],
      ]],
      [t('shortcuts.artwork', 'Selected artwork'), [
        [t('shortcuts.nudge', 'Move 0.5 mm'), ['←', '↑', '→', '↓']], [t('shortcuts.nudgeLarge', 'Move 5 mm'), [ui.keys.shift, '+', '←']],
        [t('customer.duplicate', 'Duplicate'), [`${mod}D`]], [t('customer.remove', 'Remove artwork'), [ui.keys.del]],
        [t('customer.forward', 'Bring forward'), [']']], [t('customer.backward', 'Send backward'), ['[']],
        [t('shortcuts.deselect', 'Deselect'), [ui.keys.esc]],
        [t('shortcuts.rotateSnap', 'Rotate in 15° steps'), [ui.keys.shift, '+', t('shortcuts.drag', 'drag')]],
        [t('shortcuts.freeMove', 'Move or resize without snapping'), [ui.keys.alt, '+', t('shortcuts.drag', 'drag')]],
      ]],
      [t('shortcuts.view', 'View'), [
        [t('stage.zoomIn', 'Zoom in'), [`${mod}+`]], [t('stage.zoomOut', 'Zoom out'), [`${mod}−`]],
        [t('stage.fit', 'Fit to screen'), [`${mod}0`]], [t('stage.actual', 'Zoom to 100%'), [`${mod}1`]],
        [t('stage.panTemporary', 'Pan while held'), [ui.keys.space, '+', t('shortcuts.drag', 'drag')]],
        [t('stage.select', 'Select and move'), ['V']], [t('stage.hand', 'Pan the canvas'), ['H']],
      ]],
    ]));
  }

  // ── Events ─────────────────────────────────────────────────────────────
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void addImage(file).catch(() => {}); }, { signal });
  replaceInput.addEventListener('change', () => { const file = replaceInput.files?.[0]; const target = selected(); if (file && target) void addImage(file, target.id).catch(() => {}); }, { signal });
  sizeRange.addEventListener('input', () => applySize(Number(sizeRange.value), false), { signal });
  sizeRange.addEventListener('change', () => { finishRange(); renderControls(); ui.setStatus(t('customer.sizeChanged', 'Artwork size updated.')); }, { signal });
  sizeRange.addEventListener('blur', finishRange, { signal });
  ui.shell.addEventListener('keydown', event => {
    if (destroyed) return;
    const modKey = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = isTyping(event.target);
    if (modKey && !event.altKey && (key === 'z' || key === 'y')) {
      if (typing) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) restoreHistory(redo, undo); else restoreHistory(undo, redo);
      return;
    }
    if (typing || event.altKey) return;
    if (event.key === '?') { event.preventDefault(); openShortcuts(); return; }
    if (preview) { if (event.key === 'Escape') togglePreview(); return; }
    if (modKey && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
    if (modKey) return;
    if (event.key === ']' || event.key === '[') { event.preventDefault(); reorder(event.key === ']' ? 1 : -1); return; }
    if (event.key === 'Escape' && selectedId) { event.preventDefault(); selectLayer(''); return; }
    if (event.target !== ui.canvas || busy || !selected()) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
    const delta = event.shiftKey ? 5 : 0.5;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (directions[event.key] && surface().rules.move) {
      event.preventDefault(); const [dx, dy] = directions[event.key];
      updateSelected(layer => ({ ...layer, xMm: layer.xMm + dx, yMm: layer.yMm + dy }));
    }
  }, { signal });
  ui.shell.addEventListener('paste', event => {
    if (isTyping(event.target) || preview || busy) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(item => /^image\/(png|jpeg)$/.test(item.type));
    if (!file) return;
    event.preventDefault();
    void addImage(file).catch(() => {});
  }, { signal });
  ui.onLayout(layout => {
    if (layout === 'narrow') mobileTab = selected() ? 'adjust' : 'uploads';
    else leftOpen = layout === 'wide' || !design.layers.length;
    renderChrome(); drawOverlay();
  });

  const controller: CustomerController = {
    element: ui.element,
    getDesign() { ensureAlive(); finishRange(); return clone(design); },
    async setDesign(value: DesignDocument): Promise<void> {
      ensureAlive(); const candidate = assertDesign(template, clone(value));
      const issues = validateDesign(template, candidate); if (issues.length) throw issueError(issues[0]);
      const ticket = ++operation;
      busy = true; rangeBefore = null; renderControls();
      try {
        await renderer.preload(template, candidate, signal); ensureAlive();
        if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
        design = candidate; undo.length = 0; redo.length = 0;
        for (const asset of Object.values(design.assets).reverse()) rememberAsset(asset);
        selectedId = layersOf(activeSurfaceId).at(-1)?.id ?? ''; preview = false;
        renderControls(); await requestDraw(); ensureAlive();
        if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
        if (drawError) throw drawError;
        uploadError.replaceChildren();
        ui.setStatus(t('customer.designRestored', 'Saved design restored. Ready to edit.'));
        notifyChange();
      } finally { if (!destroyed && ticket === operation) { busy = false; renderControls(); } }
    },
    async setTemplate(value: ProductTemplate): Promise<void> {
      ensureAlive(); const candidate = assertTemplate(clone(value));
      if (candidate.status !== 'published') throw new EditorError('published-required', t('customer.publishedRequired', 'The customer editor requires a published template.'), true);
      const issues = validateTemplate(candidate); if (issues.length) throw issueError(issues[0]);
      const candidateDesign = createDesign(candidate); const ticket = ++operation;
      busy = true; rangeBefore = null; renderControls();
      try {
        await renderer.preload(candidate, candidateDesign, signal); ensureAlive();
        if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
        template = candidate; design = candidateDesign; activeSurfaceId = template.surfaces[0].id; activeViewId = template.views[0].id;
        view3d.hide(); stageCtl.suspended = false;
        chooseBoundView();
        selectedId = ''; undo.length = 0; redo.length = 0; preview = false; library = [];
        stageCtl.setContent(viewRect(template, activeViewId), true);
        if (ui.layout !== 'wide') { leftOpen = true; mobileTab = 'uploads'; }
        renderControls(); await requestDraw(); ensureAlive();
        if (ticket !== operation) throw new DOMException('A newer edit replaced this operation.', 'AbortError');
        if (drawError) throw drawError;
        uploadError.replaceChildren();
        ui.setStatus(t('customer.templateLoaded', 'Template loaded. Upload an image to begin.'));
        notifyChange();
      } finally { if (!destroyed && ticket === operation) { busy = false; renderControls(); } }
    },
    addImage,
    async exportPrint(surfaceId = activeSurfaceId): Promise<ExportResult> {
      ensureAlive(); finishRange();
      const issues = blockingIssues(false).filter(issue => !issue.surfaceId || issue.surfaceId === surfaceId);
      if (issues.length) throw issueError(issues[0]);
      if (!design.layers.some(layer => layer.surfaceId === surfaceId)) throw new EditorError('empty-export', t('customer.addBeforePrint', 'Add artwork to this print area before exporting.'), true);
      const result = await renderer.exportPrint(clone(template), clone(design), surfaceId); ensureAlive(); return result;
    },
    async exportPreview(): Promise<ExportResult> {
      ensureAlive(); finishRange();
      if (activeViewId === VIEW_3D && view3d.active) {
        // While the 3D view is open, the preview image is the current 3D render.
        const errors = validateDesign(template, design);
        if (errors.length) throw issueError(errors[0]);
        const blob = await view3d.snapshot();
        const bitmap = await createImageBitmap(blob);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close(); ensureAlive();
        return { blob, ...size, templateRevision: template.revision };
      }
      const result = await renderer.exportPreview(clone(template), clone(design), activeViewId); ensureAlive(); return result;
    },
    validate() { ensureAlive(); finishRange(); return clone(blockingIssues()); },
    createSnapshot(): SubmissionSnapshot {
      ensureAlive(); finishRange(); const issues = blockingIssues(); if (issues.length) throw issueError(issues[0]);
      return clone({ schemaVersion: 1, template, design, createdAt: new Date().toISOString() });
    },
    setTheme(theme) { ensureAlive(); ui.setTheme(theme); },
    destroy() {
      if (destroyed) return;
      destroyed = true; operation++; clearTimeout(thumbTimer); abort.abort(); stageCtl.destroy(); view3d.destroy(); renderer.dispose(); ui.destroy();
      undo.length = 0; redo.length = 0; rangeBefore = null; library = [];
      fileInput.value = ''; replaceInput.value = '';
      design = { ...design, assets: {}, layers: [] };
      template = { ...template, assets: {}, surfaces: [], views: [] };
    },
  };
  try {
    stageCtl.setContent(viewRect(template, activeViewId), true);
    leftOpen = ui.layout === 'wide' || !design.layers.length;
    mobileTab = selectedId ? 'adjust' : 'uploads';
    renderControls(); ui.setStatus(t('customer.loading', 'Loading product…'));
    await renderer.preload(template, design, signal);
    ensureAlive(); await requestDraw();
    if (drawError) throw drawError;
    scheduleThumbs();
    ui.setStatus(design.layers.length ? t('customer.designReady', 'Your design is ready to edit.') : t('customer.ready', 'Ready. Upload an image to begin.'));
    return controller;
  } catch (error) { controller.destroy(); throw error; }
}
