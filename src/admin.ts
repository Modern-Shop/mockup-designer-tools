import type { AdminController, AdminOptions, DesignDocument, ImageAsset, ModelPreset, PrintSurface, ProductTemplate, ProductView, SurfaceBinding, ValidationIssue } from './types.js';
import { assertTemplate, clone, copyTemplate, createDesign, EditorError, exportSize, MAX_MODEL_BYTES, newId, PRESET_PARTS, validateTemplate } from './core.js';
import { DEFAULT_PRESET_SIZE, defaultModelBinding, PRESET_SOFTNESS } from './presets.js';
import { Renderer, viewRect, type Rect } from './render.js';
import { downloadBlob, ingestImage } from './assets.js';
import { icon, type IconName } from './icons.js';
import { StageController, type GestureHandlers } from './stage.js';
import { View3D, VIEW_3D } from './view3d.js';
import { boxCorners, boxPoint, handleCursor, insideBox, pointsAttr, resizeBox, rotateBox, svg, type Box, type Handle, type Point } from './viewport.js';
import { button, callout, chip, createUI, field, iconButton, isTyping, node, numberField, section, segmented, setLabel, shortcutList, textInput, toggle } from './ui.js';

const CSS = `
.mdt-steps{display:flex;align-items:center;gap:2px;padding:3px;border-radius:11px;background:var(--mdt-ui-bg-3);max-inline-size:100%;overflow-x:auto;scrollbar-width:none}
.mdt-step{appearance:none;display:inline-flex;align-items:center;gap:7px;min-block-size:30px;padding-block:0;padding-inline:5px 11px;border:0;border-radius:8px;background:transparent;color:var(--mdt-ui-text-2);font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background-color .12s,color .12s,box-shadow .12s}
.mdt-step:hover{color:var(--mdt-ui-text)}
.mdt-step:disabled{opacity:.5;cursor:not-allowed}
.mdt-shell[data-mdt-layout=medium] .mdt-step:not([aria-current=step]) .mdt-step-label,.mdt-shell[data-mdt-layout=narrow] .mdt-step-label{display:none}
.mdt-shell[data-mdt-layout=medium] .mdt-step:not([aria-current=step]),.mdt-shell[data-mdt-layout=narrow] .mdt-step{padding-inline:5px}
.mdt-admin .mdt-top-start{min-inline-size:150px}
.mdt-step-num{display:grid;place-items:center;inline-size:20px;block-size:20px;border-radius:50%;background:var(--mdt-ui-bg);box-shadow:inset 0 0 0 1px var(--mdt-ui-line-2);font-size:10.5px;font-weight:700;color:var(--mdt-ui-text-3)}
.mdt-step[data-state=done] .mdt-step-num{background:var(--mdt-ui-ok-soft);box-shadow:none;color:var(--mdt-ui-ok)}
.mdt-step[data-state=issue] .mdt-step-num{background:var(--mdt-ui-warn-soft);box-shadow:none;color:var(--mdt-ui-warn)}
.mdt-step[aria-current=step]{background:var(--mdt-ui-bg);color:var(--mdt-ui-text);box-shadow:0 1px 3px rgba(16,24,40,.1),0 0 0 1px rgba(16,24,40,.03)}
.mdt-step[aria-current=step] .mdt-step-num{background:var(--mdt-ui-accent);box-shadow:none;color:var(--mdt-ui-on-accent)}
.mdt-panel-foot>.mdt-btn-soft{justify-content:space-between}
.mdt-color{appearance:none;inline-size:100%;block-size:34px;padding:3px;border:1px solid var(--mdt-ui-line-2);border-radius:var(--mdt-ui-r-sm);background:var(--mdt-ui-bg);cursor:pointer}
.mdt-color::-webkit-color-swatch-wrapper{padding:0}
.mdt-color::-webkit-color-swatch{border:0;border-radius:5px}
.mdt-color::-moz-color-swatch{border:0;border-radius:5px}
.mdt-admin-structure{display:none}
.mdt-shell[data-mdt-layout=medium] .mdt-admin-structure{display:inline-flex}
.mdt-tree{display:grid;gap:2px;padding:0 8px 6px}
.mdt-tree-item{display:flex;align-items:center;gap:2px;padding-inline-end:4px;border-radius:10px;transition:background-color .12s}
.mdt-tree-item:hover{background:var(--mdt-ui-hover)}
.mdt-tree-item[data-selected=true]{background:var(--mdt-ui-accent-soft)}
.mdt-tree-main{appearance:none;flex:1;min-inline-size:0;display:flex;align-items:center;gap:10px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.mdt-tree-thumb{flex:none;display:grid;place-items:center;inline-size:46px;block-size:40px;border-radius:8px;background:var(--mdt-ui-bg-3);box-shadow:inset 0 0 0 1px var(--mdt-ui-line);color:var(--mdt-ui-text-3);overflow:hidden}
.mdt-tree-thumb img{inline-size:100%;block-size:100%;object-fit:cover}
.mdt-tree-swatch{flex:none;display:grid;place-items:center;inline-size:32px;block-size:32px;border-radius:9px;background:var(--mdt-ui-bg-3);color:var(--mdt-ui-text-2)}
.mdt-tree-item[data-selected=true] .mdt-tree-swatch{background:var(--mdt-ui-accent);color:var(--mdt-ui-on-accent)}
.mdt-tree-text{display:grid;gap:1px;flex:1;min-inline-size:0}
.mdt-tree-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-tree-meta{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mdt-ui-text-3);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
.mdt-tree-meta[data-tone=warn]{color:var(--mdt-ui-warn)}
.mdt-tree-actions{display:flex;opacity:0;transition:opacity .12s}
.mdt-tree-item:hover .mdt-tree-actions,.mdt-tree-item:focus-within .mdt-tree-actions{opacity:1}
.mdt-tree-empty{padding:4px 16px 10px;font-size:12px;color:var(--mdt-ui-text-3)}
.mdt-step-intro{display:grid;gap:5px;padding:4px 16px 14px}
.mdt-step-kicker{font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--mdt-ui-accent-ink)}
.mdt-step-intro h2{font-size:16px;font-weight:650;letter-spacing:-.015em}
.mdt-photo-card{display:flex;align-items:center;gap:12px;padding:10px;border:1px solid var(--mdt-ui-line);border-radius:12px}
.mdt-photo-card img{flex:none;inline-size:60px;block-size:60px;border-radius:8px;object-fit:cover;background:var(--mdt-ui-bg-3)}
.mdt-photo-text{display:grid;gap:2px;flex:1;min-inline-size:0}
.mdt-photo-text strong{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-issue-list{display:grid;gap:6px}
.mdt-issue{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 12px;border-radius:10px;background:var(--mdt-ui-warn-soft);color:var(--mdt-ui-warn);font-size:12px;line-height:1.45}
.mdt-issue>span{flex:1;min-inline-size:0}
.mdt-output{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;background:var(--mdt-ui-bg-2);color:var(--mdt-ui-text-2);font-size:12px;font-variant-numeric:tabular-nums}
.mdt-output strong{color:var(--mdt-ui-text);font-weight:600}
.mdt-empty-state{display:grid;justify-items:center;gap:10px;padding:22px 16px;border:1.5px dashed var(--mdt-ui-line-2);border-radius:14px;text-align:center}
.mdt-empty-state p{font-size:12.5px;color:var(--mdt-ui-text-3)}
`;

type StepId = 'product' | 'area' | 'placement' | 'rules' | 'review';

