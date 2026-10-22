import { icon } from './icons.js';
import type { Rect } from './render.js';
import { iconButton, isTyping, node, type UIShell } from './ui.js';
import { Viewport, type Point } from './viewport.js';

export interface GestureHandlers { move(at: Point, event: PointerEvent): void; end(event: PointerEvent, cancelled: boolean): void }
export interface StageOptions {
  ui: UIShell;
  signal: AbortSignal;
  /** Return handlers to consume a primary pointer press at a stage point; null lets the stage pan instead. */
  begin(at: Point, event: PointerEvent): GestureHandlers | null;
  hover?(at: Point | null, event?: PointerEvent): void;
  /** The view transform changed: redraw pixels and overlays. */
  changed(): void;
  files?(files: File[]): void;
  dropLabel?: string;
}

const hasFiles = (event: DragEvent) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');

/** Zoom, pan, pinch, drop and pointer routing shared by both editors. Listeners stay on the component's own elements. */
export class StageController {
  readonly viewport: Viewport;
  readonly tools: HTMLElement;
  readonly zoom: HTMLElement;
  readonly veil: HTMLElement;
  tool: 'select' | 'hand' = 'select';
  /** True while another layer (the 3D view) owns the stage. */
  suspended = false;
  private space = false;
  private panning: { id: number; x: number; y: number } | null = null;
  private gesture: { id: number; handlers: GestureHandlers } | null = null;
  private pointers = new Map<number, Point>();
  private pinch: { distance: number; mid: Point } | null = null;
  private cursor = '';
  private zoomValue: HTMLButtonElement;
  private selectButton: HTMLButtonElement;
  private handButton: HTMLButtonElement;
  private observer: ResizeObserver;
  private content: Rect | null = null;

