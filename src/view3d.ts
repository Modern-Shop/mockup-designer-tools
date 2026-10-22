import { downloadBlob } from './assets.js';
import { icon } from './icons.js';
import type { Renderer } from './render.js';
import type { Viewer } from './model3d.js';
import type { DesignDocument, ProductTemplate } from './types.js';
import { button, iconButton, node, type UIShell } from './ui.js';

/** Sentinel view id for the 3D model in an editor's view list. */
export const VIEW_3D = 'mdt-3d';

export interface View3DOptions {
  ui: UIShell;
  renderer: Renderer;
  template(): ProductTemplate;
  /** Artwork painted onto the model: the shopper's design, or the builder's calibration sample. */
  design(): DesignDocument;
  onFallback(): void;
  onParts?(parts: string[]): void;
}

const modelKey = (template: ProductTemplate) => {
  const m = template.model3d;
  if (!m) return '';
  const src = m.src ?? '';
  // A cheap fingerprint: embedded models can be megabytes long.
  return JSON.stringify([m.kind, m.preset, m.color, m.size, src.length, src.slice(0, 96), src.slice(-96)]);
};

/** The 3D stage layer shared by both editors. The WebGL module loads on first use. */
export class View3D {
  readonly element: HTMLElement;
  active = false;
  private canvas: HTMLCanvasElement;
  private state: HTMLElement;
  private autoButton: HTMLButtonElement;
  private pullButton: HTMLButtonElement;
  private softPanel: HTMLElement;
  private softRange: HTMLInputElement;
  private hintText: HTMLElement;
  private pulling = false;
  private viewer: Viewer | null = null;
  private starting: Promise<void> | null = null;
  private loadedKey = '';
  private loading: AbortController | null = null;
  private textures = new Map<string, HTMLCanvasElement>();
  private dirty = false;
  private painting: Promise<void> | null = null;
  private observer: ResizeObserver;
  private destroyed = false;
  private reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private autoRotate = false;