/** Mount the merchant template builder without registering a global custom element. */
export async function mountAdmin(container: HTMLElement, options: AdminOptions): Promise<AdminController> {
  let template = clone(assertTemplate(options.template));
  const assetAdapter = options.assets;
  const ui = createUI(container, 'admin', { locale: options.locale, direction: options.direction, messages: options.messages, theme: options.theme }, CSS);
  const renderer = new Renderer();
  const t = ui.t, f = ui.format;
  const mod = ui.keys.mod;
  const abort = new AbortController();
  const signal = abort.signal;
  const steps: Array<{ id: StepId; label: string; title: string; description: string }> = [
    { id: 'product', label: t('admin.step.product', 'Product'), title: t('admin.productHeading', 'Start with your product'), description: t('admin.productDescription', 'Use a straight-on product photo. Add another view for the back or another angle.') },
    { id: 'area', label: t('admin.step.area', 'Print area'), title: t('admin.areaHeading', 'Define the physical print area'), description: t('admin.areaDescription', 'These measurements determine the print file. Moving the area on the photo will not change them.') },
    { id: 'placement', label: t('admin.step.placement', 'Placement'), title: t('admin.placementHeading', 'Place it on the product photo'), description: t('admin.placementDescription', 'Drag the outlined print area, or set its position below. Calibration artwork is for setup only.') },
    { id: 'rules', label: t('admin.step.rules', 'Customer options'), title: t('admin.rulesHeading', 'Keep the customer experience simple'), description: t('admin.rulesDescription', 'Choose the tools available for this print area. Locked operations remain enforced when a design is imported.') },
    { id: 'review', label: t('admin.step.review', 'Review'), title: t('admin.reviewHeading', 'Review your reusable template'), description: t('admin.reviewDescription', 'Check each view and area before publishing. Published revisions stay separate from later edits.') },
  ];
  let step = 0;
  let surfaceId = template.surfaces[0]?.id ?? '';
  let viewId = template.views[0]?.id ?? '';
  let destroyed = false;
  let uploading = false;
  let version = 0;
  let loadController = new AbortController();
  let uploadController: AbortController | undefined;
  let previewError = '';
  let renderQueued = false;
  let rendering = false;
  let showSample = true;
  let structureOpen = false;
  let gesture: 'move' | 'resize' | 'rotate' | null = null;
  let guides: Array<'v' | 'h'> = [];
  let readout: { text: string; at: Point } | null = null;
  let hoverSurface = '';
  let rebuildTimer = 0;
  let liveFields: Array<() => void> = [];
  const undo: ProductTemplate[] = [];
  const redo: ProductTemplate[] = [];
  let committed = copyTemplate(template);
  ui.canvas.setAttribute('aria-label', t('admin.canvasLabel', 'Product preview. In Placement, drag the selected print area or use the position fields.'));

  const sample = makeCalibrationAsset();
  const selectedSurface = () => template.surfaces.find(surface => surface.id === surfaceId);
  const selectedView = () => template.views.find(view => view.id === viewId);
  const selectedBinding = () => selectedView()?.bindings.find(binding => binding.surfaceId === surfaceId);

  // ── Top bar ────────────────────────────────────────────────────────────
  const structureButton = iconButton(t('admin.structure', 'Views and print areas'), 'panel', () => { structureOpen = !structureOpen; renderChrome(); }, { className: 'mdt-admin-structure' });
  const brand = node('div', 'mdt-brand mdt-hide-narrow'); brand.append(icon('crop', 18));
  const titleInput = node('input', 'mdt-title-input');
  titleInput.type = 'text'; titleInput.maxLength = 120; titleInput.dataset.mdtKey = 'title';
  titleInput.setAttribute('aria-label', t('admin.productName', 'Product name'));
  titleInput.addEventListener('change', () => rename(titleInput.value), { signal });
  titleInput.addEventListener('keydown', event => { if (event.key === 'Enter') titleInput.blur(); if (event.key === 'Escape') { titleInput.value = template.title; titleInput.blur(); } }, { signal });
  const stateChip = chip('', 'neutral', true);
  ui.topStart.append(structureButton, brand, titleInput, stateChip);
  const stepper = node('nav', 'mdt-steps');
  stepper.setAttribute('aria-label', t('admin.steps', 'Template setup steps'));
  ui.topCenter.append(stepper);
  const undoButton = iconButton(t('admin.undo', 'Undo'), 'undo', () => restoreHistory(undo, redo), { shortcut: `${mod}Z` });
  const redoButton = iconButton(t('admin.redo', 'Redo'), 'redo', () => restoreHistory(redo, undo), { shortcut: ui.keys.redo });
  const downloadButton = iconButton(t('admin.download', 'Download template JSON'), 'download', () => downloadTemplate());
  const testButton = button(t('admin.testCustomer', 'Test as customer'), () => testAsCustomer(), 'mdt-btn-ghost mdt-hide-narrow', 'play');
  const publishButton = button(t('admin.publish', 'Publish template'), () => { try { publish(); } catch (error) { showError(error); } }, 'mdt-btn-primary', 'send');
  ui.topTools.append(undoButton, redoButton, downloadButton);
  ui.topActions.append(testButton, publishButton);

  // ── Inspector and floating stage UI ───────────────────────────────────
  const inspectorBody = node('div', 'mdt-panel-body');
  const backButton = iconButton(t('admin.back', 'Back'), 'chevronLeft', () => goTo(step - 1), { side: 'top' });
  const nextButton = button('', () => step < steps.length - 1 ? goTo(step + 1) : testAsCustomer(), 'mdt-btn-soft');
  backButton.dataset.mdtKey = 'back'; nextButton.dataset.mdtKey = 'next';
  backButton.querySelector('svg')?.classList.add('mdt-icon-dir');
  const inspectorFoot = node('div', 'mdt-panel-foot'); inspectorFoot.append(backButton, nextButton);
  ui.right.append(inspectorBody, inspectorFoot);
  const photoInput = node('input');
  photoInput.type = 'file'; photoInput.accept = 'image/png,image/jpeg'; photoInput.hidden = true;
  photoInput.setAttribute('aria-label', t('admin.uploadPhoto', 'Upload product photo'));
  photoInput.addEventListener('change', () => { const file = photoInput.files?.[0]; if (file) void replacePhoto(file); }, { signal });
  ui.right.append(photoInput);

  const sampleButton = iconButton(t('admin.toggleSample', 'Show calibration artwork'), 'eye', () => { showSample = !showSample; renderControls(); requestRender(); }, { side: 'end' });
  const selbar = node('div', 'mdt-float mdt-selbar');
  selbar.setAttribute('role', 'toolbar');
  selbar.setAttribute('aria-label', t('admin.areaActions', 'Print area actions'));
  const sb = {
    center: iconButton(t('admin.centerArea', 'Center on photo'), 'center', () => centerBinding(), { side: 'top' }),
    match: iconButton(t('admin.matchProportions', 'Match print proportions'), 'resize', () => matchProportions(), { side: 'top' }),
    straighten: iconButton(t('admin.resetRotation', 'Reset rotation'), 'rotateCcw', () => mutateBinding(binding => { binding.rotation = 0; }), { side: 'top' }),
    disconnect: iconButton(t('admin.disconnect', 'Disconnect from view'), 'unlink', () => disconnect(), { side: 'top', className: 'mdt-btn-danger' }),
  };
  selbar.append(sb.center, sb.match, sb.straighten, node('span', 'mdt-divider'), sb.disconnect);
  const banner = node('div', 'mdt-float mdt-banner');
  const bannerText = node('span');
  const bannerButton = button(t('admin.connect', 'Connect print area'), () => connect(), 'mdt-btn-soft mdt-btn-sm', 'link');
  banner.append(icon('info', 16), bannerText, bannerButton);
  const stageEmpty = node('div', 'mdt-stage-empty');
  const emptyCard = node('div', 'mdt-empty-card');
  const emptyIcon = node('div', 'mdt-empty-icon'); emptyIcon.append(icon('image', 26));
  emptyCard.append(emptyIcon, node('h3', '', t('admin.emptyStageTitle', 'Add a product photo')), node('p', '', t('admin.emptyStageText', 'Drop a straight-on PNG or JPEG photo here, or choose a file. You can add more views later.')), button(t('admin.uploadPhoto', 'Upload product photo'), () => photoInput.click(), 'mdt-btn-primary', 'upload'));
  stageEmpty.append(emptyCard);
  const readoutTag = node('div', 'mdt-readout');
  ui.floating.append(selbar, banner);
  ui.stage.append(stageEmpty);
  const summaryText = node('span', 'mdt-hide-narrow');
  const helpButton = iconButton(t('admin.shortcuts', 'Keyboard shortcuts'), 'keyboard', () => openShortcuts(), { className: 'mdt-btn-sm', shortcut: '?' });
  ui.statusEnd.append(summaryText, helpButton);

  const stageCtl = new StageController({
    ui, signal, begin, hover,
    changed: () => { requestRender(); drawOverlay(); },
    files: files => { const file = files[0]; if (file) void replacePhoto(file); },
    dropLabel: t('admin.dropPhoto', 'Drop to use as the product photo'),
  });
  stageCtl.tools.append(node('span', 'mdt-divider'), sampleButton);
  let modelParts: string[] = [];
  const presetNames: Record<ModelPreset, string> = {
    tshirt: t('admin.model.tshirt', 'T-shirt'), hoodie: t('admin.model.hoodie', 'Hoodie'), sweater: t('admin.model.sweater', 'Sweater'), cap: t('admin.model.cap', 'Cap'),
    mug: t('admin.model.mug', 'Mug'), cushion: t('admin.model.cushion', 'Cushion'), box: t('admin.model.box', 'Box'), card: t('admin.model.card', 'Card or label'),
  };
  const partNames: Record<string, string> = {
    front: t('admin.part.front', 'Front'), back: t('admin.part.back', 'Back'), wrap: t('admin.part.wrap', 'Around the mug'),
    left: t('admin.part.left', 'Left side'), right: t('admin.part.right', 'Right side'), top: t('admin.part.top', 'Top'),
    'left-sleeve': t('admin.part.leftSleeve', 'Left sleeve'), 'right-sleeve': t('admin.part.rightSleeve', 'Right sleeve'),
  };
  const view3d = new View3D({
    ui, renderer, template: () => template,
    design: () => showSample ? sampleDesign(template) : createDesign(template),
    onFallback: () => selectView(template.views[0]?.id ?? ''),
    onParts: parts => { modelParts = parts; scheduleControls(); },
  });
  const modelInput = node('input');
  modelInput.type = 'file'; modelInput.accept = '.glb,model/gltf-binary'; modelInput.hidden = true;
  modelInput.setAttribute('aria-label', t('admin.modelUpload', 'Upload GLB model'));
  modelInput.addEventListener('change', () => { const file = modelInput.files?.[0]; if (file) void uploadModel(file); }, { signal });
  ui.right.append(modelInput);

  function ensureAlive(): void {
    if (destroyed) throw new EditorError('destroyed', t('errors.destroyed', 'This editor has been destroyed.'), true);
  }
  function emit(name: string, detail: unknown): void {
    if (!destroyed) ui.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  function showError(error: unknown): void {
    if (destroyed || (error instanceof DOMException && error.name === 'AbortError')) return;
    const message = ui.errorText(error);
    ui.setStatus(message, true);
    emit('mdt:error', { message });
  }
  function makeCalibrationAsset(): ImageAsset {
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new EditorError('canvas-unavailable', t('errors.canvas', 'Canvas rendering is not available.'), true);
    ctx.fillStyle = '#f3f1ff'; ctx.fillRect(0, 0, 600, 600);
    ctx.strokeStyle = 'rgba(79,91,255,.35)'; ctx.lineWidth = 2;
    for (let coordinate = 0; coordinate <= 600; coordinate += 60) {
      ctx.beginPath(); ctx.moveTo(coordinate, 0); ctx.lineTo(coordinate, 600); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, coordinate); ctx.lineTo(600, coordinate); ctx.stroke();
    }
    ctx.fillStyle = '#4f5bff'; ctx.fillRect(0, 0, 600, 108);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 39px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t('admin.calibrationTop', 'TOP ↑'), 300, 70);
    ctx.fillStyle = '#f0359a'; ctx.fillRect(18, 480, 100, 100);
    ctx.fillStyle = '#28307a'; ctx.font = 'bold 45px system-ui, sans-serif';
    ctx.fillText(t('admin.calibrationSample', 'YOUR DESIGN'), 300, 300);
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(t('admin.calibrationLeft', 'LEFT'), 76, 550);
    return { id: newId('mdt-calibration'), name: t('admin.calibration', 'Calibration artwork'), src: canvas.toDataURL('image/png'), width: 600, height: 600, mimeType: 'image/png' };
  }
  function sampleDesign(source: ProductTemplate): DesignDocument {
    const design = createDesign(source);
    design.assets[sample.id] = sample;
    design.layers = source.surfaces.map(surface => ({
      id: `mdt-calibration-${surface.id}`, surfaceId: surface.id, assetId: sample.id,
      xMm: surface.widthMm / 2, yMm: surface.heightMm / 2,
      widthMm: surface.widthMm, heightMm: surface.heightMm, rotation: 0,
    }));
    return design;
  }
  function requestRender(): void {
    if (destroyed) return;
    if (viewId === VIEW_3D) { view3d.refresh(); return; }
    renderQueued = true;
    if (rendering) return;
    rendering = true;
    void (async () => {
      try {
        while (!destroyed && renderQueued) {
          renderQueued = false;
          const snapshot = copyTemplate(template);
          const chosenView = snapshot.views.find(view => view.id === viewId) ?? snapshot.views[0];
          if (!chosenView) {
            const ctx = ui.canvas.getContext('2d');
            if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height); }
            continue;
          }
          try {
            await renderer.renderPreview(ui.canvas, snapshot, showSample ? sampleDesign(snapshot) : createDesign(snapshot), chosenView.id, { guides: false, viewport: stageCtl.viewport.state });
            if (!destroyed && previewError) { previewError = ''; scheduleControls(); }
          } catch (error) {
            if (!destroyed) {
              previewError = error instanceof Error ? ui.errorText(error) : t('errors.preview', 'The product preview could not be loaded.');
              showError(error);
            }
          }
        }
      } finally { rendering = false; }
    })();
  }

  // ── History and change tracking ───────────────────────────────────────
  // Embedded GLB data can be megabytes; compare a fingerprint instead of the whole string.
  const fingerprint = (src?: string) => src ? `${src.length}:${src.slice(0, 80)}:${src.slice(-80)}` : undefined;
  const signature = (value: ProductTemplate) => JSON.stringify({ ...value, assets: Object.keys(value.assets).sort(), status: '', revision: '', model3d: value.model3d ? { ...value.model3d, src: fingerprint(value.model3d.src) } : undefined });
  function beginDraft(): void {
    if (template.status === 'published') template.revision = newId('draft');
    template.status = 'draft';
  }
  /** Record a finished edit: a new draft revision, one undo step, and a host event. */
  function changed(): void {
    if (signature(template) !== signature(committed)) {
      beginDraft();
      undo.push(committed); if (undo.length > 60) undo.shift(); redo.length = 0;
      committed = copyTemplate(template);
      emit('mdt:template-change', { template: clone(template) });
    }
    scheduleControls();
    requestRender();
  }
  function restoreHistory(from: ProductTemplate[], to: ProductTemplate[]): void {
    if (uploading || gesture) return;
    const next = from.pop(); if (!next) return;
    to.push(committed);
    template = copyTemplate(next); committed = next;
    if (!selectedSurface()) surfaceId = template.surfaces[0]?.id ?? '';
    if (viewId === VIEW_3D && !template.model3d) { view3d.hide(); stageCtl.suspended = false; viewId = template.views[0]?.id ?? ''; }
    if (viewId !== VIEW_3D && !selectedView()) viewId = template.views[0]?.id ?? '';
    stageCtl.setContent(viewRect(template, viewId));
    renderControls(); requestRender();
    emit('mdt:template-change', { template: clone(template) });
    ui.setStatus(t('admin.historyRestored', 'Previous template state restored.'));
  }
  function scheduleControls(): void {
    // Deferred so focus can move first when a field commits on Tab. A timer (not a frame) also runs in hidden pages.
    clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => renderControls(), 0);
  }

  // ── Mutations ─────────────────────────────────────────────────────────
  function rename(value: string): void {
    const next = value.trim();
    if (!next) { titleInput.value = template.title; ui.setStatus(t('admin.nameRequired', 'Please enter a name.'), true); return; }
    template.title = next; changed();
  }
  function defaultBinding(id: string): SurfaceBinding {
    const surface = template.surfaces.find(item => item.id === id);
    const asset = selectedView() && template.assets[selectedView()!.assetId];
    const binding = { surfaceId: id, x: .32, y: .25, width: .36, height: .5, rotation: 0 };
    if (surface && asset) {
      // Start with an outline that matches the physical proportions on this photo.
      const ratio = surface.heightMm / surface.widthMm * asset.width / asset.height;
      binding.height = Math.min(.6, binding.width * ratio);
      binding.width = binding.height / ratio;
      binding.x = (1 - binding.width) / 2; binding.y = Math.max(0, (1 - binding.height) / 2 - .04);
    }
    return binding;
  }
  function round(value: number, digits = 2): number { const k = 10 ** digits; return Math.round(value * k) / k; }
  function normalizeBinding(binding: SurfaceBinding): void {
    binding.width = Math.max(.01, Math.min(1, binding.width));
    binding.height = Math.max(.01, Math.min(1, binding.height));
    binding.x = Math.max(0, Math.min(1 - binding.width, binding.x));
    binding.y = Math.max(0, Math.min(1 - binding.height, binding.y));
  }
  function mutateBinding(update: (binding: SurfaceBinding) => void): void {
    const binding = selectedBinding(); if (!binding || uploading) return;
    update(binding); normalizeBinding(binding); changed();
  }
  function centerBinding(): void { mutateBinding(binding => { binding.x = (1 - binding.width) / 2; binding.y = (1 - binding.height) / 2; }); }
  function aspectMismatch(binding: SurfaceBinding): number {
    const surface = template.surfaces.find(item => item.id === binding.surfaceId);
    const asset = selectedView() && template.assets[selectedView()!.assetId];
    if (!surface || !asset) return 0;
    return (binding.height * asset.height) / (binding.width * asset.width) / (surface.heightMm / surface.widthMm) - 1;
  }
  function matchProportions(): void {
    const surface = selectedSurface(); const asset = selectedView() && template.assets[selectedView()!.assetId];
    if (!surface || !asset) return;
    mutateBinding(binding => {
      const cx = binding.x + binding.width / 2, cy = binding.y + binding.height / 2;
      const ratio = surface.heightMm / surface.widthMm * asset.width / asset.height;
      binding.height = binding.width * ratio;
      if (binding.height > 1) { binding.height = 1; binding.width = 1 / ratio; }
      binding.x = cx - binding.width / 2; binding.y = cy - binding.height / 2;
    });
    ui.setStatus(t('admin.proportionsMatched', 'Outline proportions now match the print size.'));
  }
  function connect(): void {
    const view = selectedView(), surface = selectedSurface();
    if (!view || !surface || selectedBinding()) return;
    view.bindings.push(defaultBinding(surface.id)); changed();
    ui.setStatus(t('admin.connected', 'Print area placed on this view. Drag it into position.'));
  }
  function disconnect(): void {
    const view = selectedView(), binding = selectedBinding();
    if (!view || !binding) return;
    view.bindings = view.bindings.filter(item => item !== binding); changed();
    ui.setStatus(t('admin.disconnected', 'Print area removed from this view. Undo to restore it.'));
  }
  function addSurface(): void {
    if (template.surfaces.length >= 16) return;
    const surface: PrintSurface = {
      id: newId('surface'), label: t('admin.newArea', 'Print area {number}', { number: template.surfaces.length + 1 }),
      widthMm: 240, heightMm: 300, dpi: 300, minDpi: 150, safeMm: 5, bleedMm: 0, required: false,
      rules: { move: true, resize: true, rotate: true, maxLayers: 8 },
    };
    template.surfaces.push(surface); surfaceId = surface.id;
    selectedView()?.bindings.push(defaultBinding(surface.id));
    const model = template.model3d;
    if (model?.kind === 'preset' && model.preset) {
      const free = PRESET_PARTS[model.preset].find(part => !model.bindings.some(binding => binding.part === part));
      if (free) model.bindings.push(defaultModelBinding(model.preset, surface.id, free));
    }
    changed(); ui.setStatus(t('admin.areaAdded', 'Print area added.'));
  }
  function removeSurface(id = surfaceId): void {
    if (template.surfaces.length <= 1) return;
    template.surfaces = template.surfaces.filter(surface => surface.id !== id);
    for (const view of template.views) view.bindings = view.bindings.filter(binding => binding.surfaceId !== id);
    if (template.model3d) template.model3d.bindings = template.model3d.bindings.filter(binding => binding.surfaceId !== id);
    if (surfaceId === id) surfaceId = template.surfaces[0].id;
    changed();
    ui.setStatus(t('admin.areaRemoved', 'Print area removed from this draft.'));
  }
  function addView(): void {
    if (template.views.length >= 24) return;
    const current = selectedView();
    if (!current) { photoInput.click(); return; }
    const binding = current.bindings.find(item => item.surfaceId === surfaceId);
    const next: ProductView = { id: newId('view'), label: t('admin.newView', 'View {number}', { number: template.views.length + 1 }), assetId: current.assetId, bindings: binding ? [clone(binding)] : [] };
    template.views.push(next); viewId = next.id;
    stageCtl.setContent(viewRect(template, viewId), true);
    changed();
    ui.setStatus(t('admin.viewAdded', 'View added. Upload its photo and check its print-area placement.'));
  }
  function removeView(id = viewId): void {
    if (template.views.length <= 1) return;
    template.views = template.views.filter(view => view.id !== id);
    if (viewId === id) viewId = template.views[0].id;
    prunePhotoAssets(template);
    stageCtl.setContent(viewRect(template, viewId), true);
    changed();
    ui.setStatus(t('admin.viewRemoved', 'View removed from this draft.'));
  }
  function selectView(id: string): void {
    if (id === viewId) return;
    viewId = id;
    const on = id === VIEW_3D;
    stageCtl.suspended = on;
    if (on) void view3d.show().then(() => view3d.focus(surfaceId));
    else { view3d.hide(); stageCtl.setContent(viewRect(template, viewId), true); }
    renderControls(); requestRender();
  }
  function selectSurface(id: string): void {
    if (id === surfaceId) return;
    surfaceId = id;
    if (viewId === VIEW_3D) view3d.focus(id);
    renderControls(); requestRender();
  }
  /** Chooses a generated shape, keeping color and mapping each print area to a free part in order. */
  function setPreset(preset: ModelPreset): void {
    const previous = template.model3d;
    const parts = PRESET_PARTS[preset];
    template.model3d = {
      kind: 'preset', preset, color: previous?.color ?? '#f4f3ef',
      bindings: template.surfaces.slice(0, parts.length).map((surface, index) => defaultModelBinding(preset, surface.id, parts[index])),
    };
    changed();
    if (viewId !== VIEW_3D) selectView(VIEW_3D);
    ui.setStatus(t('admin.modelReady', '3D model ready. Place each print area on it in Placement.'));
  }
  /** Adds a studio photo view per bound part of the 3D model, with its print areas already placed. */
  async function photosFromModel(): Promise<void> {
    const model = template.model3d;
    if (destroyed || uploading || !model) return;
    const currentVersion = version;
    uploadController?.abort();
    const operation = new AbortController(); uploadController = operation;
    uploading = true; renderControls();
    ui.setStatus(t('admin.photosPreparing', 'Creating product photos from the 3D model…'));
    try {
      const { renderProductPhotos } = await import('./model3d.js');
      const photos = (await renderProductPhotos(model, template.surfaces, { signal: operation.signal })).slice(0, Math.max(0, 24 - template.views.length));
      if (destroyed || currentVersion !== version || operation.signal.aborted) return;
      if (!photos.length) { ui.setStatus(t('admin.photosNone', 'Place a print area on the 3D model first.'), true); return; }
      const candidate = copyTemplate(template);
      const added: string[] = [];
      for (const photo of photos) {
        const blob = await new Promise<Blob>((resolve, reject) => photo.image.toBlob(value => value ? resolve(value) : reject(new EditorError('export-failed', t('errors.export-failed', 'PNG export failed. Try a smaller output.'), true)), 'image/png'));
        photo.image.width = photo.image.height = 0;
        const label = (model.kind === 'preset' ? partNames[photo.part] : undefined) ?? photo.part;
        const file = new File([blob], `${photo.part}.png`, { type: 'image/png' });
        const asset = assetAdapter ? await assetAdapter.ingest(file, { signal: operation.signal }) : await ingestImage(file, { signal: operation.signal });
        if (destroyed || currentVersion !== version || operation.signal.aborted) return;
        candidate.assets[asset.id] = asset;
        const next: ProductView = { id: newId('view'), label, assetId: asset.id, bindings: photo.bindings };
        candidate.views.push(next); added.push(next.id);
      }
      assertTemplate(candidate);
      await renderer.preload(candidate, sampleDesign(candidate), operation.signal);
      if (destroyed || currentVersion !== version || operation.signal.aborted) return;
      template = candidate; previewError = '';
      changed();
      selectView(added[0]);
      ui.setStatus(ui.plural('admin.photosReady', added.length, { one: 'Added {count} view from the 3D model. Check its print-area placement.', other: 'Added {count} views from the 3D model. Check their print-area placement.' }));
    } catch (error) { showError(error); }
    finally {
      if (!destroyed && uploadController === operation) { uploading = false; uploadController = undefined; renderControls(); }
    }
  }
  function removeModel(): void {
    if (!template.model3d) return;
    delete template.model3d;
    if (viewId === VIEW_3D) selectView(template.views[0]?.id ?? '');
    changed();
    ui.setStatus(t('admin.modelRemoved', '3D model removed. Undo to restore it.'));
  }
  async function uploadModel(file: File): Promise<void> {
    if (uploading) return;
    if (file.size > MAX_MODEL_BYTES) { showError(new EditorError('model-too-large', t('errors.model-too-large', 'Choose a 3D model smaller than 15 MB.'), true)); modelInput.value = ''; return; }
    uploading = true; renderControls();
    ui.setStatus(t('admin.preparingModel', 'Checking the 3D model…'));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Validate before storing: the parser rejects malformed or unsupported files with a reason.
      const { parseGlb } = await import('./glb.js');
      const parts = [...new Set(parseGlb(bytes.buffer).parts.filter(part => part.printable).map(part => part.name))];
      let stored: { src: string; name: string };
      if (assetAdapter?.ingestModel) stored = await assetAdapter.ingestModel(file, { signal });
      else {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        stored = { src: `data:model/gltf-binary;base64,${btoa(binary)}`, name: file.name };
      }
      if (destroyed) return;
      const candidate = copyTemplate(template);
      candidate.model3d = {
        kind: 'gltf', src: stored.src, name: (stored.name || file.name || 'model.glb').slice(0, 120), color: '#ffffff',
        bindings: candidate.surfaces[0] && parts[0] ? [{ surfaceId: candidate.surfaces[0].id, part: parts[0], x: .5, y: .5, width: .5, height: .5 }] : [],
      };
      assertTemplate(candidate);
      template = candidate; modelParts = parts;
      changed();
      if (viewId !== VIEW_3D) selectView(VIEW_3D);
      ui.setStatus(t('admin.modelReady', '3D model ready. Place each print area on it in Placement.'));
    } catch (error) { showError(error); }
    finally { if (!destroyed) { uploading = false; modelInput.value = ''; renderControls(); } }
  }
  function goTo(index: number): void {
    step = Math.max(0, Math.min(steps.length - 1, index));
    if (ui.layout === 'medium') structureOpen = false;
    renderControls(); requestRender();
  }
  async function replacePhoto(file: File): Promise<void> {
    if (destroyed) return;
    const view = selectedView();
    const currentVersion = version;
    uploadController?.abort();
    const operation = new AbortController(); uploadController = operation;
    uploading = true; renderControls();
    ui.setStatus(t('admin.preparingPhoto', 'Preparing product photo…'));
    try {
      const asset = assetAdapter
        ? await assetAdapter.ingest(file, { signal: operation.signal })
        : await ingestImage(file, { signal: operation.signal });
      if (destroyed || currentVersion !== version || operation.signal.aborted) return;
      const candidate = copyTemplate(template);
      let target = view && candidate.views.find(item => item.id === view.id);
      if (!target) {
        target = { id: newId('view'), label: t('admin.firstView', 'Front'), assetId: asset.id, bindings: [] };
        candidate.views.push(target);
      }
      candidate.assets[asset.id] = asset; target.assetId = asset.id;
      prunePhotoAssets(candidate);
      assertTemplate(candidate);
      await renderer.preload(candidate, sampleDesign(candidate), operation.signal);
      if (destroyed || currentVersion !== version || operation.signal.aborted) return;
      template = candidate; viewId = target.id; previewError = '';
      if (surfaceId && !target.bindings.length) target.bindings.push(defaultBinding(surfaceId));
      stageCtl.setContent(viewRect(template, viewId), true);
      changed();
      ui.setStatus(t('admin.photoReady', 'Product photo ready. Check the print-area placement.'));
    } catch (error) { showError(error); }
    finally {
      if (!destroyed && uploadController === operation) { uploading = false; uploadController = undefined; photoInput.value = ''; renderControls(); }
    }
  }
  function prunePhotoAssets(source: ProductTemplate): void {
    const used = new Set(source.views.map(view => view.assetId));
    source.assets = Object.fromEntries(Object.entries(source.assets).filter(([id]) => used.has(id)));
  }
  function downloadTemplate(): void {
    try { ensureAlive(); downloadBlob(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }), 'mockup-template.json'); ui.setStatus(t('admin.downloaded', 'Template JSON downloaded.')); } catch (error) { showError(error); }
  }
  function testAsCustomer(): void {
    try { const published = publish(); emit('mdt:test', { template: published }); } catch (error) { showError(error); }
  }
  function publish(): ProductTemplate {
    ensureAlive();
    if (uploading) throw new EditorError('upload-pending', t('admin.waitUpload', 'Wait for the product photo to finish loading.'), true);
    if (previewError) throw new EditorError('preview-failed', previewError, true);
    const issues = validateTemplate(template);
    if (issues.length) {
      step = 4; renderControls();
      throw new EditorError(issues[0].code, issues.map(issueText).join(' '), true);
    }
    if (template.status === 'published') return clone(template);
    const published = clone(template);
    published.status = 'published'; published.revision = newId('revision');
    template = published; committed = copyTemplate(published);
    renderControls();
    emit('mdt:publish', { template: clone(published) });
    ui.setStatus(t('admin.publishReady', 'Published revision prepared. The host application controls storage and availability.'));
    return clone(published);
  }

  // ── Validation helpers ────────────────────────────────────────────────
  function issueText(issue: ValidationIssue): string {
    const surface = template.surfaces.find(item => item.id === issue.surfaceId);
    const message = t(`errors.${issue.code}`, issue.message, { area: surface?.label ?? '' });
    return surface ? t('admin.areaIssue', '{area}: {message}', { area: surface.label, message }) : message;
  }
  function stepOf(issue: ValidationIssue): number {
    switch (issue.code) {
      case 'missing-product-image': return 0;
      case 'empty-template': return template.views.length ? 1 : 0;
      case 'invalid-dimensions': case 'export-limit': case 'invalid-contour': case 'contour-bleed': return 1;
      case 'missing-mapping': case 'empty-view': case 'invalid-mapping': return 2;
      default: return 4;
    }
  }

  // ── Rendering of controls ─────────────────────────────────────────────
  function renderChrome(): void {
    ui.shell.dataset.mdtLeft = ui.layout !== 'medium' || structureOpen ? 'open' : 'closed';
    structureButton.setAttribute('aria-pressed', String(structureOpen));
  }
  function renderStepper(issues: ValidationIssue[]): void {
    const hasViews = template.views.length > 0, hasAreas = template.surfaces.length > 0;
    const states = steps.map((_, index) => {
      const flagged = issues.some(issue => stepOf(issue) === index && (issue.code !== 'empty-template' || index === (hasViews ? 1 : 0)));
      if (index === 0) return flagged || !hasViews ? 'issue' : 'done';
      if (index === 1) return flagged || !hasAreas ? 'issue' : 'done';
      if (index === 2) return flagged ? 'issue' : hasViews && hasAreas ? 'done' : 'todo';
      if (index === 3) return hasAreas ? 'done' : 'todo';
      return issues.length ? 'issue' : 'done';
    });
    ui.preserveFocus(() => stepper.replaceChildren(...steps.map((item, index) => {
      const control = node('button', 'mdt-step');
      control.type = 'button'; control.dataset.mdtKey = `step-${index}`; control.dataset.state = states[index]; control.dataset.mdtTip = item.label;
      control.disabled = uploading;
      const number = node('span', 'mdt-step-num');
      if (states[index] === 'done' && index !== step) number.append(icon('check', 12)); else number.textContent = f(index + 1);
      control.append(number, node('span', 'mdt-step-label', item.label));
      control.setAttribute('aria-label', states[index] === 'issue' ? t('admin.stepLabelIssue', '{number}. {label} · needs attention', { number: index + 1, label: item.label }) : t('admin.stepLabel', '{number}. {label}', { number: index + 1, label: item.label }));
      if (index === step) control.setAttribute('aria-current', 'step');
      control.addEventListener('click', () => goTo(index));
      return control;
    })));
  }
  function treeItem(selected: boolean, key: string, media: Node, name: string, meta: Node | string, onSelect: () => void, actions: HTMLElement[]): HTMLLIElement {
    const item = node('li', 'mdt-tree-item');
    item.dataset.selected = String(selected);
    const main = node('button', 'mdt-tree-main');
    main.type = 'button'; main.dataset.mdtKey = key; main.disabled = uploading;
    main.setAttribute('aria-pressed', String(selected));
    const text = node('span', 'mdt-tree-text');
    const metaNode = node('span', 'mdt-tree-meta'); metaNode.append(meta);
    text.append(node('span', 'mdt-tree-name', name), metaNode);
    main.append(media, text);
    main.addEventListener('click', onSelect);
    const tools = node('span', 'mdt-tree-actions'); tools.append(...actions);
    item.append(main, tools);
    return item;
  }
  function shapeOf(surface: PrintSurface): 'rectangle' | 'ellipse' | 'diamond' | 'custom' {
    const close = (a: number, b: number) => Math.abs(a - b) < .00001;
    const diamond = [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }];
    if (!surface.clip) return 'rectangle';
    if (surface.clip.length === 4 && surface.clip.every((point, index) => close(point.x, diamond[index].x) && close(point.y, diamond[index].y))) return 'diamond';
    if (surface.clip.length === 40 && surface.clip.every((point, index) => close(point.x, .5 + Math.cos(index / 40 * Math.PI * 2) * .5) && close(point.y, .5 + Math.sin(index / 40 * Math.PI * 2) * .5))) return 'ellipse';
    return 'custom';
  }
  const shapeIcon: Record<ReturnType<typeof shapeOf>, IconName> = { rectangle: 'rectangle', ellipse: 'ellipse', diamond: 'diamond', custom: 'polygon' };
  function renderStructure(): void {
    const view = selectedView();
    const viewsHead = node('h3', 'mdt-section-title');
    const addViewButton = iconButton(t('admin.addView', 'Add view'), 'plus', addView, { className: 'mdt-btn-sm' });
    addViewButton.dataset.mdtKey = 'add-view'; addViewButton.disabled = uploading || template.views.length >= 24;
    viewsHead.append(node('span', '', t('admin.views', 'Views')), addViewButton);
    const viewList = node('ul', 'mdt-tree');
    viewList.setAttribute('aria-label', t('admin.views', 'Views'));
    for (const item of template.views) {
      const asset = template.assets[item.assetId];
      const thumb = node('span', 'mdt-tree-thumb');
      if (asset) { const image = node('img'); image.alt = ''; image.src = asset.src; image.decoding = 'async'; thumb.append(image); } else thumb.append(icon('image', 18));
      const remove = iconButton(t('admin.removeViewNamed', 'Remove view {name}', { name: item.label }), 'trash', () => removeView(item.id), { className: 'mdt-btn-sm mdt-btn-danger', size: 16 });
      remove.dataset.mdtKey = `remove-view-${item.id}`; remove.disabled = uploading || template.views.length <= 1;
      viewList.append(treeItem(item.id === viewId, `view-${item.id}`, thumb, item.label, ui.plural('admin.viewAreas', item.bindings.length, { one: '{count} print area', other: '{count} print areas' }), () => selectView(item.id), [remove]));
    }
    const model = template.model3d;
    if (model) {
      const thumb = node('span', 'mdt-tree-thumb'); thumb.append(icon('cube', 20));
      const remove = iconButton(t('admin.removeModel', 'Remove 3D model'), 'trash', removeModel, { className: 'mdt-btn-sm mdt-btn-danger', size: 16 });
      remove.dataset.mdtKey = 'remove-model'; remove.disabled = uploading;
      viewList.append(treeItem(viewId === VIEW_3D, 'view-3d', thumb, t('admin.model3d', '3D model'), modelName(), () => selectView(VIEW_3D), [remove]));
    }
    const viewsSection = node('section', 'mdt-section'); viewsSection.style.paddingInline = '8px';
    viewsHead.style.paddingInline = '8px';
    viewsSection.append(viewsHead);
    if (template.views.length || model) viewsSection.append(viewList);
    else viewsSection.append(node('p', 'mdt-tree-empty', t('admin.noViews', 'No views yet. Upload a product photo to create the first one.')));

    const areasHead = node('h3', 'mdt-section-title');
    areasHead.style.paddingInline = '8px';
    const addAreaButton = iconButton(t('admin.addArea', 'Add print area'), 'plus', addSurface, { className: 'mdt-btn-sm' });
    addAreaButton.dataset.mdtKey = 'add-area'; addAreaButton.disabled = uploading || template.surfaces.length >= 16;
    areasHead.append(node('span', '', t('admin.areas', 'Print areas')), addAreaButton);
    const areaList = node('ul', 'mdt-tree');
    areaList.setAttribute('aria-label', t('admin.areas', 'Print areas'));
    for (const item of template.surfaces) {
      const swatch = node('span', 'mdt-tree-swatch'); swatch.append(icon(shapeIcon[shapeOf(item)], 16));
      const in3d = viewId === VIEW_3D;
      const placed = in3d ? !!model?.bindings.some(binding => binding.surfaceId === item.id) : !!view?.bindings.some(binding => binding.surfaceId === item.id);
      const meta = document.createDocumentFragment();
      meta.append(t('admin.dimensions', '{width} × {height} mm', { width: item.widthMm, height: item.heightMm }));
      if ((view || in3d) && !placed) { const off = node('span', 'mdt-row'); off.style.gap = '3px'; off.append(' · ', icon('unlink', 11), t('admin.notOnView', 'not on this view')); meta.append(off); }
      const remove = iconButton(t('admin.removeAreaNamed', 'Remove print area {name}', { name: item.label }), 'trash', () => removeSurface(item.id), { className: 'mdt-btn-sm mdt-btn-danger', size: 16 });
      remove.dataset.mdtKey = `remove-area-${item.id}`; remove.disabled = uploading || template.surfaces.length <= 1;
      const entry = treeItem(item.id === surfaceId, `area-${item.id}`, swatch, item.label + (item.required ? ` · ${t('admin.requiredShort', 'Required')}` : ''), meta, () => selectSurface(item.id), [remove]);
      if ((view || in3d) && !placed) entry.querySelector('.mdt-tree-meta')?.setAttribute('data-tone', 'warn');
      areaList.append(entry);
    }
    const areasSection = node('section', 'mdt-section'); areasSection.style.paddingInline = '8px';
    areasSection.append(areasHead);
    if (template.surfaces.length) areasSection.append(areaList);
    else areasSection.append(node('p', 'mdt-tree-empty', t('admin.noAreas', 'No print areas yet. Add one to define where printing happens.')));
    ui.preserveFocus(() => ui.left.replaceChildren(viewsSection, areasSection));
  }
  function numberRow(label: string, value: number, options: { prefix?: string; prefixIcon?: IconName; unit?: string; min: number; max: number; step: number; digits?: number; key: string }, update: (value: number) => void, live = false): HTMLElement {
    const input = numberField({
      label, prefix: options.prefix, prefixIcon: options.prefixIcon, unit: options.unit, min: options.min, max: options.max, step: options.step, digits: options.digits ?? 2, key: options.key,
      onInput: live ? value => { update(value); requestRender(); drawOverlay(); } : undefined,
      onCommit: value => { update(value); changed(); ui.setStatus(t('admin.updated', 'Draft updated.')); },
    });
    input.set(value);
    input.disable(uploading);
    return options.prefix || options.prefixIcon ? input.element : field(label, input.element);
  }
  function renderProductStep(): Node[] {
    const view = selectedView();
    const nodes: Node[] = [section(undefined, field(t('admin.productName', 'Product name'), textInput(template.title, t('admin.productName', 'Product name'), rename, 'product-name')))];
    const dropzone = node('button', 'mdt-dropzone');
    dropzone.type = 'button'; dropzone.dataset.mdtKey = 'photo-drop'; dropzone.disabled = uploading;
    const dropIcon = node('span', 'mdt-dropzone-icon'); dropIcon.append(icon(view ? 'replace' : 'upload', 22));
    dropzone.append(dropIcon, node('strong', '', view ? t('admin.replacePhoto', 'Replace photo') : t('admin.uploadPhoto', 'Upload product photo')), node('span', 'mdt-hint', t('admin.fileTypes', 'PNG or JPEG · The current photo stays until the replacement is ready.')));
    dropzone.addEventListener('click', () => photoInput.click());
    dropzone.addEventListener('dragover', event => { if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dropzone.dataset.over = 'true'; } });
    dropzone.addEventListener('dragleave', () => { dropzone.dataset.over = 'false'; });
    dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.dataset.over = 'false'; const file = event.dataTransfer?.files[0]; if (file) void replacePhoto(file); });
    if (view) {
      const asset = template.assets[view.assetId];
      const card = node('div', 'mdt-photo-card');
      const image = node('img'); image.alt = '';
      if (asset) image.src = asset.src;
      const text = node('div', 'mdt-photo-text');
      text.append(node('strong', '', asset?.name ?? t('admin.noPhoto', 'No photo')), node('span', 'mdt-hint', asset ? t('admin.pixelSize', '{width} × {height} px', { width: asset.width, height: asset.height }) : t('admin.photoMissing', 'Upload a photo for this view')));
      card.append(image, text);
      const actions = node('div', 'mdt-btn-row');
      const add = button(t('admin.addView', 'Add view'), addView, 'mdt-btn-sm', 'plus');
      add.dataset.mdtKey = 'step-add-view'; add.disabled = uploading || template.views.length >= 24;
      const remove = button(t('admin.removeView', 'Remove view'), () => removeView(), 'mdt-btn-sm mdt-btn-danger', 'trash');
      remove.dataset.mdtKey = 'step-remove-view'; remove.disabled = uploading || template.views.length <= 1;
      actions.append(add, remove);
      nodes.push(section(t('admin.viewSection', 'Selected view'), field(t('admin.viewName', 'View name'), textInput(view.label, t('admin.viewName', 'View name'), value => { if (!value) { ui.setStatus(t('admin.nameRequired', 'Please enter a name.'), true); scheduleControls(); return; } view.label = value; changed(); }, 'view-name')), card, dropzone, actions));
      nodes.push(section(undefined, callout(t('admin.viewHint', 'A new view starts with the current photo. Replace it with the matching angle, then connect its print areas in Placement.'))));
    } else nodes.push(section(t('admin.photo', 'Photo'), dropzone));
    nodes.push(...renderModelSection());
    return nodes;
  }
  function modelName(): string {
    const model = template.model3d;
    if (!model) return '';
    return model.kind === 'gltf' ? model.name ?? 'GLB' : presetNames[model.preset ?? 'tshirt'];
  }
  /** Product step: choose a generated shape or a prepared GLB, and its color and size. */
  function renderModelSection(): Node[] {
    const model = template.model3d;
    const kind = !model ? 'none' : model.kind === 'gltf' ? 'gltf' : model.preset!;
    const select = node('select', 'mdt-input');
    select.dataset.mdtKey = 'model-kind'; select.disabled = uploading;
    select.setAttribute('aria-label', t('admin.modelShape', '3D shape'));
    const choices: Array<[string, string]> = [
      ['none', t('admin.model.none', 'No 3D preview')],
      ...(['tshirt', 'hoodie', 'sweater', 'cap', 'mug', 'cushion', 'box', 'card'] as const).map(preset => [preset, presetNames[preset]] as [string, string]),
      ['gltf', t('admin.model.gltf', 'Custom GLB file…')],
    ];
    for (const [value, label] of choices) { const option = node('option', '', label); option.value = value; select.append(option); }
    select.value = kind;
    select.addEventListener('change', () => {
      const value = select.value;
      if (value === 'gltf') { select.value = kind; modelInput.click(); return; }
      if (value === 'none') removeModel(); else setPreset(value as ModelPreset);
    });
    const children: Node[] = [field(t('admin.modelShape', '3D shape'), select)];
    if (model?.kind === 'preset' && model.preset) {
      const preset = model.preset;
      const color = node('input', 'mdt-color');
      color.type = 'color'; color.value = model.color; color.dataset.mdtKey = 'model-color'; color.disabled = uploading;
      color.setAttribute('aria-label', t('admin.modelColor', 'Product color'));
      color.addEventListener('input', () => { model.color = color.value; view3d.refresh(); });
      color.addEventListener('change', () => { model.color = color.value; changed(); });
      children.push(field(t('admin.modelColor', 'Product color'), color));
      const size = { ...DEFAULT_PRESET_SIZE[preset], ...(model.size ?? {}) };
      const dimension = (key: 'width' | 'height' | 'depth', label: string) => numberRow(label, size[key], { min: key === 'depth' && preset === 'card' ? .2 : 5, max: 2000, step: 1, digits: 1, key: `model-${key}` }, value => { model.size = { ...size, [key]: value }; });
      if (preset === 'mug') children.push(nodeGrid(dimension('width', t('admin.modelDiameter', 'Diameter · mm')), dimension('height', t('admin.modelHeight', 'Height · mm'))));
      if (preset === 'box') children.push(nodeGrid(dimension('width', t('admin.modelWidth', 'Width · mm')), dimension('height', t('admin.modelHeight', 'Height · mm')), dimension('depth', t('admin.modelDepth', 'Depth · mm'))));
      if (preset === 'card') children.push(nodeGrid(dimension('width', t('admin.modelWidth', 'Width · mm')), dimension('height', t('admin.modelHeight', 'Height · mm'))));
      if (preset === 'tshirt' || preset === 'hoodie' || preset === 'sweater') children.push(nodeGrid(dimension('width', t('admin.modelChest', 'Chest width · mm')), dimension('height', t('admin.modelLength', 'Body length · mm'))));
      if (preset === 'cushion') children.push(nodeGrid(dimension('width', t('admin.modelWidth', 'Width · mm')), dimension('height', t('admin.modelHeight', 'Height · mm')), dimension('depth', t('admin.modelThickness', 'Thickness · mm'))));
      if (PRESET_SOFTNESS[preset] > 0) {
        // Preview only: how far the fabric gives when it is pulled in 3D.
        const range = node('input', 'mdt-range');
        range.type = 'range'; range.min = '5'; range.max = '100'; range.step = '5';
        range.dataset.mdtKey = 'model-softness'; range.disabled = uploading;
        range.setAttribute('aria-label', t('admin.modelSoftness', 'Fabric looseness'));
        const output = node('output', 'mdt-range-value');
        const show = () => {
          const value = Number(range.value);
          range.style.setProperty('--mdt-ui-fill', `${(value - 5) / 95 * 100}%`);
          output.textContent = t('unit.percentValue', '{value}%', { value });
          range.setAttribute('aria-valuetext', output.textContent);
        };
        range.value = String(Math.round((model.softness ?? PRESET_SOFTNESS[preset]) * 100));
        show();
        range.addEventListener('input', () => { show(); model.softness = Number(range.value) / 100; view3d.refresh(); });
        range.addEventListener('change', () => { model.softness = Number(range.value) / 100; changed(); });
        const row = node('div', 'mdt-range-row'); row.append(range, output);
        children.push(field(t('admin.modelSoftness', 'Fabric looseness'), row, t('admin.modelSoftnessHint', 'How far the fabric gives when it is pulled in the 3D view. Preview only; the print does not change.')));
      }
    }
    if (model?.kind === 'gltf') {
      const card = node('div', 'mdt-photo-card');
      const badge = node('span', 'mdt-tree-thumb'); badge.append(icon('cube', 22));
      const text = node('div', 'mdt-photo-text');
      text.append(node('strong', '', model.name ?? 'GLB'), node('span', 'mdt-hint', t('admin.modelParts', 'Print areas map to the model’s material names.')));
      const replace = button(t('admin.modelReplace', 'Replace GLB'), () => modelInput.click(), 'mdt-btn-sm', 'replace');
      replace.dataset.mdtKey = 'model-replace'; replace.disabled = uploading;
      card.append(badge, text);
      children.push(card, replace);
    }
    if (model) {
      const open = button(t('admin.modelOpen', 'Open 3D view'), () => selectView(VIEW_3D), 'mdt-btn-sm mdt-btn-soft', 'cube');
      open.dataset.mdtKey = 'model-open'; open.disabled = uploading || viewId === VIEW_3D;
      const photos = button(t('admin.modelPhotos', 'Create photos from 3D'), () => void photosFromModel(), 'mdt-btn-sm', 'camera');
      photos.dataset.mdtKey = 'model-photos'; photos.disabled = uploading || !model.bindings.length;
      const row = node('div', 'mdt-btn-row'); row.append(open, photos);
      children.push(row, node('p', 'mdt-hint', t('admin.modelPhotosHint', 'Adds a studio photo view for each placed part, with its print areas already positioned.')));
    }
    return [section(t('admin.model3d', '3D model'), ...children), section(undefined, callout(t('admin.modelHint', 'Generated shapes illustrate the design and are not measured products. For an exact product, upload a prepared GLB whose print regions use UV-mapped materials.')))];
  }
  function nodeGrid(...items: HTMLElement[]): HTMLElement {
    const grid = node('div', items.length === 3 ? 'mdt-grid-3' : 'mdt-grid-2');
    grid.append(...items);
    return grid;
  }
  /** Placement step while the 3D view is selected: which part shows each print area, and where. */
  function renderModelPlacement(surface: PrintSurface): Node[] {
    const model = template.model3d!;
    const binding = model.bindings.find(item => item.surfaceId === surface.id);
    const preset = model.kind === 'preset' ? model.preset : undefined;
    const parts = preset ? [...PRESET_PARTS[preset]] : modelParts;
    const select = node('select', 'mdt-input');
    select.dataset.mdtKey = 'model-part'; select.disabled = uploading;
    select.setAttribute('aria-label', t('admin.modelPart', 'Part of the model'));
    const none = node('option', '', t('admin.partNone', 'Not shown in 3D')); none.value = ''; select.append(none);
    for (const part of new Set([...parts, ...(binding ? [binding.part] : [])])) {
      const option = node('option', '', preset ? partNames[part] ?? part : part); option.value = part; select.append(option);
    }
    if (!preset && !parts.length) { const waiting = node('option', '', t('admin.partsLoading', 'Loading model parts…')); waiting.disabled = true; select.append(waiting); }
    select.value = binding?.part ?? '';
    select.addEventListener('change', () => {
      const part = select.value;
      if (!part) model.bindings = model.bindings.filter(item => item.surfaceId !== surface.id);
      else if (binding) binding.part = part;
      else model.bindings.push(preset ? defaultModelBinding(preset, surface.id, part) : { surfaceId: surface.id, part, x: .5, y: .5, width: .5, height: .5 });
      changed();
      window.setTimeout(() => view3d.focus(surface.id), 60);
    });
    const content: Node[] = [field(t('admin.modelPart', 'Part of the model'), select)];
    if (binding) {
      const grid = node('div', 'mdt-grid-2');
      const position = (key: 'x' | 'y' | 'width' | 'height', prefix: string, label: string) => {
        const input = numberField({
          label, prefix, unit: t('unit.percent', '%'), min: key === 'x' || key === 'y' ? 0 : 1, max: 100, step: .5, digits: 1, key: `model-${key}`,
          onInput: value => { binding[key] = value / 100; view3d.refresh(); },
          onCommit: value => { binding[key] = value / 100; changed(); },
        });
        input.set(round((binding[key] ?? .5) * 100, 1)); input.disable(uploading);
        return input.element;
      };
      grid.append(position('x', t('field.x', 'X'), t('admin.modelCenterX', 'Center from left · %')), position('y', t('field.y', 'Y'), t('admin.modelCenterY', 'Center from top · %')));
      if (!preset) grid.append(position('width', t('field.w', 'W'), t('admin.widthPercent', 'Width · %')), position('height', t('field.h', 'H'), t('admin.heightPercent', 'Height · %')));
      const center = button(t('admin.modelCenter', 'Center on part'), () => {
        const fresh = preset ? defaultModelBinding(preset, surface.id, binding.part) : { x: .5, y: .5 };
        binding.x = fresh.x; binding.y = fresh.y; changed();
      }, 'mdt-btn-sm', 'center');
      center.dataset.mdtKey = 'model-center';
      content.push(grid, center);
    }
    return [
      section(t('admin.positionOnModel', 'Position on the 3D model'), ...content),
      section(undefined, callout(preset
        ? t('admin.modelPlacementHint', 'The printed size follows this print area’s millimeters, so artwork keeps its real proportions on the model.')
        : t('admin.gltfPlacementHint', 'Position and size use the material’s UV space (0–100%). Prepare the model so the print region is not stretched.'))),
    ];
  }
  function renderAreaStep(): Node[] {
    const surface = selectedSurface();
    if (!surface) {
      const empty = node('div', 'mdt-empty-state');
      const add = button(t('admin.addArea', 'Add print area'), addSurface, 'mdt-btn-primary', 'plus');
      add.dataset.mdtKey = 'empty-add-area';
      empty.append(icon('crop', 26), node('p', '', t('admin.noAreas', 'No print areas yet. Add one to define where printing happens.')), add);
      return [section(undefined, empty)];
    }
    const size = exportSize(surface);
    const dimensions = node('div', 'mdt-grid-2');
    dimensions.append(
      numberRow(t('admin.widthMm', 'Width · mm'), surface.widthMm, { prefix: t('field.w', 'W'), min: 1, max: 2000, step: .5, digits: 1, key: 'area-w' }, value => { surface.widthMm = value; }),
      numberRow(t('admin.heightMm', 'Height · mm'), surface.heightMm, { prefix: t('field.h', 'H'), min: 1, max: 2000, step: .5, digits: 1, key: 'area-h' }, value => { surface.heightMm = value; }),
    );
    const resolution = node('div', 'mdt-grid-2');
    resolution.append(
      numberRow(t('admin.outputDpi', 'Output DPI'), surface.dpi, { min: 36, max: 1200, step: 1, digits: 0, key: 'area-dpi' }, value => { surface.dpi = Math.round(value); }),
      numberRow(t('admin.minimumDpi', 'Minimum DPI'), surface.minDpi, { min: 1, max: 1200, step: 1, digits: 0, key: 'area-min-dpi' }, value => { surface.minDpi = Math.round(value); }),
    );
    const output = node('div', 'mdt-output');
    const outputValue = node('strong', '', t('admin.outputPixels', '{width} × {height} px', { width: size.width, height: size.height }));
    output.append(node('span', '', t('admin.printFile', 'Print file')), outputValue);
    const margins = node('div', 'mdt-grid-2');
    margins.append(
      numberRow(t('admin.safeMm', 'Safe inset · mm'), surface.safeMm, { min: 0, max: 100, step: .5, digits: 1, key: 'area-safe' }, value => { surface.safeMm = value; }),
      numberRow(t('admin.bleedMm', 'Bleed · mm'), surface.bleedMm, { min: 0, max: 50, step: .5, digits: 1, key: 'area-bleed' }, value => { surface.bleedMm = value; }),
    );
    const shape = shapeOf(surface);
    const shapes: Array<{ value: ReturnType<typeof shapeOf>; label: string; icon: IconName }> = [
      { value: 'rectangle', label: t('admin.rectangle', 'Rectangle'), icon: 'rectangle' },
      { value: 'ellipse', label: t('admin.ellipse', 'Ellipse'), icon: 'ellipse' },
      { value: 'diamond', label: t('admin.diamond', 'Diamond'), icon: 'diamond' },
    ];
    if (shape === 'custom') shapes.push({ value: 'custom', label: t('admin.customPolygon', 'Custom polygon · imported'), icon: 'polygon' });
    const shapeControl = segmented(t('admin.printShape', 'Printable shape'), shapes, shape, value => {
      if (value === shape || value === 'custom') return;
      if (value === 'rectangle') delete surface.clip;
      else if (value === 'diamond') surface.clip = [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }];
      else surface.clip = Array.from({ length: 40 }, (_, index) => ({ x: .5 + Math.cos(index / 40 * Math.PI * 2) * .5, y: .5 + Math.sin(index / 40 * Math.PI * 2) * .5 }));
      changed();
    });
    shapeControl.querySelectorAll('button').forEach(item => { item.dataset.mdtKey = `shape-${(item as HTMLButtonElement).dataset.value}`; item.disabled = uploading; });
    const shapeNodes: Node[] = [shapeControl];
    if (surface.clip) shapeNodes.push(callout(t('admin.clipBleed', 'Contour shapes require zero bleed in this first version. The print file clips artwork to this shape.'), surface.bleedMm > 0 ? 'warn' : 'info'));
    const actions = node('div', 'mdt-btn-row');
    const add = button(t('admin.addArea', 'Add print area'), addSurface, 'mdt-btn-sm', 'plus');
    add.dataset.mdtKey = 'step-add-area'; add.disabled = uploading || template.surfaces.length >= 16;
    const remove = button(t('admin.removeArea', 'Remove area'), () => removeSurface(), 'mdt-btn-sm mdt-btn-danger', 'trash');
    remove.dataset.mdtKey = 'step-remove-area'; remove.disabled = uploading || template.surfaces.length <= 1;
    actions.append(add, remove);
    return [
      section(undefined, field(t('admin.areaName', 'Print area name'), textInput(surface.label, t('admin.areaName', 'Print area name'), value => { if (!value) { ui.setStatus(t('admin.nameRequired', 'Please enter a name.'), true); scheduleControls(); return; } surface.label = value; changed(); }, 'area-name'))),
      section(t('admin.physicalSizeMm', 'Physical size · mm'), dimensions),
      section(t('admin.printResolution', 'Print resolution'), resolution, output),
      section(t('admin.margins', 'Safe area and bleed'), margins),
      section(t('admin.printShape', 'Printable shape'), ...shapeNodes),
      section(undefined, actions),
    ];
  }
  function renderPlacementStep(): Node[] {
    const surface = selectedSurface();
    if (viewId === VIEW_3D && template.model3d) return surface ? renderModelPlacement(surface) : [section(undefined, callout(t('admin.needViewArea', 'Add a product view and a print area first.')))];
    const view = selectedView();
    if (!surface || !view) return [section(undefined, callout(t('admin.needViewArea', 'Add a product view and a print area first.')))];
    const binding = selectedBinding();
    if (!binding) {
      const empty = node('div', 'mdt-empty-state');
      const place = button(t('admin.connect', 'Connect print area'), connect, 'mdt-btn-primary', 'link');
      place.dataset.mdtKey = 'connect';
      empty.append(icon('unlink', 26), node('p', '', t('admin.notConnected', 'This print area is not connected to the selected view.')), place);
      return [section(undefined, empty)];
    }
    const grid = node('div', 'mdt-grid-2');
    const mapping = (key: 'x' | 'y' | 'width' | 'height', prefix: string, label: string, min: number) => {
      const input = numberField({
        label, prefix, unit: t('unit.percent', '%'), min, max: 100, step: .1, digits: 2, key: `map-${key}`,
        onInput: value => { binding[key] = value / 100; normalizeBinding(binding); requestRender(); drawOverlay(); },
        onCommit: value => { binding[key] = value / 100; normalizeBinding(binding); changed(); },
      });
      input.disable(uploading);
      const sync = () => input.set(round(binding[key] * 100));
      sync(); liveFields.push(sync);
      return input.element;
    };
    grid.append(
      mapping('x', t('field.x', 'X'), t('admin.leftPercent', 'Left · %'), 0), mapping('y', t('field.y', 'Y'), t('admin.topPercent', 'Top · %'), 0),
      mapping('width', t('field.w', 'W'), t('admin.widthPercent', 'Width · %'), 1), mapping('height', t('field.h', 'H'), t('admin.heightPercent', 'Height · %'), 1),
    );
    const rotation = numberField({
      label: t('admin.rotation', 'Photo placement rotation · °'), prefixIcon: 'rotateCw', unit: t('unit.degree', '°'), min: -180, max: 180, step: 1, digits: 1, key: 'map-rotation',
      onInput: value => { binding.rotation = value; requestRender(); drawOverlay(); },
      onCommit: value => { binding.rotation = value; changed(); },
    });
    rotation.disable(uploading);
    const syncRotation = () => rotation.set(binding.rotation);
    syncRotation(); liveFields.push(syncRotation);
    const actions = node('div', 'mdt-btn-row');
    const center = button(t('admin.centerArea', 'Center on photo'), centerBinding, 'mdt-btn-sm', 'center');
    const match = button(t('admin.matchProportions', 'Match print proportions'), matchProportions, 'mdt-btn-sm', 'resize');
    center.dataset.mdtKey = 'center'; match.dataset.mdtKey = 'match';
    actions.append(center, match);
    const disconnectButton = button(t('admin.disconnect', 'Disconnect from view'), disconnect, 'mdt-btn-sm mdt-btn-ghost mdt-btn-danger', 'unlink');
    disconnectButton.dataset.mdtKey = 'disconnect';
    const nodes: Node[] = [section(t('admin.positionOnPhoto', 'Position on photo'), grid, rotation.element, actions)];
    const mismatch = aspectMismatch(binding);
    if (Math.abs(mismatch) > .02) nodes.push(section(undefined, callout(t('admin.stretched', 'The outline is {percent}% {direction} than the {width} × {height} mm print area, so the preview looks stretched.', { percent: Math.round(Math.abs(mismatch) * 100), direction: mismatch > 0 ? t('admin.taller', 'taller') : t('admin.wider', 'wider'), width: surface.widthMm, height: surface.heightMm }), 'warn')));
    nodes.push(section(undefined, node('p', 'mdt-hint', t('admin.placementHint', 'Drag the outline on the photo. Corner handles keep proportions; hold Shift to stretch, Alt to scale from the center.')), callout(t('admin.flatOnly', 'Flat photo placement. Perspective and curved photo wrapping come later; add a 3D model for a rotatable preview.')), disconnectButton));
    return nodes;
  }
  function renderRulesStep(): Node[] {
    const surface = selectedSurface();
    if (!surface) return [section(undefined, callout(t('admin.needViewArea', 'Add a product view and a print area first.')))];
    const rule = (label: string, description: string, checked: boolean, key: string, update: (value: boolean) => void) => {
      const control = toggle(label, checked, value => { update(value); changed(); }, description, key);
      control.input.disabled = uploading;
      return control.element;
    };
    const limits = numberRow(t('admin.maxLayers', 'Maximum artwork layers'), surface.rules.maxLayers, { min: 1, max: 20, step: 1, digits: 0, key: 'max-layers' }, value => { surface.rules.maxLayers = Math.round(value); });
    return [
      section(t('admin.requirements', 'Requirements'),
        rule(t('admin.requireArtwork', 'Require artwork before confirmation'), t('admin.requireArtworkHint', 'Customers cannot confirm until this area has artwork.'), surface.required, 'rule-required', value => { surface.required = value; })),
      section(t('admin.customerTools', 'Customer tools'),
        rule(t('admin.allowMove', 'Allow moving artwork'), t('admin.allowMoveHint', 'Off: artwork stays centered.'), surface.rules.move, 'rule-move', value => { surface.rules.move = value; }),
        rule(t('admin.allowResize', 'Allow resizing artwork'), t('admin.allowResizeHint', 'Off: artwork keeps the fitted size.'), surface.rules.resize, 'rule-resize', value => { surface.rules.resize = value; }),
        rule(t('admin.allowRotate', 'Allow rotating artwork'), t('admin.allowRotateHint', 'Off: artwork stays upright.'), surface.rules.rotate, 'rule-rotate', value => { surface.rules.rotate = value; }),
        limits),
      section(undefined, callout(t('admin.rulesHint', 'For a fixed logo slot, allow image upload and resizing, then lock movement and rotation. Text and conditional questionnaires are deferred.'))),
    ];
  }
  function renderReviewStep(): Node[] {
    const issues = validateTemplate(template);
    const meta = node('dl', 'mdt-meta');
    const rows: Array<[string, string]> = [
      [t('admin.product', 'Product'), template.title],
      [t('admin.views', 'Views'), f(template.views.length)],
      [t('admin.areas', 'Print areas'), f(template.surfaces.length)],
      [t('admin.state', 'State'), template.status === 'published' ? t('admin.published', 'Published') : t('admin.draft', 'Draft')],
    ];
    for (const [label, value] of rows) { const row = node('div'); row.append(node('dt', '', label), node('dd', '', value)); meta.append(row); }
    const outputs = template.surfaces.map(surface => {
      const row = node('div', 'mdt-output');
      const size = exportSize(surface);
      row.append(node('span', '', surface.label), node('strong', '', `${t('admin.outputPixels', '{width} × {height} px', { width: size.width, height: size.height })} · ${f(surface.dpi)} ${t('unit.dpi', 'DPI')}`));
      return row;
    });
    const nodes: Node[] = [section(t('admin.summary', 'Summary'), meta), section(t('admin.printFiles', 'Print files'), ...outputs)];
    if (issues.length) {
      const list = node('div', 'mdt-issue-list');
      list.setAttribute('aria-label', t('admin.setupIssues', 'Template setup issues'));
      issues.forEach((issue, index) => {
        const row = node('div', 'mdt-issue');
        const fix = button(t('admin.fix', 'Fix'), () => { if (issue.surfaceId) surfaceId = issue.surfaceId; goTo(stepOf(issue) === 4 ? step : stepOf(issue)); }, 'mdt-btn-sm');
        fix.dataset.mdtKey = `fix-${index}`;
        row.append(icon('warning', 16), node('span', '', issueText(issue)), fix);
        list.append(row);
      });
      nodes.push(section(t('admin.fixBeforePublish', 'Resolve these setup issues before publishing:'), list));
    } else nodes.push(section(undefined, callout(t('admin.ready', 'Template checks passed. Test the customer flow or publish this revision.'), 'ok')));
    const test = button(template.status === 'published' ? t('admin.testCustomer', 'Test as customer') : t('admin.publishTest', 'Publish & test as customer'), testAsCustomer, 'mdt-btn-block', 'play');
    test.dataset.mdtKey = 'review-test';
    test.disabled = issues.length > 0 || uploading || !!previewError;
    const save = button(t('admin.download', 'Download template JSON'), downloadTemplate, 'mdt-btn-block mdt-btn-ghost', 'download');
    save.dataset.mdtKey = 'review-download';
    const final: Node[] = [test, save];
    if (template.status === 'published') final.push(node('p', 'mdt-hint', t('admin.newDraftHint', 'Editing any setting starts a new draft. Existing published templates and designs keep their original revision.')));
    nodes.push(section(undefined, ...final));
    return nodes;
  }
  function renderControls(): void {
    if (destroyed) return;
    clearTimeout(rebuildTimer);
    const issues = validateTemplate(template);
    if (ui.root.activeElement !== titleInput) titleInput.value = template.title;
    titleInput.disabled = uploading;
    stateChip.textContent = template.status === 'published' ? t('admin.published', 'Published') : t('admin.draft', 'Draft');
    stateChip.dataset.tone = template.status === 'published' ? 'ok' : 'neutral';
    ui.setBusy(uploading);
    renderChrome();
    renderStepper(issues);
    renderStructure();
    liveFields = [];
    const current = steps[step];
    const intro = node('div', 'mdt-step-intro');
    const on3d = step === 2 && viewId === VIEW_3D && !!template.model3d;
    intro.append(
      node('p', 'mdt-step-kicker', t('admin.stepOf', 'Step {current} of {total}', { current: step + 1, total: steps.length })),
      node('h2', '', on3d ? t('admin.placementHeading3d', 'Place it on the 3D model') : current.title),
      node('p', 'mdt-lead', on3d ? t('admin.placementDescription3d', 'Choose the part of the model that shows each print area, then set its position. Drag the model to check every side.') : current.description),
    );
    const content = [renderProductStep, renderAreaStep, renderPlacementStep, renderRulesStep, renderReviewStep][step]();
    ui.preserveFocus(() => inspectorBody.replaceChildren(intro, ...content));
    if (uploading) for (const control of Array.from(inspectorBody.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button,select'))) control.disabled = true;
    backButton.disabled = step === 0 || uploading;
    setLabel(nextButton, step < steps.length - 1 ? t('admin.next', 'Next: {step}', { step: steps[step + 1].label }) : template.status === 'published' ? t('admin.testCustomer', 'Test as customer') : t('admin.publishTest', 'Publish & test as customer'));
    nextButton.replaceChildren(...Array.from(nextButton.querySelectorAll('.mdt-btn-label')), icon(step < steps.length - 1 ? 'chevronRight' : 'play', 16, 'mdt-icon mdt-icon-dir'));
    nextButton.disabled = uploading || (step === steps.length - 1 && (issues.length > 0 || !!previewError));
    const blocked = uploading || issues.length > 0 || !!previewError;
    publishButton.disabled = blocked || template.status === 'published';
    setLabel(publishButton, template.status === 'published' ? t('admin.published', 'Published') : t('admin.publish', 'Publish template'), template.status === 'published' ? 'check' : 'send');
    testButton.disabled = blocked;
    downloadButton.disabled = uploading;
    undoButton.disabled = uploading || !undo.length;
    redoButton.disabled = uploading || !redo.length;
    sampleButton.setAttribute('aria-pressed', String(showSample));
    const view = selectedView();
    stageEmpty.hidden = viewId === VIEW_3D || !!(view && template.assets[view.assetId]);
    summaryText.textContent = t('admin.summaryLine', '{views} · {areas}', {
      views: ui.plural('admin.viewCount', template.views.length, { one: '{count} view', other: '{count} views' }),
      areas: ui.plural('admin.areaCount', template.surfaces.length, { one: '{count} print area', other: '{count} print areas' }),
    });
    drawOverlay();
  }

  // ── Canvas overlay and interaction ────────────────────────────────────
  function photoInfo(): { rect: Rect; width: number; height: number } | null {
    const view = selectedView();
    const asset = view && template.assets[view.assetId];
    const rect = view && viewRect(template, view.id);
    return asset && rect ? { rect, width: asset.width, height: asset.height } : null;
  }
  type Info = NonNullable<ReturnType<typeof photoInfo>>;
  const toPhoto = (info: Info, at: Point): Point => ({ x: (at.x - info.rect.x) / info.rect.width * info.width, y: (at.y - info.rect.y) / info.rect.height * info.height });
  const photoToScreen = (info: Info, p: Point): Point => stageCtl.viewport.toScreen(info.rect.x + p.x / info.width * info.rect.width, info.rect.y + p.y / info.height * info.rect.height);
  const bindingBox = (binding: SurfaceBinding, info: Info): Box => ({ cx: (binding.x + binding.width / 2) * info.width, cy: (binding.y + binding.height / 2) * info.height, w: binding.width * info.width, h: binding.height * info.height, rotation: binding.rotation });
  function applyBox(binding: SurfaceBinding, box: Box, info: Info): void {
    binding.width = box.w / info.width; binding.height = box.h / info.height;
    binding.x = box.cx / info.width - binding.width / 2; binding.y = box.cy / info.height - binding.height / 2;
    binding.rotation = box.rotation;
    normalizeBinding(binding);
  }
  function drawOverlay(): void {
    if (destroyed) return;
    const overlay = ui.overlay, labels = ui.labels;
    overlay.replaceChildren(); labels.replaceChildren();
    const view = selectedView(), surface = selectedSurface(), info = photoInfo();
    const binding = selectedBinding();
    banner.hidden = !(view && surface && info && !binding);
    if (!banner.hidden) bannerText.textContent = t('admin.notPlaced', '{area} isn’t placed on this photo.', { area: surface!.label });
    bannerButton.disabled = uploading;
    if (!view || !info) { selbar.hidden = true; return; }
    for (const item of view.bindings) {
      const area = template.surfaces.find(s => s.id === item.surfaceId);
      if (!area) continue;
      const box = bindingBox(item, info);
      const active = area.id === surfaceId;
      const corners = boxCorners(box).map(p => photoToScreen(info, p));
      const inset = (mm: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => photoToScreen(info, boxPoint(box, sx * (1 - 2 * mm / area.widthMm), sy * (1 - 2 * mm / area.heightMm))));
      if (active && area.bleedMm > 0) overlay.append(svg('polygon', { points: pointsAttr(inset(-area.bleedMm)) }, 'mdt-ov-bleed'));
      if (area.clip) {
        overlay.append(svg('polygon', { points: pointsAttr(corners) }, 'mdt-ov-area'));
        overlay.append(svg('polygon', { points: pointsAttr(area.clip.map(p => photoToScreen(info, boxPoint(box, p.x * 2 - 1, p.y * 2 - 1)))), 'data-active': String(active) }, 'mdt-ov-area'));
      } else overlay.append(svg('polygon', { points: pointsAttr(corners), 'data-active': String(active) }, 'mdt-ov-area'));
      if (active && area.safeMm > 0 && !area.clip && area.safeMm * 2 < Math.min(area.widthMm, area.heightMm)) overlay.append(svg('polygon', { points: pointsAttr(inset(area.safeMm)) }, 'mdt-ov-safe'));
      if (!active && hoverSurface === area.id && !gesture) overlay.append(svg('polygon', { points: pointsAttr(corners) }, 'mdt-ov-hover'));
      const corner = corners.reduce((best, p) => p.y < best.y - .5 || (Math.abs(p.y - best.y) <= .5 && p.x < best.x) ? p : best, corners[0]);
      const tag = node('div', 'mdt-area-tag');
      tag.dataset.active = String(active);
      tag.append(area.label, node('span', '', t('admin.dimensions', '{width} × {height} mm', { width: area.widthMm, height: area.heightMm })));
      tag.style.left = `${corner.x}px`; tag.style.top = `${corner.y}px`;
      labels.append(tag);
    }
    if (!binding) { selbar.hidden = true; return; }
    const box = bindingBox(binding, info);
    const corners = boxCorners(box).map(p => photoToScreen(info, p));
    const points = pointsAttr(corners);
    overlay.append(svg('polygon', { points }, 'mdt-ov-halo'), svg('polygon', { points }, 'mdt-ov-line'));
    for (const guide of gesture === 'move' ? guides : []) {
      const [a, b] = guide === 'v' ? [photoToScreen(info, { x: info.width / 2, y: 0 }), photoToScreen(info, { x: info.width / 2, y: info.height })] : [photoToScreen(info, { x: 0, y: info.height / 2 }), photoToScreen(info, { x: info.width, y: info.height / 2 })];
      overlay.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 'mdt-ov-guide'));
    }
    const angle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI;
    const grip = ui.coarse ? 36 : 18;
    if (gesture !== 'move' && !uploading) {
      // Rotation sits below the outline so the label and toolbar above stay clear.
      const bottom = photoToScreen(info, boxPoint(box, 0, 1));
      const center = photoToScreen(info, { x: box.cx, y: box.cy });
      const length = Math.hypot(bottom.x - center.x, bottom.y - center.y) || 1;
      const rotate = { x: bottom.x + (bottom.x - center.x) / length * 24, y: bottom.y + (bottom.y - center.y) / length * 24 };
      overlay.append(svg('line', { x1: bottom.x, y1: bottom.y, x2: rotate.x, y2: rotate.y }, 'mdt-ov-stem'), svg('circle', { cx: rotate.x, cy: rotate.y, r: 6 }, 'mdt-ov-handle mdt-ov-rotate'));
      const rotateHit = svg('circle', { cx: rotate.x, cy: rotate.y, r: grip / 2, 'data-mdt-handle': 'rotate' }, 'mdt-ov-grip');
      rotateHit.style.cursor = handleCursor('rotate', angle);
      overlay.append(rotateHit);
      const handles: Array<[Exclude<Handle, 'rotate'>, number, number]> = [['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0]];
      for (const [name, sx, sy] of handles) {
        const p = photoToScreen(info, boxPoint(box, sx, sy));
        const side = !sx || !sy;
        overlay.append(svg('rect', side ? { x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7, rx: 3.5 } : { x: p.x - 4.5, y: p.y - 4.5, width: 9, height: 9, rx: 2 }, 'mdt-ov-handle'));
        const hit = svg('rect', { x: p.x - grip / 2, y: p.y - grip / 2, width: grip, height: grip, 'data-mdt-handle': name }, 'mdt-ov-grip');
        hit.style.cursor = handleCursor(name, angle);
        overlay.append(hit);
      }
    }
    if (readout) {
      readoutTag.textContent = readout.text;
      readoutTag.style.left = `${readout.at.x}px`; readoutTag.style.top = `${readout.at.y}px`;
      labels.append(readoutTag);
    }
    selbar.hidden = !!gesture || uploading;
    sb.match.disabled = Math.abs(aspectMismatch(binding)) <= .002;
    sb.straighten.disabled = binding.rotation === 0;
    if (selbar.hidden) return;
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const width = selbar.offsetWidth || 180, vp = stageCtl.viewport;
    const x = Math.max(width / 2 + 8, Math.min(vp.width - width / 2 - 8, (Math.min(...xs) + Math.max(...xs)) / 2));
    let y = Math.min(...ys) - 40;
    const below = y - 46 < 4;
    if (below) y = Math.max(...ys) + 42;
    selbar.dataset.below = String(below);
    selbar.style.left = `${x}px`; selbar.style.top = `${Math.min(y, vp.height - 50)}px`;
  }
  function begin(at: Point, event: PointerEvent): GestureHandlers | null {
    if (uploading) return null;
    if (ui.layout === 'medium' && structureOpen) { structureOpen = false; renderChrome(); }
    const view = selectedView(), info = photoInfo();
    if (!view || !info) return null;
    const handle = (event.target as Element).closest?.('[data-mdt-handle]')?.getAttribute('data-mdt-handle') as Handle | null;
    const current = selectedBinding();
    const point = toPhoto(info, at);
    if (handle && current) return transformBinding(handle, current, info, point);
    const hit = [current, ...view.bindings.filter(item => item !== current).reverse()].find(item => item && insideBox(bindingBox(item, info), point));
    if (!hit) return null;
    if (hit.surfaceId !== surfaceId) { surfaceId = hit.surfaceId; renderControls(); }
    return moveBinding(hit, info, point);
  }
  function moveBinding(binding: SurfaceBinding, info: Info, start: Point): GestureHandlers {
    const startBox = bindingBox(binding, info);
    const pxPerUnit = info.rect.width / info.width * stageCtl.viewport.scale;
    gesture = 'move';
    return {
      move(at, event) {
        const point = toPhoto(info, at);
        let cx = startBox.cx + point.x - start.x, cy = startBox.cy + point.y - start.y;
        guides = [];
        if (!event.altKey) {
          const threshold = 6 / Math.max(pxPerUnit, .0001);
          if (Math.abs(cx - info.width / 2) < threshold) { cx = info.width / 2; guides.push('v'); }
          if (Math.abs(cy - info.height / 2) < threshold) { cy = info.height / 2; guides.push('h'); }
        }
        applyBox(binding, { ...startBox, cx, cy }, info);
        for (const sync of liveFields) sync();
        requestRender(); drawOverlay();
      },
      end(_event, cancelled) {
        gesture = null; guides = [];
        if (cancelled) applyBox(binding, startBox, info);
        const moved = Math.abs(bindingBox(binding, info).cx - startBox.cx) > .01 || Math.abs(bindingBox(binding, info).cy - startBox.cy) > .01;
        changed();
        if (moved) ui.setStatus(t('admin.placementUpdated', 'Preview placement updated. Print dimensions are unchanged.'));
      },
    };
  }
  function transformBinding(handle: Handle, binding: SurfaceBinding, info: Info, start: Point): GestureHandlers {
    const startBox = bindingBox(binding, info);
    gesture = handle === 'rotate' ? 'rotate' : 'resize';
    const screen = (at: Point) => stageCtl.viewport.toScreen(at.x, at.y);
    return {
      move(at, event) {
        const point = toPhoto(info, at);
        if (handle === 'rotate') {
          applyBox(binding, { ...startBox, rotation: rotateBox(startBox, start, point, event.shiftKey) }, info);
          readout = { text: t('unit.degreeValue', '{value}°', { value: round(binding.rotation, 1) }), at: screen(at) };
        } else {
          const corner = handle.length === 2;
          applyBox(binding, resizeBox(startBox, handle, point, { uniform: corner && !event.shiftKey, centered: event.altKey, min: Math.min(info.width, info.height) * .01 }), info);
          readout = { text: t('admin.readoutPercent', '{width}% × {height}%', { width: round(binding.width * 100, 1), height: round(binding.height * 100, 1) }), at: screen(at) };
        }
        for (const sync of liveFields) sync();
        requestRender(); drawOverlay();
      },
      end(_event, cancelled) {
        gesture = null; readout = null;
        if (cancelled) applyBox(binding, startBox, info);
        changed();
        ui.setStatus(t('admin.placementUpdated', 'Preview placement updated. Print dimensions are unchanged.'));
      },
    };
  }
  function hover(at: Point | null): void {
    if (uploading) return;
    const view = selectedView(), info = photoInfo();
    let next = '';
    if (at && view && info) {
      const point = toPhoto(info, at);
      next = [...view.bindings].reverse().find(item => insideBox(bindingBox(item, info), point))?.surfaceId ?? '';
    }
    stageCtl.setCursor(next ? 'move' : '');
    if (next !== hoverSurface) { hoverSurface = next; drawOverlay(); }
  }
  function openShortcuts(): void {
    ui.openDialog(t('admin.shortcuts', 'Keyboard shortcuts'), shortcutList([
      [t('shortcuts.general', 'General'), [[t('admin.undo', 'Undo'), [`${mod}Z`]], [t('admin.redo', 'Redo'), [ui.keys.redo]], [t('admin.shortcuts', 'Keyboard shortcuts'), ['?']]]],
      [t('shortcuts.placement', 'Selected print area'), [
        [t('shortcuts.nudgePlacement', 'Nudge outline'), ['←', '↑', '→', '↓']], [t('shortcuts.nudgeLarge', 'Move 5 mm'), [ui.keys.shift, '+', '←']],
        [t('shortcuts.stretch', 'Stretch from a corner'), [ui.keys.shift, '+', t('shortcuts.drag', 'drag')]],
        [t('shortcuts.fromCenter', 'Resize from the center'), [ui.keys.alt, '+', t('shortcuts.drag', 'drag')]],
        [t('shortcuts.rotateSnap', 'Rotate in 15° steps'), [ui.keys.shift, '+', t('shortcuts.drag', 'drag')]],
      ]],
      [t('shortcuts.view', 'View'), [
        [t('stage.zoomIn', 'Zoom in'), [`${mod}+`]], [t('stage.zoomOut', 'Zoom out'), [`${mod}−`]], [t('stage.fit', 'Fit to screen'), [`${mod}0`]], [t('stage.actual', 'Zoom to 100%'), [`${mod}1`]],
        [t('stage.panTemporary', 'Pan while held'), [ui.keys.space, '+', t('shortcuts.drag', 'drag')]], [t('stage.select', 'Select and move'), ['V']], [t('stage.hand', 'Pan the canvas'), ['H']],
      ]],
    ]));
  }

  ui.shell.addEventListener('keydown', event => {
    if (destroyed) return;
    const modKey = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modKey && !event.altKey && (key === 'z' || key === 'y')) {
      if (isTyping(event.target)) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) restoreHistory(redo, undo); else restoreHistory(undo, redo);
      return;
    }
    if (isTyping(event.target) || modKey || event.altKey) return;
    if (event.key === '?') { event.preventDefault(); openShortcuts(); return; }
    if (event.target !== ui.canvas || uploading || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const binding = selectedBinding(); if (!binding) return;
    const increment = event.shiftKey ? .01 : .002;
    if (event.key === 'ArrowLeft') binding.x -= increment;
    if (event.key === 'ArrowRight') binding.x += increment;
    if (event.key === 'ArrowUp') binding.y -= increment;
    if (event.key === 'ArrowDown') binding.y += increment;
    normalizeBinding(binding); changed(); event.preventDefault();
  }, { signal });
  ui.onLayout(() => { structureOpen = false; renderChrome(); drawOverlay(); });

  const controller: AdminController = {
    element: ui.element,
    getTemplate() { ensureAlive(); return clone(template); },
    async setTemplate(value) {
      ensureAlive();
      const next = clone(assertTemplate(value));
      const currentVersion = ++version;
      loadController.abort(); uploadController?.abort(); uploadController = undefined; uploading = true;
      loadController = new AbortController();
      renderControls();
      ui.setStatus(t('admin.loadingTemplate', 'Loading template…'));
      try {
        await renderer.preload(next, sampleDesign(next), loadController.signal);
        if (destroyed || currentVersion !== version) return;
        if (viewId === VIEW_3D) { view3d.hide(); stageCtl.suspended = false; }
        template = next; committed = copyTemplate(next); undo.length = 0; redo.length = 0; modelParts = [];
        surfaceId = next.surfaces[0]?.id ?? ''; viewId = next.views[0]?.id ?? ''; step = 0; previewError = '';
        stageCtl.setContent(viewRect(template, viewId), true);
        renderControls(); requestRender(); ui.setStatus(t('admin.loaded', 'Template loaded.'));
      } catch (error) { if (!destroyed && currentVersion === version) showError(error); throw error; }
      finally { if (!destroyed && currentVersion === version) { uploading = false; renderControls(); } }
    },
    publish,
    setTheme(theme) { ensureAlive(); ui.setTheme(theme); },
    destroy() {
      if (destroyed) return;
      destroyed = true; version += 1; loadController.abort(); uploadController?.abort(); uploadController = undefined;
      clearTimeout(rebuildTimer); abort.abort(); stageCtl.destroy(); view3d.destroy();
      photoInput.value = '';
      template.assets = {}; template.views = []; template.surfaces = []; sample.src = '';
      undo.length = 0; redo.length = 0; committed = template; liveFields = [];
      renderer.dispose(); ui.destroy();
    },
  };
  stageCtl.setContent(viewRect(template, viewId), true);
  renderControls();
  ui.setStatus(t('admin.loadingTemplate', 'Loading template…'));
  try {
    await renderer.preload(template, sampleDesign(template), loadController.signal);
    requestRender();
    ui.setStatus(t('admin.start', 'Add a product photo, define the print area, then test the customer experience.'));
  } catch (error) {
    previewError = error instanceof Error ? ui.errorText(error) : t('errors.preview', 'The product preview could not be loaded.');
    showError(error); renderControls();
  }
  return controller;
}