  constructor(private o: StageOptions) {
    const { ui, signal } = o;
    const t = ui.t;
    const mod = ui.keys.mod;
    this.viewport = new Viewport(() => this.update());
    const stage = ui.stage;

    this.tools = node('div', 'mdt-float mdt-tools');
    this.tools.setAttribute('role', 'toolbar');
    this.tools.setAttribute('aria-label', t('stage.tools', 'Canvas tools'));
    this.tools.setAttribute('aria-orientation', 'vertical');
    this.selectButton = iconButton(t('stage.select', 'Select and move'), 'pointer', () => this.setTool('select'), { shortcut: 'V', side: 'end' });
    this.handButton = iconButton(t('stage.hand', 'Pan the canvas'), 'hand', () => this.setTool('hand'), { shortcut: 'H', side: 'end' });
    this.tools.append(this.selectButton, this.handButton);

    this.zoom = node('div', 'mdt-float mdt-zoom');
    this.zoom.setAttribute('role', 'toolbar');
    this.zoom.setAttribute('aria-label', t('stage.zoomControls', 'Zoom'));
    this.zoomValue = node('button', 'mdt-btn mdt-btn-ghost mdt-zoom-value');
    this.zoomValue.type = 'button';
    this.zoomValue.dataset.mdtTip = t('stage.fit', 'Fit to screen'); this.zoomValue.dataset.mdtKbd = `${mod}0`;
    this.zoomValue.addEventListener('click', () => this.viewport.fit());
    this.zoom.append(
      iconButton(t('stage.zoomOut', 'Zoom out'), 'zoomOut', () => this.viewport.step(-1), { shortcut: `${mod}−` }),
      this.zoomValue,
      iconButton(t('stage.zoomIn', 'Zoom in'), 'zoomIn', () => this.viewport.step(1), { shortcut: `${mod}+` }),
    );

    this.veil = node('div', 'mdt-dropveil');
    this.veil.hidden = true;
    this.veil.append(icon('upload', 28), node('span', '', o.dropLabel ?? t('stage.drop', 'Drop image to add it')));
    ui.floating.append(this.tools, this.zoom);
    stage.append(this.veil);
    this.setTool('select');

    this.observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) this.viewport.resize(box.width, box.height);
    });
    this.observer.observe(stage);

    stage.addEventListener('pointerdown', event => this.down(event), { signal });
    stage.addEventListener('pointermove', event => this.moved(event), { signal });
    stage.addEventListener('pointerup', event => this.up(event, false), { signal });
    stage.addEventListener('pointercancel', event => this.up(event, true), { signal });
    stage.addEventListener('lostpointercapture', event => { if (this.gesture?.id === event.pointerId || this.panning?.id === event.pointerId) this.up(event, false); }, { signal });
    stage.addEventListener('pointerleave', event => { if (!this.gesture && !this.panning && event.pointerType === 'mouse') o.hover?.(null); }, { signal });
    stage.addEventListener('wheel', event => {
      if ((event.target as Element).closest('.mdt-view3d')) return;
      const rect = stage.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        this.viewport.zoomBy(Math.exp(-delta * .0022), event.clientX - rect.left, event.clientY - rect.top);
      } else if (!this.viewport.isFitted) {
        // When the product is framed, a plain wheel keeps scrolling the host page.
        event.preventDefault();
        this.viewport.panBy(-event.deltaX, -event.deltaY);
      }
    }, { signal, passive: false });
    stage.addEventListener('contextmenu', event => { if (this.panning) event.preventDefault(); }, { signal });
    for (const type of ['dragenter', 'dragover'] as const) stage.addEventListener(type, event => {
      if (!o.files || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      this.veil.hidden = false;
    }, { signal });
    stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget as Node)) this.veil.hidden = true; }, { signal });
    stage.addEventListener('drop', event => {
      if (!o.files || !hasFiles(event)) return;
      event.preventDefault();
      this.veil.hidden = true;
      const files = Array.from(event.dataTransfer!.files);
      if (files.length) o.files(files);
    }, { signal });

    ui.shell.addEventListener('keydown', event => {
      const modKey = event.ctrlKey || event.metaKey;
      if (this.suspended) return;
      if (modKey && !event.altKey && ['=', '+', '-', '_', '0', '1'].includes(event.key)) {
        if (isTyping(event.target)) return;
        event.preventDefault();
        if (event.key === '0') this.viewport.fit();
        else if (event.key === '1') this.viewport.zoomTo(1);
        else this.viewport.step(event.key === '-' || event.key === '_' ? -1 : 1);
        return;
      }
      if (modKey || event.altKey || isTyping(event.target)) return;
      const onCanvas = event.target === ui.canvas;
      if (event.key === ' ' && onCanvas) { event.preventDefault(); if (!this.space) { this.space = true; this.applyCursor(); } return; }
      if (event.target instanceof HTMLButtonElement) return;
      if (event.key === 'v' || event.key === 'V') this.setTool('select');
      else if (event.key === 'h' || event.key === 'H') this.setTool('hand');
      else if (event.key === '+' || event.key === '=') this.viewport.step(1);
      else if (event.key === '-') this.viewport.step(-1);
    }, { signal });
    ui.shell.addEventListener('keyup', event => { if (event.key === ' ' && this.space) { this.space = false; this.applyCursor(); } }, { signal });
    ui.canvas.addEventListener('blur', () => { if (this.space) { this.space = false; this.applyCursor(); } }, { signal });
  }

  setTool(tool: 'select' | 'hand'): void {
    this.tool = tool;
    this.selectButton.setAttribute('aria-pressed', String(tool === 'select'));
    this.handButton.setAttribute('aria-pressed', String(tool === 'hand'));
    this.applyCursor();
  }
  /** Frame a new product photo. */
  setContent(rect: Rect | null, refit = false): void { this.content = rect; this.viewport.setContent(rect, refit); }
  /** Cursor requested by the editor for the current hover target. */
  setCursor(cursor: string): void { this.cursor = cursor; this.applyCursor(); }
  get active(): boolean { return !!this.gesture; }
  private applyCursor(): void {
    const pan = this.tool === 'hand' || this.space;
    this.o.ui.stage.style.cursor = this.panning ? 'grabbing' : pan ? 'grab' : this.cursor || 'default';
  }
  private local(event: { clientX: number; clientY: number }): Point {
    const rect = this.o.ui.stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  private update(): void {
    const { ui } = this.o;
    this.zoomValue.textContent = ui.t('stage.zoomValue', '{value}%', { value: Math.round(this.viewport.scale * 100) });
    if (this.content) {
      const p = this.viewport.toScreen(this.content.x, this.content.y);
      ui.artboard.hidden = false;
      ui.artboard.style.width = `${this.content.width * this.viewport.scale}px`;
      ui.artboard.style.height = `${this.content.height * this.viewport.scale}px`;
      ui.artboard.style.transform = `translate(${p.x}px,${p.y}px)`;
    } else ui.artboard.hidden = true;
    this.o.changed();
  }
  private down(event: PointerEvent): void {
    const target = event.target as Element;
    if (target.closest('.mdt-float, .mdt-stage-empty, .mdt-banner, .mdt-view3d')) return;
    const { ui } = this.o;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2 && event.pointerType === 'touch') {
      // A second finger turns any gesture into pinch zoom; the first finger's edit is cancelled.
      if (this.gesture) { const g = this.gesture; this.gesture = null; g.handlers.end(event, true); }
      this.panning = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
      return;
    }
    if (this.pointers.size > 1 || (event.button !== 0 && event.button !== 1)) return;
    if (ui.root.activeElement !== ui.canvas) ui.canvas.focus({ preventScroll: true });
    const local = this.local(event);
    const at = this.viewport.toStage(local.x, local.y);
    const pan = event.button === 1 || this.tool === 'hand' || this.space;
    if (!pan) {
      const handlers = this.o.begin(at, event);
      if (handlers) {
        this.gesture = { id: event.pointerId, handlers };
        this.capture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    this.panning = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.capture(event.pointerId);
    this.applyCursor();
    event.preventDefault();
  }
  /** Capture keeps a drag alive outside the stage; an inactive (e.g. synthetic) pointer cannot be captured. */
  private capture(pointerId: number): void {
    try { this.o.ui.stage.setPointerCapture(pointerId); } catch { /* the gesture still works while over the stage */ }
  }
  private moved(event: PointerEvent): void {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      if (this.pinch.distance > 0) this.viewport.zoomBy(distance / this.pinch.distance, mid.x, mid.y);
      this.viewport.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      this.pinch = { distance, mid };
      return;
    }
    const local = this.local(event);
    if (this.gesture?.id === event.pointerId) { this.gesture.handlers.move(this.viewport.toStage(local.x, local.y), event); return; }
    if (this.panning?.id === event.pointerId) {
      this.viewport.panBy(event.clientX - this.panning.x, event.clientY - this.panning.y);
      this.panning.x = event.clientX; this.panning.y = event.clientY;
      return;
    }
    if (!this.gesture && !this.panning && event.pointerType === 'mouse' && !event.buttons) this.o.hover?.(this.viewport.toStage(local.x, local.y), event);
  }
  private up(event: PointerEvent, cancelled: boolean): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const { ui } = this.o;
    if (ui.stage.hasPointerCapture(event.pointerId)) ui.stage.releasePointerCapture(event.pointerId);
    if (this.gesture?.id === event.pointerId) { const g = this.gesture; this.gesture = null; g.handlers.end(event, cancelled); }
    if (this.panning?.id === event.pointerId) { this.panning = null; this.applyCursor(); }
  }
  destroy(): void { this.observer.disconnect(); this.pointers.clear(); this.gesture = null; this.panning = null; }
}