  constructor(private o: View3DOptions) {
    const { ui } = o;
    const t = ui.t;
    this.element = node('div', 'mdt-view3d');
    this.element.hidden = true;
    this.canvas = node('canvas', 'mdt-view3d-canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', t('view3d.canvas', '3D product preview. Drag or use the arrow keys to rotate; press 0 to reset.'));
    const bar = node('div', 'mdt-float mdt-view3d-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('view3d.tools', '3D view controls'));
    this.autoButton = iconButton(t('view3d.autoRotate', 'Auto-rotate'), 'orbit', () => this.setAutoRotate(!this.autoRotate), { side: 'top' });
    this.autoButton.setAttribute('aria-pressed', 'false');
    // Soft products (garments, cushions, caps) can be pulled like fabric; rigid ones such as mugs cannot.
    this.pullButton = iconButton(t('view3d.pull', 'Pull fabric'), 'hand', () => this.setPull(!this.pulling), { side: 'top' });
    this.pullButton.setAttribute('aria-pressed', 'false');
    this.pullButton.hidden = true;
    this.softRange = node('input', 'mdt-range');
    this.softRange.type = 'range'; this.softRange.min = '5'; this.softRange.max = '100'; this.softRange.step = '5';
    this.softRange.setAttribute('aria-label', t('view3d.softness', 'Fabric looseness'));
    this.softRange.addEventListener('input', () => { this.showSoftness(); this.viewer?.setSoftness(Number(this.softRange.value) / 100); });
    this.softPanel = node('div', 'mdt-float mdt-view3d-soft');
    this.softPanel.hidden = true;
    this.softPanel.append(node('span', 'mdt-view3d-soft-label', t('view3d.stiff', 'Stiff')), this.softRange, node('span', 'mdt-view3d-soft-label', t('view3d.loose', 'Loose')));
    bar.append(
      iconButton(t('stage.zoomOut', 'Zoom out'), 'zoomOut', () => this.viewer?.zoom(1.2), { side: 'top' }),
      iconButton(t('stage.zoomIn', 'Zoom in'), 'zoomIn', () => this.viewer?.zoom(1 / 1.2), { side: 'top' }),
      node('span', 'mdt-divider'),
      this.pullButton,
      this.autoButton,
      iconButton(t('view3d.reset', 'Reset view'), 'rotateCcw', () => this.viewer?.reset(), { side: 'top', shortcut: '0' }),
      iconButton(t('view3d.snapshot', 'Save 3D image'), 'camera', () => void this.download(), { side: 'top' }),
    );
    const hint = node('div', 'mdt-view3d-hint');
    this.hintText = node('span');
    hint.append(icon('orbit', 14), this.hintText);
    this.state = node('div', 'mdt-view3d-state');
    this.element.append(this.canvas, hint, this.softPanel, bar, this.state);
    this.showHint();
    // Floating stage controls stay above; the 3D layer sits under them.
    ui.stage.insertBefore(this.element, ui.floating);
    this.observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && this.viewer) this.viewer.resize(box.width, box.height, globalThis.devicePixelRatio || 1);
    });
    this.observer.observe(this.element);
  }

  get available(): boolean { return !!this.o.template().model3d; }

  async show(): Promise<void> {
    if (this.destroyed || !this.available) return;
    this.active = true;
    this.element.hidden = false;
    this.o.ui.shell.dataset.mdtView = '3d';
    await this.ensure();
    if (!this.active || !this.viewer) return;
    const rect = this.element.getBoundingClientRect();
    this.viewer.resize(rect.width, rect.height, globalThis.devicePixelRatio || 1);
    await this.sync();
    this.viewer?.setAutoRotate(this.autoRotate);
  }
  hide(): void {
    this.active = false;
    this.element.hidden = true;
    delete this.o.ui.shell.dataset.mdtView;
    this.viewer?.setAutoRotate(false);
  }
  /** Call after any template or design change; work is coalesced and skipped while hidden. */
  refresh(): void {
    if (!this.active || this.destroyed) return;
    void this.sync();
  }
  focus(surfaceId: string): void { if (this.active) this.viewer?.focus(surfaceId); }
  parts(): string[] { return this.viewer?.printableParts() ?? []; }
  async snapshot(): Promise<Blob> {
    if (!this.viewer) throw new Error(this.o.ui.t('view3d.unavailable', '3D preview isn’t available on this device.'));
    return this.viewer.snapshot();
  }
  destroy(): void {
    this.destroyed = true; this.active = false;
    this.loading?.abort(); this.observer.disconnect();
    this.viewer?.dispose(); this.viewer = null;
    for (const canvas of this.textures.values()) canvas.width = canvas.height = 0;
    this.textures.clear();
    this.element.remove();
  }

  private showHint(): void {
    const { t, coarse } = this.o.ui;
    this.hintText.textContent = this.pulling
      ? t('view3d.hintPull', 'Drag the fabric to pull it · it springs back when released')
      : coarse ? t('view3d.hintTouch', 'Drag to rotate · pinch to zoom') : t('view3d.hint', 'Drag to rotate · Ctrl + scroll to zoom');
  }
  private showSoftness(): void {
    const value = Number(this.softRange.value);
    this.softRange.style.setProperty('--mdt-ui-fill', `${(value - 5) / 95 * 100}%`);
    this.softRange.setAttribute('aria-valuetext', this.o.ui.t('unit.percentValue', '{value}%', { value }));
  }
  /** The pull tool: dragging deforms soft products instead of turning them. Preview only. */
  private setPull(on: boolean): void {
    this.pulling = on && !!this.viewer?.deformable;
    if (this.pulling) this.setAutoRotate(false);
    this.viewer?.setTool(this.pulling ? 'pull' : 'orbit');
    this.pullButton.setAttribute('aria-pressed', String(this.pulling));
    this.softPanel.hidden = !this.pulling;
    if (this.pulling && this.viewer) { this.softRange.value = String(Math.round(this.viewer.softness * 20) * 5); this.showSoftness(); }
    this.showHint();
    this.o.ui.setStatus(this.pulling ? this.o.ui.t('view3d.pullOn', 'Pull tool on. Drag the fabric to see how it moves.') : this.o.ui.t('view3d.pullOff', 'Rotate tool on.'));
  }
  private setAutoRotate(on: boolean): void {
    this.autoRotate = on;
    this.autoButton.setAttribute('aria-pressed', String(on));
    this.viewer?.setAutoRotate(on);
  }
  private async download(): Promise<void> {
    try { downloadBlob(await this.snapshot(), 'mockup-3d.png'); this.o.ui.setStatus(this.o.ui.t('view3d.saved', '3D image downloaded.')); }
    catch (error) { this.o.ui.setStatus(this.o.ui.errorText(error), true); }
  }
  private message(text: string, actions: HTMLButtonElement[] = [], busy = false): void {
    if (!text) { this.state.replaceChildren(); return; }
    const card = node('div', 'mdt-view3d-card');
    card.dataset.busy = String(busy);
    const mark = node('div', 'mdt-empty-icon'); mark.append(icon('cube', 24));
    const row = node('div', 'mdt-btn-row');
    row.append(...actions);
    card.append(mark, node('p', '', text), ...(actions.length ? [row] : []));
    this.state.replaceChildren(card);
  }
  private fallback(text: string): void {
    const t = this.o.ui.t;
    this.viewer?.dispose(); this.viewer = null; this.loadedKey = '';
    const retry = button(t('view3d.retry', 'Try again'), () => { this.message(''); void this.show(); }, 'mdt-btn-sm', 'replace');
    const photo = button(t('view3d.showPhoto', 'Show photo preview'), () => this.o.onFallback(), 'mdt-btn-sm mdt-btn-primary', 'image');
    this.message(text, [retry, photo]);
  }
  private ensure(): Promise<void> {
    if (this.viewer) return Promise.resolve();
    this.starting ??= (async () => {
      const t = this.o.ui.t;
      this.message(t('view3d.loading', 'Loading 3D preview…'), [], true);
      try {
        const { createViewer } = await import('./model3d.js');
        if (this.destroyed) return;
        this.viewer = await createViewer(this.canvas, {
          reducedMotion: this.reducedMotion,
          onContextLost: () => this.fallback(t('view3d.lost', 'The 3D preview stopped because the graphics device was reset.')),
        });
        this.message('');
      } catch (error) {
        this.fallback(this.o.ui.errorText(error));
      } finally { this.starting = null; }
    })();
    return this.starting;
  }
  /** Loads the model when it changed, then repaints print textures from the current design. */
  private async sync(): Promise<void> {
    this.dirty = true;
    if (this.painting) return this.painting;
    if (!this.active || !this.viewer) return;
    let run: Promise<void> | null = null;
    run = (async () => {
      // Yield first: otherwise a pass with nothing to do would finish before `painting` is assigned.
      await Promise.resolve();
      try {
        while (this.dirty && this.active && this.viewer && !this.destroyed) {
          this.dirty = false;
          const template = this.o.template(), model = template.model3d;
          if (!model) return;
          const key = modelKey(template);
          if (key !== this.loadedKey) {
            this.loading?.abort();
            const controller = new AbortController(); this.loading = controller;
            this.message(this.o.ui.t('view3d.loading', 'Loading 3D preview…'), [], true);
            try { await this.viewer.load(model, template.surfaces, controller.signal); }
            catch (error) {
              if (controller.signal.aborted || this.destroyed) return;
              this.fallback(this.o.ui.errorText(error)); return;
            }
            this.loadedKey = key;
            this.message('');
            this.pullButton.hidden = !this.viewer.deformable;
            if (this.pulling && !this.viewer.deformable) this.setPull(false); else this.viewer.setTool(this.pulling ? 'pull' : 'orbit');
            this.o.onParts?.(this.viewer?.printableParts() ?? []);
          } else this.viewer.setPlacement(model, template.surfaces);
          const design = this.o.design();
          for (const binding of model.bindings) {
            let canvas = this.textures.get(binding.surfaceId);
            if (!canvas) { canvas = document.createElement('canvas'); this.textures.set(binding.surfaceId, canvas); }
            const drawn = await this.o.renderer.renderSurface(canvas, template, design, binding.surfaceId, 1024).catch(() => false);
            if (!this.viewer || this.destroyed) return;
            this.viewer.setPrint(binding.surfaceId, drawn ? canvas : null);
          }
        }
      } finally { if (this.painting === run) this.painting = null; }
    })();
    this.painting = run;
    return run;
  }
}
