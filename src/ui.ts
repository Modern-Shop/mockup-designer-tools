import type { EditorOptions, EditorTheme } from './types.js';
import { EditorError } from './core.js';
import { icon, type IconName } from './icons.js';

export type Layout = 'wide' | 'medium' | 'narrow';

export const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export function button(label: string, handler: (event: MouseEvent) => unknown, className = '', iconName?: IconName): HTMLButtonElement {
  const b = node('button', `mdt-btn ${className}`.trim());
  b.type = 'button';
  if (iconName) b.append(icon(iconName, 16));
  b.append(node('span', 'mdt-btn-label', label));
  b.addEventListener('click', handler);
  return b;
}
export function setLabel(b: HTMLButtonElement, label: string, iconName?: IconName): void {
  const span = b.querySelector('.mdt-btn-label');
  if (span) span.textContent = label;
  if (iconName) b.querySelector('svg')?.replaceWith(icon(iconName, 16));
}
/** Icon-only control. The label is its accessible name and tooltip; a shortcut is shown in the tooltip. */
export function iconButton(label: string, name: IconName, handler: (event: MouseEvent) => unknown, options: { shortcut?: string; className?: string; side?: 'top' | 'bottom' | 'end'; size?: number } = {}): HTMLButtonElement {
  const b = node('button', `mdt-btn mdt-btn-ghost mdt-icon-btn ${options.className ?? ''}`.trim());
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.dataset.mdtTip = label;
  if (options.shortcut) b.dataset.mdtKbd = options.shortcut;
  if (options.side) b.dataset.mdtTipSide = options.side;
  b.append(icon(name, options.size ?? 18));
  b.addEventListener('click', handler);
  return b;
}
export function setTip(b: HTMLElement, label: string): void { b.setAttribute('aria-label', label); b.dataset.mdtTip = label; }

export function field(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const wrapper = node('div', 'mdt-field');
  const caption = node('label', 'mdt-field-label');
  caption.append(node('span', 'mdt-label', label), control);
  wrapper.append(caption);
  if (hint) wrapper.append(node('p', 'mdt-hint', hint));
  return wrapper;
}

export function textInput(value: string, label: string, onCommit: (value: string) => void, key?: string): HTMLInputElement {
  const input = node('input', 'mdt-input');
  input.type = 'text'; input.value = value; input.maxLength = 120;
  input.setAttribute('aria-label', label);
  if (key) input.dataset.mdtKey = key;
  input.addEventListener('change', () => onCommit(input.value.trim()));
  return input;
}

export interface NumberFieldOptions {
  label: string;
  prefix?: string;
  prefixIcon?: IconName;
  unit?: string;
  min?: number; max?: number; step?: number; digits?: number;
  key?: string;
  /** Live updates while scrubbing the prefix. */
  onInput?: (value: number) => void;
  onCommit: (value: number) => void;
}
export interface NumberField { element: HTMLDivElement; input: HTMLInputElement; set(value: number): void; disable(disabled: boolean): void }

/** Compact numeric input. Dragging its prefix horizontally scrubs the value (Shift: ×10); typing commits on change. */
export function numberField(o: NumberFieldOptions): NumberField {
  const element = node('div', 'mdt-num');
  const input = node('input');
  input.type = 'number'; input.inputMode = 'decimal'; input.setAttribute('aria-label', o.label);
  if (o.min !== undefined) input.min = String(o.min);
  if (o.max !== undefined) input.max = String(o.max);
  input.step = String(o.step ?? 1);
  if (o.key) input.dataset.mdtKey = o.key;
  const digits = o.digits ?? 2;
  const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const format = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
  let current = 0;
  let scrub: { id: number; x: number; start: number; moved: boolean } | null = null;
  if (o.prefix || o.prefixIcon) {
    const prefix = node('span', 'mdt-num-label', o.prefix);
    prefix.setAttribute('aria-hidden', 'true');
    if (o.prefixIcon) prefix.append(icon(o.prefixIcon, 14));
    prefix.addEventListener('pointerdown', event => {
      if (input.disabled || event.button !== 0) return;
      event.preventDefault();
      prefix.setPointerCapture(event.pointerId);
      scrub = { id: event.pointerId, x: event.clientX, start: current, moved: false };
    });
    prefix.addEventListener('pointermove', event => {
      if (!scrub || scrub.id !== event.pointerId) return;
      const dx = event.clientX - scrub.x;
      if (!scrub.moved && Math.abs(dx) < 3) return;
      scrub.moved = true;
      const next = clamp(scrub.start + Math.round(dx / 2) * (o.step ?? 1) * (event.shiftKey ? 10 : 1));
      if (next === current) return;
      current = next; input.value = format(next);
      o.onInput?.(next);
    });
    const end = (event: PointerEvent) => {
      if (!scrub || scrub.id !== event.pointerId) return;
      const gesture = scrub; scrub = null;
      if (prefix.hasPointerCapture(event.pointerId)) prefix.releasePointerCapture(event.pointerId);
      if (!gesture.moved) { input.focus(); input.select(); return; }
      if (current !== gesture.start || o.onInput) o.onCommit(current);
    };
    prefix.addEventListener('pointerup', end);
    prefix.addEventListener('pointercancel', end);
    prefix.addEventListener('lostpointercapture', end);
    element.append(prefix);
  }
  element.append(input);
  if (o.unit) element.append(node('span', 'mdt-num-unit', o.unit));
  input.addEventListener('change', () => {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) { input.value = format(current); return; }
    current = clamp(value); input.value = format(current);
    o.onCommit(current);
  });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); input.value = format(current); input.blur(); } });
  return {
    element, input,
    set(value: number) { current = value; if ((element.getRootNode() as ShadowRoot).activeElement !== input && !scrub) input.value = format(value); },
    disable(disabled: boolean) { input.disabled = disabled; element.dataset.disabled = String(disabled); },
  };
}

export function toggle(label: string, checked: boolean, onChange: (value: boolean) => void, description?: string, key?: string): { element: HTMLLabelElement; input: HTMLInputElement } {
  const element = node('label', 'mdt-switch-row');
  const text = node('span', 'mdt-switch-text');
  text.append(node('span', 'mdt-switch-label', label));
  if (description) text.append(node('span', 'mdt-hint', description));
  const input = node('input', 'mdt-switch');
  input.type = 'checkbox'; input.checked = checked; input.setAttribute('role', 'switch');
  if (key) input.dataset.mdtKey = key;
  input.addEventListener('change', () => onChange(input.checked));
  element.append(text, input);
  return { element, input };
}

export interface SegmentItem<T extends string> { value: T; label: string; icon?: IconName; iconOnly?: boolean; extra?: Node }
/** A row of mutually exclusive toggle buttons. Arrow keys move between options. */
export function segmented<T extends string>(label: string, items: Array<SegmentItem<T>>, value: T, onChange: (value: T) => void, className = ''): HTMLDivElement {
  const group = node('div', `mdt-seg ${className}`.trim());
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  for (const item of items) {
    const b = node('button');
    b.type = 'button'; b.dataset.value = item.value;
    b.setAttribute('aria-pressed', String(item.value === value));
    if (item.icon) b.append(icon(item.icon, 16));
    if (item.iconOnly) { b.setAttribute('aria-label', item.label); b.dataset.mdtTip = item.label; }
    else b.append(node('span', 'mdt-seg-label', item.label));
    if (item.extra) b.append(item.extra);
    b.addEventListener('click', () => onChange(item.value));
    group.append(b);
  }
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const forward = (event.key === 'ArrowRight') !== (getComputedStyle(group).direction === 'rtl');
    buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length].focus();
    event.preventDefault();
  });
  return group;
}

export function section(title?: string, ...children: Array<Node | string>): HTMLElement {
  const element = node('section', 'mdt-section');
  if (title) element.append(node('h3', 'mdt-section-title', title));
  element.append(...children);
  return element;
}
export function callout(text: string | Node, tone: 'info' | 'warn' | 'danger' | 'ok' = 'info'): HTMLDivElement {
  const element = node('div', 'mdt-callout');
  element.dataset.tone = tone;
  element.append(icon(tone === 'ok' ? 'checkCircle' : tone === 'info' ? 'info' : 'warning', 16));
  const body = node('div', 'mdt-callout-body');
  body.append(text);
  element.append(body);
  return element;
}
export function chip(text: string, tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' = 'neutral', dot = false): HTMLSpanElement {
  const element = node('span', `mdt-chip${dot ? ' mdt-chip-dot' : ''}`, text);
  element.dataset.tone = tone;
  return element;
}

export interface UIShell {
  element: HTMLElement; root: ShadowRoot; shell: HTMLElement;
  topStart: HTMLElement; topCenter: HTMLElement; topEnd: HTMLElement;
  /** Secondary icon tools (history, downloads) and the primary actions of the top bar. */
  topTools: HTMLElement; topActions: HTMLElement;
  rail: HTMLElement; left: HTMLElement; right: HTMLElement;
  stage: HTMLElement; canvas: HTMLCanvasElement; artboard: HTMLElement; overlay: SVGSVGElement; floating: HTMLElement; labels: HTMLElement;
  status: HTMLElement; statusEnd: HTMLElement;
  readonly layout: Layout;
  readonly coarse: boolean;
  t(key: string, fallback?: string, vars?: Record<string, string | number>): string;
  /** Plural-aware message: reads `key.<CLDR category>` (then `key.other`) and interpolates `{count}`. */
  plural(key: string, count: number, forms: { one: string; other: string }, vars?: Record<string, string | number>): string;
  /** Locale-aware list such as “position, size, and rotation”. */
  list(items: string[]): string;
  /** Localized text for a caught error: coded errors use `errors.<code>`, others `errors.operation`. */
  errorText(error: unknown): string;
  format(value: number, digits?: number): string;
  /** Localized key names for shortcut hints. */
  readonly keys: { mod: string; redo: string; shift: string; alt: string; space: string; esc: string; del: string };
  setStatus(message: string, error?: boolean): void;
  setTheme(theme: EditorTheme): void;
  setBusy(busy: boolean): void;
  openDialog(title: string, body: HTMLElement): () => void;
  onLayout(listener: (layout: Layout) => void): void;
  /** Re-focus the control with the same data-mdt-key after a panel is rebuilt. */
  preserveFocus(rebuild: () => void): void;
  destroy(): void;
}

const dark = `--mdt-ui-bg:var(--mdt-color-background,#1b1c21);--mdt-ui-bg-2:#23252b;--mdt-ui-bg-3:#2b2d34;--mdt-ui-hover:rgba(255,255,255,.06);--mdt-ui-active:rgba(255,255,255,.1);--mdt-ui-stage:var(--mdt-color-stage,#121316);--mdt-ui-dot:rgba(255,255,255,.07);--mdt-ui-line:#2c2e36;--mdt-ui-line-2:#3a3d47;--mdt-ui-text:var(--mdt-color-text,#f2f3f6);--mdt-ui-text-2:#c3c6cf;--mdt-ui-text-3:#959aa7;--mdt-ui-accent-soft:color-mix(in srgb,var(--mdt-ui-accent) 22%,transparent);--mdt-ui-accent-ink:color-mix(in srgb,var(--mdt-ui-accent) 55%,#fff);--mdt-ui-danger:#f97066;--mdt-ui-danger-soft:rgba(240,68,56,.14);--mdt-ui-warn:#fdb022;--mdt-ui-warn-soft:rgba(247,144,9,.14);--mdt-ui-ok:#47cd89;--mdt-ui-ok-soft:rgba(23,178,106,.15);--mdt-ui-float:rgba(33,35,41,.9);--mdt-ui-checker:repeating-conic-gradient(#2b2d34 0 25%,#23252b 0 50%) 0 0/12px 12px;--mdt-ui-shadow-1:0 1px 2px rgba(0,0,0,.4);--mdt-ui-shadow-2:0 10px 28px -6px rgba(0,0,0,.6),0 2px 6px -2px rgba(0,0,0,.4);--mdt-ui-shadow-3:0 28px 56px -12px rgba(0,0,0,.7);--mdt-ui-artboard-shadow:0 0 0 1px rgba(255,255,255,.04),0 18px 48px -10px rgba(0,0,0,.75);--mdt-ui-tip:#3a3d47;color-scheme:dark`;
const rotateCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M19 12a7 7 0 1 1-2-4.9M19 4.5v4h-4' stroke='white' stroke-width='4'/><path d='M19 12a7 7 0 1 1-2-4.9M19 4.5v4h-4' stroke='black' stroke-width='1.7'/></g></svg>") 12 12, alias`;

const styles = `
:host{display:block;min-inline-size:0;max-inline-size:100%;font:400 13px/1.45 var(--mdt-font-family,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color:var(--mdt-color-text,#101828);text-align:start;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;white-space:normal}
.mdt-shell,.mdt-shell *,.mdt-shell *::before,.mdt-shell *::after{box-sizing:border-box}
.mdt-shell{--mdt-ui-accent:var(--mdt-color-accent,#4f5bff);--mdt-ui-on-accent:var(--mdt-color-on-accent,#fff);--mdt-ui-bg:var(--mdt-color-background,#fff);--mdt-ui-bg-2:#f7f8fa;--mdt-ui-bg-3:#eef0f4;--mdt-ui-hover:rgba(16,24,40,.05);--mdt-ui-active:rgba(16,24,40,.09);--mdt-ui-stage:var(--mdt-color-stage,#e9ebf0);--mdt-ui-dot:rgba(16,24,40,.11);--mdt-ui-line:#e4e7ec;--mdt-ui-line-2:#d0d5dd;--mdt-ui-text:var(--mdt-color-text,#101828);--mdt-ui-text-2:#475467;--mdt-ui-text-3:#667085;--mdt-ui-accent-soft:color-mix(in srgb,var(--mdt-ui-accent) 10%,transparent);--mdt-ui-accent-ink:color-mix(in srgb,var(--mdt-ui-accent) 84%,#000);--mdt-ui-danger:#d92d20;--mdt-ui-danger-soft:#fef3f2;--mdt-ui-warn:#b54708;--mdt-ui-warn-soft:#fffaeb;--mdt-ui-ok:#067647;--mdt-ui-ok-soft:#ecfdf3;--mdt-ui-float:rgba(255,255,255,.94);--mdt-ui-checker:repeating-conic-gradient(#eef0f4 0 25%,#fff 0 50%) 0 0/12px 12px;--mdt-ui-shadow-1:0 1px 2px rgba(16,24,40,.07);--mdt-ui-shadow-2:0 10px 28px -6px rgba(16,24,40,.18),0 2px 6px -2px rgba(16,24,40,.08);--mdt-ui-shadow-3:0 28px 56px -12px rgba(16,24,40,.32);--mdt-ui-artboard-shadow:0 0 0 1px rgba(16,24,40,.04),0 16px 40px -10px rgba(16,24,40,.28);--mdt-ui-tip:#101828;--mdt-ui-guide:#f0359a;--mdt-ui-r:10px;--mdt-ui-r-sm:7px;--mdt-ui-cursor-rotate:${rotateCursor};--mdt-ui-rail:0px;
  position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;block-size:var(--mdt-height,720px);min-block-size:440px;font:400 13px/1.45 var(--mdt-font-family,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color:var(--mdt-ui-text);background:var(--mdt-ui-bg);border:1px solid var(--mdt-ui-line);border-radius:var(--mdt-radius,14px);overflow:clip;isolation:isolate;text-align:start;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:horizontal-tb;color-scheme:light;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
.mdt-shell[data-mdt-theme=dark]{${dark}}
@media (prefers-color-scheme:dark){.mdt-shell[data-mdt-theme=auto]{${dark}}}
.mdt-shell[data-mdt-rail=true]{--mdt-ui-rail:72px}
.mdt-shell [hidden]{display:none!important}
.mdt-shell :focus{outline:none}
.mdt-shell :focus-visible{outline:2px solid var(--mdt-ui-accent);outline-offset:2px}
.mdt-shell h2,.mdt-shell h3,.mdt-shell p,.mdt-shell ul,.mdt-shell ol,.mdt-shell dl,.mdt-shell dd,.mdt-shell figure{margin:0;padding:0}
.mdt-shell ul,.mdt-shell ol{list-style:none}
.mdt-shell img{display:block;max-inline-size:100%}
.mdt-sr{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mdt-icon{flex:none;display:block}

/* Top bar */
.mdt-topbar{position:relative;z-index:6;display:flex;align-items:center;gap:12px;min-block-size:56px;padding:8px 10px 8px 12px;background:var(--mdt-ui-bg);border-block-end:1px solid var(--mdt-ui-line)}
.mdt-top-start{display:flex;align-items:center;gap:10px;flex:1 1 0;min-inline-size:0}
.mdt-top-center{display:flex;align-items:center;justify-content:center;flex:0 1 auto;min-inline-size:0}
.mdt-top-end{display:flex;align-items:center;justify-content:flex-end;gap:4px;flex:1 1 0;min-inline-size:max-content}
.mdt-top-tools,.mdt-top-actions{display:flex;align-items:center;gap:2px}
.mdt-top-actions{gap:8px}
.mdt-top-tools:empty,.mdt-top-actions:empty,.mdt-top-tools:empty+.mdt-top-divider{display:none}
.mdt-brand{display:grid;place-items:center;flex:none;inline-size:34px;block-size:34px;border-radius:10px;color:#fff;background:linear-gradient(135deg,var(--mdt-ui-accent),color-mix(in srgb,var(--mdt-ui-accent) 55%,#c026d3));box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 2px 6px -1px color-mix(in srgb,var(--mdt-ui-accent) 45%,transparent)}
.mdt-title-block{display:grid;min-inline-size:0;line-height:1.25}
.mdt-title{font-size:14.5px;font-weight:650;letter-spacing:-.01em;color:var(--mdt-ui-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-subtitle{font-size:11.5px;color:var(--mdt-ui-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-divider{inline-size:1px;block-size:22px;background:var(--mdt-ui-line);margin-inline:6px;flex:none}

/* Buttons */
.mdt-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-block-size:34px;max-inline-size:100%;padding:0 13px;border:1px solid var(--mdt-ui-line-2);border-radius:var(--mdt-ui-r-sm);background:var(--mdt-ui-bg);color:var(--mdt-ui-text);box-shadow:var(--mdt-ui-shadow-1);font:inherit;font-size:13px;font-weight:550;line-height:1.2;letter-spacing:normal;text-transform:none;text-decoration:none;white-space:nowrap;cursor:pointer;user-select:none;transition:background-color .12s,border-color .12s,color .12s,box-shadow .12s,opacity .12s}
.mdt-btn:hover:not(:disabled){background:var(--mdt-ui-bg-2);border-color:var(--mdt-ui-line-2)}
.mdt-btn:active:not(:disabled){background:var(--mdt-ui-bg-3)}
.mdt-btn:disabled{opacity:.42;cursor:not-allowed;box-shadow:none}
.mdt-btn-label{overflow:hidden;text-overflow:ellipsis}
.mdt-btn-primary{background:var(--mdt-ui-accent);border-color:var(--mdt-ui-accent);color:var(--mdt-ui-on-accent);box-shadow:0 1px 2px rgba(16,24,40,.12),inset 0 1px 0 rgba(255,255,255,.16)}
.mdt-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--mdt-ui-accent) 88%,#000);border-color:color-mix(in srgb,var(--mdt-ui-accent) 88%,#000)}
.mdt-btn-primary:active:not(:disabled){background:color-mix(in srgb,var(--mdt-ui-accent) 80%,#000)}
.mdt-btn-soft{background:var(--mdt-ui-accent-soft);border-color:transparent;color:var(--mdt-ui-accent-ink);box-shadow:none}
.mdt-btn-soft:hover:not(:disabled){background:color-mix(in srgb,var(--mdt-ui-accent) 17%,transparent);border-color:transparent}
.mdt-btn-ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--mdt-ui-text-2)}
.mdt-btn-ghost:hover:not(:disabled){background:var(--mdt-ui-hover);border-color:transparent;color:var(--mdt-ui-text)}
.mdt-btn-ghost:active:not(:disabled){background:var(--mdt-ui-active)}
.mdt-btn-danger{color:var(--mdt-ui-danger)}
.mdt-btn-danger:hover:not(:disabled){background:var(--mdt-ui-danger-soft);color:var(--mdt-ui-danger)}
.mdt-btn-block{inline-size:100%}
.mdt-btn-sm{min-block-size:28px;padding:0 9px;font-size:12px;gap:5px}
.mdt-icon-btn{inline-size:34px;padding:0}
.mdt-icon-btn.mdt-btn-sm{inline-size:28px}
.mdt-btn[aria-pressed=true]{background:var(--mdt-ui-accent-soft);border-color:transparent;color:var(--mdt-ui-accent-ink)}
.mdt-btn-row{display:flex;flex-wrap:wrap;gap:8px}
.mdt-btn-row>.mdt-btn{flex:1 1 0;min-inline-size:max-content}

/* Body layout */
.mdt-body{position:relative;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;min-block-size:0}
.mdt-rail{grid-column:1}.mdt-left{grid-column:2}.mdt-stage{grid-column:3}.mdt-right{grid-column:4}
.mdt-shell[dir=rtl] .mdt-icon-dir{transform:scaleX(-1)}
.mdt-rail{display:flex;flex-direction:column;gap:4px;inline-size:72px;padding:10px 8px;background:var(--mdt-ui-bg);border-inline-end:1px solid var(--mdt-ui-line);min-block-size:0;overflow:auto;scrollbar-width:none}
.mdt-rail:empty{display:none}
.mdt-rail-spacer{flex:1}
.mdt-rail-item{appearance:none;display:grid;justify-items:center;align-content:center;gap:5px;min-block-size:58px;padding:7px 2px;border:0;border-radius:10px;background:transparent;color:var(--mdt-ui-text-2);font:inherit;font-size:10.5px;font-weight:600;line-height:1.15;text-align:center;cursor:pointer;transition:background-color .12s,color .12s}
.mdt-rail-item:hover{background:var(--mdt-ui-hover);color:var(--mdt-ui-text)}
.mdt-rail-item[aria-pressed=true]{background:var(--mdt-ui-accent-soft);color:var(--mdt-ui-accent-ink)}
.mdt-rail-item .mdt-icon{inline-size:22px;block-size:22px}
.mdt-rail-mobile{display:none}
.mdt-left,.mdt-right{min-block-size:0;overflow:auto;background:var(--mdt-ui-bg);scrollbar-width:thin;scrollbar-color:var(--mdt-ui-line-2) transparent;overscroll-behavior:contain}
.mdt-left{inline-size:288px;border-inline-end:1px solid var(--mdt-ui-line)}
.mdt-right{inline-size:300px;border-inline-start:1px solid var(--mdt-ui-line);display:flex;flex-direction:column}
.mdt-left:empty,.mdt-right:empty{display:none}
.mdt-shell[data-mdt-left=closed] .mdt-left{display:none}
.mdt-shell[data-mdt-layout=medium] .mdt-left{position:absolute;z-index:5;inset-block:0;inset-inline-start:var(--mdt-ui-rail);box-shadow:var(--mdt-ui-shadow-2)}

/* Stage */
.mdt-stage{position:relative;min-inline-size:0;min-block-size:0;overflow:hidden;background-color:var(--mdt-ui-stage);background-image:radial-gradient(var(--mdt-ui-dot) 1px,transparent 1.3px);background-size:20px 20px;touch-action:none;user-select:none;-webkit-user-select:none}
.mdt-artboard{position:absolute;inset-block-start:0;left:0;transform-origin:0 0;background:#fff;box-shadow:var(--mdt-ui-artboard-shadow);border-radius:2px;pointer-events:none}
.mdt-canvas{position:absolute;inset:0;inline-size:100%;block-size:100%;display:block;touch-action:none}
.mdt-canvas:focus-visible{outline:2px solid var(--mdt-ui-accent);outline-offset:-2px}
.mdt-overlay{position:absolute;inset:0;inline-size:100%;block-size:100%;overflow:visible;pointer-events:none}
.mdt-labels,.mdt-floating{position:absolute;inset:0;pointer-events:none}
.mdt-floating{z-index:2}
.mdt-floating>*{pointer-events:auto}
.mdt-progress{position:absolute;z-index:3;inset-inline:0;inset-block-start:0;block-size:2px;overflow:hidden;opacity:0;transition:opacity .2s;pointer-events:none}
.mdt-progress::after{content:"";position:absolute;inset-block:0;inline-size:40%;background:var(--mdt-ui-accent);border-radius:2px;animation:mdt-progress 1.1s ease-in-out infinite}
.mdt-shell[aria-busy=true] .mdt-progress{opacity:1}
@keyframes mdt-progress{from{transform:translateX(-100%)}to{transform:translateX(260%)}}

/* Overlay */
.mdt-ov-area{fill:none;stroke:rgba(102,112,133,.9);stroke-width:1;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}
.mdt-ov-area[data-active=true]{stroke:var(--mdt-ui-accent);stroke-width:1.5;stroke-dasharray:6 4}
.mdt-ov-hit{fill:transparent;stroke:none;pointer-events:none}
.mdt-ov-safe{fill:none;stroke:var(--mdt-ui-accent);stroke-opacity:.5;stroke-width:1;stroke-dasharray:2 3}
.mdt-ov-bleed{fill:none;stroke:#f04438;stroke-opacity:.7;stroke-width:1;stroke-dasharray:4 3}
.mdt-ov-halo{fill:none;stroke:#fff;stroke-opacity:.85;stroke-width:3.5;stroke-linejoin:round}
.mdt-ov-line{fill:none;stroke:var(--mdt-ui-accent);stroke-width:1.5;stroke-linejoin:round}
.mdt-ov-hover{fill:none;stroke:var(--mdt-ui-accent);stroke-width:1.5;stroke-opacity:.75}
.mdt-ov-handle{fill:#fff;stroke:var(--mdt-ui-accent);stroke-width:1.5;filter:drop-shadow(0 1px 1.5px rgba(16,24,40,.3))}
.mdt-ov-grip{fill:transparent;stroke:none;pointer-events:all;touch-action:none}
.mdt-ov-stem{stroke:var(--mdt-ui-accent);stroke-width:1.5}
.mdt-ov-rotate{fill:var(--mdt-ui-accent);stroke:#fff;stroke-width:2}
.mdt-ov-guide{stroke:var(--mdt-ui-guide);stroke-width:1}
.mdt-ov-mask{fill:rgba(16,24,40,.28);fill-rule:evenodd}
.mdt-area-tag{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:6px;max-inline-size:240px;padding:3px 8px;border-radius:6px;background:var(--mdt-ui-float);color:var(--mdt-ui-text-2);box-shadow:var(--mdt-ui-shadow-1);font-size:11px;font-weight:600;white-space:nowrap;transform:translateY(calc(-100% - 6px));pointer-events:none}
.mdt-area-tag[data-active=true]{background:var(--mdt-ui-accent);color:var(--mdt-ui-on-accent)}
.mdt-area-tag span{opacity:.75;font-weight:500;font-variant-numeric:tabular-nums}
.mdt-readout{position:absolute;left:0;top:0;padding:4px 8px;border-radius:6px;background:var(--mdt-ui-tip);color:#fff;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;transform:translate(14px,14px)}

/* Floating stage controls */
.mdt-float{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;background:var(--mdt-ui-float);border:1px solid var(--mdt-ui-line);border-radius:12px;box-shadow:var(--mdt-ui-shadow-2);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.mdt-float .mdt-btn{min-block-size:32px}
.mdt-float .mdt-icon-btn{inline-size:32px}
.mdt-float .mdt-divider{block-size:18px;margin-inline:3px}
.mdt-tools{inset-block-start:12px;inset-inline-start:12px;flex-direction:column}
.mdt-tools .mdt-divider{inline-size:18px;block-size:1px;margin:3px 0}
.mdt-zoom{inset-block-end:12px;inset-inline-end:12px}
.mdt-zoom-value{min-inline-size:54px;padding:0 6px!important;font-size:12px!important;font-variant-numeric:tabular-nums;color:var(--mdt-ui-text-2)}
.mdt-views{inset-block-end:12px;left:50%;transform:translateX(-50%);gap:4px;padding:5px;max-inline-size:calc(100% - 220px);overflow-x:auto;scrollbar-width:none}
.mdt-view-thumb{appearance:none;display:grid;justify-items:center;gap:3px;padding:4px 4px 3px;border:0;border-radius:9px;background:transparent;color:var(--mdt-ui-text-2);font:inherit;font-size:10.5px;font-weight:600;cursor:pointer;min-inline-size:58px}
.mdt-view-thumb:hover{background:var(--mdt-ui-hover)}
.mdt-view-thumb canvas,.mdt-view-thumb img{inline-size:48px;block-size:40px;border-radius:6px;background:var(--mdt-ui-bg-3);box-shadow:inset 0 0 0 1px var(--mdt-ui-line);object-fit:contain}
.mdt-view-thumb[aria-pressed=true]{color:var(--mdt-ui-accent-ink)}
.mdt-view-thumb[aria-pressed=true] canvas{box-shadow:0 0 0 2px var(--mdt-ui-accent)}
.mdt-selbar{left:0;top:0;transform:translate(-50%,-100%);gap:1px;z-index:1;white-space:nowrap}
.mdt-selbar[data-below=true]{transform:translate(-50%,0)}
.mdt-banner{inset-block-start:12px;left:50%;transform:translateX(-50%);gap:10px;padding:5px 5px 5px 12px;font-size:12.5px;color:var(--mdt-ui-text-2);max-inline-size:calc(100% - 120px)}
.mdt-banner>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdt-dropveil{position:absolute;inset:10px;z-index:4;display:grid;place-items:center;align-content:center;gap:10px;border:2px dashed var(--mdt-ui-accent);border-radius:16px;background:color-mix(in srgb,var(--mdt-ui-accent) 9%,transparent);color:var(--mdt-ui-accent-ink);font-size:14px;font-weight:650;pointer-events:none}
.mdt-view3d{position:absolute;inset:0;z-index:1;background:radial-gradient(120% 90% at 50% 38%,color-mix(in srgb,var(--mdt-ui-bg) 70%,transparent),transparent 70%)}
.mdt-view3d-canvas{position:absolute;inset:0;inline-size:100%;block-size:100%;display:block;touch-action:none;cursor:grab}
.mdt-view3d-canvas:active{cursor:grabbing}
.mdt-view3d-canvas:focus-visible{outline:2px solid var(--mdt-ui-accent);outline-offset:-2px}
.mdt-view3d-bar{inset-block-end:12px;inset-inline-end:12px}
.mdt-view3d-soft{inset-block-end:62px;inset-inline-end:12px;display:flex;align-items:center;gap:8px;padding:6px 12px;inline-size:min(260px,calc(100% - 24px))}
.mdt-view3d-soft .mdt-range{flex:1;min-inline-size:0}
.mdt-view3d-soft-label{font-size:11px;font-weight:600;color:var(--mdt-ui-text-3);white-space:nowrap}
.mdt-view3d-canvas[data-mdt-tool=pull]{cursor:grab}
.mdt-view3d-canvas[data-mdt-tool=pull]:active{cursor:grabbing}
.mdt-view3d-hint{position:absolute;inset-block-start:12px;left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--mdt-ui-float);border:1px solid var(--mdt-ui-line);box-shadow:var(--mdt-ui-shadow-1);color:var(--mdt-ui-text-2);font-size:11.5px;font-weight:550;white-space:nowrap;pointer-events:none}
.mdt-view3d-state{position:absolute;inset:0;display:grid;place-items:center;padding:24px;pointer-events:none}
.mdt-view3d-state:empty{display:none}
.mdt-view3d-card{display:grid;justify-items:center;gap:12px;max-inline-size:340px;padding:24px;border-radius:18px;background:var(--mdt-ui-bg);box-shadow:var(--mdt-ui-shadow-2);text-align:center;font-size:12.5px;color:var(--mdt-ui-text-2);pointer-events:auto}
.mdt-view3d-card[data-busy=true] .mdt-empty-icon{animation:mdt-spin 1.6s linear infinite}
@keyframes mdt-spin{to{transform:rotate(360deg)}}
.mdt-shell[data-mdt-view="3d"] :is(.mdt-canvas,.mdt-overlay,.mdt-labels,.mdt-artboard,.mdt-tools,.mdt-zoom,.mdt-selbar){display:none!important}
.mdt-view-icon{display:grid;place-items:center;inline-size:48px;block-size:40px;border-radius:6px;background:linear-gradient(135deg,var(--mdt-ui-accent-soft),color-mix(in srgb,#c026d3 14%,transparent));color:var(--mdt-ui-accent-ink);box-shadow:inset 0 0 0 1px var(--mdt-ui-line)}
.mdt-view-thumb[aria-pressed=true] .mdt-view-icon{box-shadow:0 0 0 2px var(--mdt-ui-accent)}
.mdt-stage-empty{position:absolute;inset:0;z-index:1;display:grid;place-items:center;padding:24px;pointer-events:none}
.mdt-stage-empty>*{pointer-events:auto}
.mdt-empty-card{display:grid;justify-items:center;gap:12px;max-inline-size:360px;padding:28px 28px 24px;border-radius:18px;background:var(--mdt-ui-bg);box-shadow:var(--mdt-ui-shadow-2);text-align:center}
.mdt-empty-card h3{font-size:16px;font-weight:650;letter-spacing:-.01em}
.mdt-empty-card p{color:var(--mdt-ui-text-3);font-size:12.5px}
.mdt-empty-icon{display:grid;place-items:center;inline-size:52px;block-size:52px;border-radius:14px;background:var(--mdt-ui-accent-soft);color:var(--mdt-ui-accent)}

/* Panels */
.mdt-panel-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;min-block-size:52px;padding:12px 16px 8px;background:var(--mdt-ui-bg)}
.mdt-panel-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650;letter-spacing:-.01em}
.mdt-panel-body{display:grid;gap:0;padding-block-end:12px}
.mdt-panel-foot{position:sticky;bottom:0;z-index:2;display:flex;gap:8px;padding:12px 16px;margin-block-start:auto;background:var(--mdt-ui-bg);border-block-start:1px solid var(--mdt-ui-line)}
.mdt-panel-foot>.mdt-btn{flex:1 1 auto;min-inline-size:0}
.mdt-panel-foot>.mdt-btn:first-child{flex:0 0 auto}
.mdt-section{display:grid;gap:10px;padding:14px 16px;border-block-start:1px solid var(--mdt-ui-line)}
.mdt-section:first-child,.mdt-panel-head+.mdt-section,.mdt-panel-head+.mdt-panel-body>.mdt-section:first-child{border-block-start:0}
.mdt-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;min-block-size:20px;font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--mdt-ui-text-3)}
.mdt-section-title .mdt-btn{text-transform:none;letter-spacing:normal}
.mdt-lead{font-size:12.5px;line-height:1.55;color:var(--mdt-ui-text-3)}
.mdt-hint{font-size:11.5px;line-height:1.5;color:var(--mdt-ui-text-3)}
.mdt-row{display:flex;align-items:center;gap:8px;min-inline-size:0}
.mdt-row-between{display:flex;align-items:center;justify-content:space-between;gap:8px;min-inline-size:0}
.mdt-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:end;gap:8px}
.mdt-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.mdt-grid-6{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px;padding:3px;background:var(--mdt-ui-bg-2);border-radius:9px}
.mdt-grid-6 .mdt-btn{inline-size:auto;min-block-size:32px}

/* Inputs */
.mdt-field{display:grid;gap:6px;min-inline-size:0}
.mdt-field-label{display:grid;gap:6px;min-inline-size:0}
.mdt-label{font-size:12px;font-weight:550;color:var(--mdt-ui-text-2)}
.mdt-input{appearance:none;inline-size:100%;min-inline-size:0;min-block-size:34px;padding:0 10px;border:1px solid var(--mdt-ui-line-2);border-radius:var(--mdt-ui-r-sm);background:var(--mdt-ui-bg);color:var(--mdt-ui-text);font:inherit;font-size:13px;line-height:1.3;letter-spacing:normal;transition:border-color .12s,box-shadow .12s}
.mdt-input:hover{border-color:color-mix(in srgb,var(--mdt-ui-line-2) 60%,var(--mdt-ui-text-3))}
.mdt-input:focus{border-color:var(--mdt-ui-accent);box-shadow:0 0 0 3px var(--mdt-ui-accent-soft);outline:none}
.mdt-title-input{appearance:none;min-inline-size:60px;inline-size:100%;max-inline-size:300px;padding:4px 8px;margin-inline-start:-8px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--mdt-ui-text);font:inherit;font-size:14.5px;font-weight:650;letter-spacing:-.01em;text-overflow:ellipsis}
.mdt-title-input:hover{border-color:var(--mdt-ui-line-2)}
.mdt-title-input:focus{border-color:var(--mdt-ui-accent);background:var(--mdt-ui-bg);box-shadow:0 0 0 3px var(--mdt-ui-accent-soft);outline:none}
.mdt-num{display:flex;align-items:center;min-inline-size:0;min-block-size:32px;border:1px solid transparent;border-radius:var(--mdt-ui-r-sm);background:var(--mdt-ui-bg-2);transition:border-color .12s,box-shadow .12s,background-color .12s}
.mdt-num:hover{border-color:var(--mdt-ui-line-2)}
.mdt-num:focus-within{border-color:var(--mdt-ui-accent);background:var(--mdt-ui-bg);box-shadow:0 0 0 3px var(--mdt-ui-accent-soft)}
.mdt-num[data-disabled=true]{opacity:.5}
.mdt-num-label{display:flex;align-items:center;justify-content:center;flex:none;align-self:stretch;min-inline-size:28px;padding-inline:8px 2px;color:var(--mdt-ui-text-3);font-size:11.5px;font-weight:650;cursor:ew-resize;touch-action:none;user-select:none}
.mdt-num[data-disabled=true] .mdt-num-label{cursor:default}
.mdt-num input{appearance:textfield;-moz-appearance:textfield;flex:1;inline-size:100%;min-inline-size:0;block-size:30px;padding:0 6px;border:0;background:transparent;color:var(--mdt-ui-text);font:inherit;font-size:12.5px;font-variant-numeric:tabular-nums;outline:none}
.mdt-num input::-webkit-inner-spin-button,.mdt-num input::-webkit-outer-spin-button{appearance:none;margin:0}
.mdt-num-unit{flex:none;padding-inline-end:9px;color:var(--mdt-ui-text-3);font-size:11.5px}
.mdt-range{appearance:none;-webkit-appearance:none;display:block;inline-size:100%;block-size:22px;margin:0;background:transparent;cursor:pointer;--mdt-ui-fill:50%}
.mdt-range::-webkit-slider-runnable-track{block-size:4px;border-radius:4px;background:linear-gradient(to right,var(--mdt-ui-accent) var(--mdt-ui-fill),var(--mdt-ui-bg-3) var(--mdt-ui-fill))}
.mdt-shell[dir=rtl] .mdt-range::-webkit-slider-runnable-track{background:linear-gradient(to left,var(--mdt-ui-accent) var(--mdt-ui-fill),var(--mdt-ui-bg-3) var(--mdt-ui-fill))}
.mdt-range::-webkit-slider-thumb{-webkit-appearance:none;inline-size:16px;block-size:16px;margin-block-start:-6px;border-radius:50%;background:#fff;border:2px solid var(--mdt-ui-accent);box-shadow:0 1px 3px rgba(16,24,40,.25)}
.mdt-range::-moz-range-track{block-size:4px;border-radius:4px;background:var(--mdt-ui-bg-3)}
.mdt-range::-moz-range-progress{block-size:4px;border-radius:4px;background:var(--mdt-ui-accent)}
.mdt-range::-moz-range-thumb{inline-size:12px;block-size:12px;border-radius:50%;background:#fff;border:2px solid var(--mdt-ui-accent)}
.mdt-range:disabled{opacity:.45;cursor:not-allowed}
.mdt-range-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
.mdt-range-value{min-inline-size:4ch;text-align:end;font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;color:var(--mdt-ui-text-2)}
.mdt-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:4px 0;cursor:pointer}
.mdt-switch-text{display:grid;gap:2px;min-inline-size:0}
.mdt-switch-label{font-size:13px;font-weight:550}
.mdt-switch{appearance:none;position:relative;flex:none;inline-size:36px;block-size:20px;margin:0;border-radius:20px;background:var(--mdt-ui-line-2);cursor:pointer;transition:background-color .15s}
.mdt-switch::after{content:"";position:absolute;inset-block-start:2px;inset-inline-start:2px;inline-size:16px;block-size:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.25);transition:transform .15s}
.mdt-switch:checked{background:var(--mdt-ui-accent)}
.mdt-switch:checked::after{transform:translateX(16px)}
.mdt-shell[dir=rtl] .mdt-switch:checked::after{transform:translateX(-16px)}
.mdt-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--mdt-ui-bg-3);min-inline-size:0;max-inline-size:100%;overflow-x:auto;scrollbar-width:none}
.mdt-seg>button{appearance:none;flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-block-size:30px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--mdt-ui-text-2);font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background-color .12s,color .12s,box-shadow .12s}
.mdt-seg>button:hover{color:var(--mdt-ui-text)}
.mdt-seg>button[aria-pressed=true]{background:var(--mdt-ui-bg);color:var(--mdt-ui-text);box-shadow:0 1px 3px rgba(16,24,40,.1),0 0 0 1px rgba(16,24,40,.03)}
.mdt-seg>button:disabled{opacity:.45;cursor:not-allowed}
.mdt-seg-dot{inline-size:6px;block-size:6px;border-radius:50%;background:var(--mdt-ui-danger)}
.mdt-seg-ok{color:var(--mdt-ui-ok)}

/* Status, chips, callouts */
.mdt-chip{display:inline-flex;align-items:center;gap:5px;flex:none;block-size:22px;padding:0 8px;border-radius:999px;background:var(--mdt-ui-bg-3);color:var(--mdt-ui-text-2);font-size:11px;font-weight:600;white-space:nowrap}
.mdt-chip[data-tone=ok]{background:var(--mdt-ui-ok-soft);color:var(--mdt-ui-ok)}
.mdt-chip[data-tone=warn]{background:var(--mdt-ui-warn-soft);color:var(--mdt-ui-warn)}
.mdt-chip[data-tone=danger]{background:var(--mdt-ui-danger-soft);color:var(--mdt-ui-danger)}
.mdt-chip[data-tone=accent]{background:var(--mdt-ui-accent-soft);color:var(--mdt-ui-accent-ink)}
.mdt-chip-dot::before{content:"";inline-size:6px;block-size:6px;border-radius:50%;background:currentColor}
.mdt-callout{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border-radius:10px;background:var(--mdt-ui-bg-2);color:var(--mdt-ui-text-2);font-size:12px;line-height:1.5}
.mdt-callout>.mdt-icon{margin-block-start:1px;color:var(--mdt-ui-text-3)}
.mdt-callout-body{display:grid;gap:8px;min-inline-size:0;overflow-wrap:anywhere}
.mdt-callout[data-tone=warn]{background:var(--mdt-ui-warn-soft);color:var(--mdt-ui-warn)}
.mdt-callout[data-tone=warn]>.mdt-icon{color:currentColor}
.mdt-callout[data-tone=danger]{background:var(--mdt-ui-danger-soft);color:var(--mdt-ui-danger)}
.mdt-callout[data-tone=danger]>.mdt-icon{color:currentColor}
.mdt-callout[data-tone=ok]{background:var(--mdt-ui-ok-soft);color:var(--mdt-ui-ok)}
.mdt-callout[data-tone=ok]>.mdt-icon{color:currentColor}
.mdt-meta{display:grid;gap:8px;font-size:12.5px}
.mdt-meta>div{display:flex;justify-content:space-between;gap:12px}
.mdt-meta dt{color:var(--mdt-ui-text-3)}
.mdt-meta dd{text-align:end;font-weight:550;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mdt-meter{block-size:6px;border-radius:6px;background:var(--mdt-ui-bg-3);overflow:hidden}
.mdt-meter>span{display:block;block-size:100%;inline-size:var(--mdt-ui-value,0%);border-radius:inherit;background:var(--mdt-ui-ok);transition:inline-size .2s}
.mdt-meter[data-tone=warn]>span{background:#f79009}
.mdt-card{display:grid;gap:10px;padding:12px;border:1px solid var(--mdt-ui-line);border-radius:12px;background:var(--mdt-ui-bg)}
.mdt-dropzone{appearance:none;display:grid;justify-items:center;gap:8px;inline-size:100%;padding:22px 16px 20px;border:1.5px dashed var(--mdt-ui-line-2);border-radius:14px;background:var(--mdt-ui-bg-2);color:var(--mdt-ui-text-3);font:inherit;font-size:12px;text-align:center;cursor:pointer;transition:border-color .12s,background-color .12s,color .12s}
.mdt-dropzone:hover:not(:disabled),.mdt-dropzone[data-over=true]{border-color:var(--mdt-ui-accent);background:var(--mdt-ui-accent-soft)}
.mdt-dropzone:disabled{opacity:.5;cursor:not-allowed}
.mdt-dropzone strong{color:var(--mdt-ui-text);font-size:13.5px;font-weight:650}
.mdt-dropzone-icon{display:grid;place-items:center;inline-size:46px;block-size:46px;margin-block-end:2px;border-radius:13px;background:var(--mdt-ui-bg);color:var(--mdt-ui-accent);box-shadow:var(--mdt-ui-shadow-1),0 0 0 1px var(--mdt-ui-line)}
.mdt-checker{background:var(--mdt-ui-checker)}

/* Status bar */
.mdt-statusbar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-block-size:30px;padding:0 12px;border-block-start:1px solid var(--mdt-ui-line);background:var(--mdt-ui-bg);color:var(--mdt-ui-text-3);font-size:11.5px}
.mdt-status{display:flex;align-items:center;gap:7px;min-inline-size:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mdt-status::before{content:"";flex:none;inline-size:6px;block-size:6px;border-radius:50%;background:var(--mdt-ui-ok)}
.mdt-status:empty::before{display:none}
.mdt-status[data-error=true]{color:var(--mdt-ui-danger);font-weight:550}
.mdt-status[data-error=true]::before{background:var(--mdt-ui-danger)}
.mdt-status-end{display:flex;align-items:center;gap:10px;flex:none;font-variant-numeric:tabular-nums}
.mdt-status-end .mdt-btn{min-block-size:24px}

/* Tooltip and dialog */
.mdt-tooltip{position:absolute;z-index:40;left:0;top:0;display:flex;align-items:center;gap:8px;max-inline-size:260px;padding:5px 8px;border-radius:7px;background:var(--mdt-ui-tip);color:#fff;font-size:11.5px;font-weight:550;line-height:1.35;box-shadow:var(--mdt-ui-shadow-2);pointer-events:none;opacity:0;transition:opacity .1s}
.mdt-tooltip[data-show=true]{opacity:1}
.mdt-kbd{padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.16);color:rgba(255,255,255,.85);font:inherit;font-size:10.5px;font-weight:600;white-space:nowrap}
.mdt-dialog-backdrop{position:absolute;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(16,24,40,.4);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);animation:mdt-fade .15s ease-out}
.mdt-dialog{display:flex;flex-direction:column;inline-size:min(540px,100%);max-block-size:100%;overflow:hidden;border:1px solid var(--mdt-ui-line);border-radius:16px;background:var(--mdt-ui-bg);box-shadow:var(--mdt-ui-shadow-3);animation:mdt-pop .18s ease-out}
.mdt-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 14px 14px 18px;border-block-end:1px solid var(--mdt-ui-line)}
.mdt-dialog-head h2{font-size:15px;font-weight:650}
.mdt-dialog-body{overflow:auto;padding:16px 18px 18px}
.mdt-shortcuts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px 18px;align-items:center;font-size:12.5px}
.mdt-shortcuts dt{color:var(--mdt-ui-text-2)}
.mdt-shortcuts dd{display:flex;gap:4px;justify-content:flex-end}
.mdt-shortcut-groups{display:grid;gap:10px}
.mdt-shortcut-title{margin-block-start:6px!important;font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--mdt-ui-text-3)}
.mdt-key{display:inline-block;min-inline-size:22px;padding:2px 6px;border:1px solid var(--mdt-ui-line-2);border-block-end-width:2px;border-radius:5px;background:var(--mdt-ui-bg-2);color:var(--mdt-ui-text);font:inherit;font-size:11px;font-weight:600;text-align:center}
@keyframes mdt-fade{from{opacity:0}}
@keyframes mdt-pop{from{opacity:0;transform:translateY(6px) scale(.98)}}

/* Responsive embedding */
.mdt-shell[data-mdt-layout=narrow]{grid-template-rows:auto auto auto;block-size:auto;min-block-size:0}
.mdt-shell[data-mdt-layout=narrow] .mdt-topbar{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"start tools" "center center" "actions actions";gap:8px 6px;padding:8px 10px}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-start{grid-area:start}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-center{grid-area:center;justify-content:flex-start}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-end{display:contents}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-tools{grid-area:tools}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-divider{display:none}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-actions{grid-area:actions}
.mdt-shell[data-mdt-layout=narrow] .mdt-top-actions>.mdt-btn{flex:1 1 0}
.mdt-shell[data-mdt-layout=narrow] .mdt-body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto}
.mdt-shell[data-mdt-layout=narrow] .mdt-body>*{grid-column:1}
.mdt-shell[data-mdt-layout=narrow] .mdt-stage{grid-row:1;block-size:var(--mdt-mobile-stage-height,min(68vh,460px));min-block-size:300px}
.mdt-shell[data-mdt-layout=narrow] .mdt-rail{grid-row:2;flex-direction:row;inline-size:auto;padding:6px;gap:4px;border-inline-end:0;border-block:1px solid var(--mdt-ui-line);overflow-x:auto}
.mdt-shell[data-mdt-layout=narrow] .mdt-rail-item{flex:1 0 64px;min-block-size:50px}
.mdt-shell[data-mdt-layout=narrow] .mdt-rail-mobile{display:grid}
.mdt-shell[data-mdt-layout=narrow] .mdt-rail-spacer,.mdt-shell[data-mdt-layout=narrow] .mdt-rail-desktop{display:none}
.mdt-shell[data-mdt-layout=narrow] .mdt-left,.mdt-shell[data-mdt-layout=narrow] .mdt-right{inline-size:auto;overflow:visible;border:0}
.mdt-shell[data-mdt-layout=narrow] .mdt-left{grid-row:3;display:block}
.mdt-shell[data-mdt-layout=narrow] .mdt-right{grid-row:4;border-block-start:1px solid var(--mdt-ui-line)}
.mdt-shell[data-mdt-layout=narrow] .mdt-panel-head,.mdt-shell[data-mdt-layout=narrow] .mdt-panel-foot{position:static}
.mdt-shell[data-mdt-layout=narrow] .mdt-views{max-inline-size:calc(100% - 24px);inset-block-end:58px}
.mdt-shell[data-mdt-layout=narrow] .mdt-statusbar{flex-wrap:wrap;gap:4px 12px;padding-block:6px}
.mdt-shell[data-mdt-layout=narrow] .mdt-status{white-space:normal}
.mdt-shell[data-mdt-layout=narrow] .mdt-hide-narrow{display:none!important}
.mdt-shell[data-mdt-layout=narrow] .mdt-banner{max-inline-size:calc(100% - 24px)}
@media (pointer:coarse){.mdt-btn{min-block-size:44px}.mdt-icon-btn{inline-size:44px}.mdt-float .mdt-btn{min-block-size:40px}.mdt-float .mdt-icon-btn{inline-size:40px}.mdt-num{min-block-size:44px}.mdt-num input,.mdt-input{min-block-size:42px;font-size:16px}.mdt-seg>button{min-block-size:40px}.mdt-range{block-size:32px}}
@media (prefers-reduced-motion:reduce){.mdt-shell *,.mdt-shell *::before,.mdt-shell *::after{animation:none!important;transition:none!important}}
@media (forced-colors:active){.mdt-ov-line,.mdt-ov-area[data-active=true],.mdt-ov-handle{stroke:Highlight}.mdt-btn[aria-pressed=true],.mdt-seg>button[aria-pressed=true]{outline:2px solid Highlight}}
`;

const FOCUSABLE = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex]:not([tabindex="-1"])';

export function createUI(container: HTMLElement, kind: 'admin' | 'customer', options: EditorOptions = {}, extraStyles = ''): UIShell {
  let locale = options.locale || 'en';
  try { new Intl.NumberFormat(locale); } catch { locale = 'en'; }
  const formatters = new Map<number, Intl.NumberFormat>();
  const format = (value: number, digits = 2) => {
    let formatter = formatters.get(digits);
    if (!formatter) { formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }); formatters.set(digits, formatter); }
    return formatter.format(value);
  };
  // Text values are bidi-isolated (FSI…PDI) so a Latin name inside a Persian sentence, or the reverse, cannot reorder its neighbours.
  const interpolate = (message: string, vars: Record<string, string | number>) => {
    for (const [name, value] of Object.entries(vars)) message = message.split(`{${name}}`).join(typeof value === 'number' ? format(value) : `\u2068${value}\u2069`);
    return message;
  };
  const t = (key: string, fallback = key, vars: Record<string, string | number> = {}) => interpolate(options.messages?.[key] ?? fallback, vars);
  const pluralRules = new Intl.PluralRules(locale);
  const plural = (key: string, count: number, forms: { one: string; other: string }, vars: Record<string, string | number> = {}) => {
    const category = pluralRules.select(count);
    const message = options.messages?.[`${key}.${category}`] ?? options.messages?.[`${key}.other`] ?? (category === 'one' ? forms.one : forms.other);
    return interpolate(message, { count, ...vars });
  };
  let lists: Intl.ListFormat | null = null;
  try { lists = new Intl.ListFormat(locale, { type: 'conjunction' }); } catch { /* older engines join with commas */ }
  const list = (items: string[]) => lists ? lists.format(items) : items.join(', ');
  const errorText = (error: unknown) => error instanceof EditorError
    ? error.localized ? error.message : t(`errors.${error.code}`, error.message)
    : t('errors.operation', error instanceof Error ? error.message : String(error));
  const events = new AbortController();
  const signal = events.signal;
  const element = document.createElement(`mdt-${kind}`);
  const root = element.attachShadow({ mode: 'open' });
  const style = node('style');
  style.textContent = styles + extraStyles;
  const shell = node('section', `mdt-shell mdt-${kind}`);
  shell.lang = locale; shell.dir = options.direction === 'rtl' ? 'rtl' : 'ltr';
  shell.dataset.mdtTheme = options.theme ?? 'light';
  shell.setAttribute('aria-label', kind === 'admin' ? t('shell.adminLabel', 'Product template builder') : t('shell.customerLabel', 'Product customizer'));

  const topbar = node('header', 'mdt-topbar');
  const topStart = node('div', 'mdt-top-start'), topCenter = node('div', 'mdt-top-center'), topEnd = node('div', 'mdt-top-end');
  const topTools = node('div', 'mdt-top-tools'), topActions = node('div', 'mdt-top-actions');
  topEnd.append(topTools, node('span', 'mdt-divider mdt-top-divider'), topActions);
  topbar.append(topStart, topCenter, topEnd);
  const body = node('div', 'mdt-body');
  const rail = node('nav', 'mdt-rail');
  const left = node('aside', 'mdt-left');
  const stage = node('div', 'mdt-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', t('shell.stage', 'Design canvas'));
  const artboard = node('div', 'mdt-artboard');
  const canvas = node('canvas', 'mdt-canvas');
  canvas.width = 1; canvas.height = 1;
  canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', t('shell.canvas', 'Product preview. Use the adjacent controls to edit artwork.'));
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('class', 'mdt-overlay'); overlay.setAttribute('aria-hidden', 'true');
  const labels = node('div', 'mdt-labels'); labels.setAttribute('aria-hidden', 'true');
  const floating = node('div', 'mdt-floating');
  const progress = node('div', 'mdt-progress'); progress.setAttribute('aria-hidden', 'true');
  stage.append(artboard, canvas, overlay, labels, floating, progress);
  const right = node('aside', 'mdt-right');
  body.append(rail, left, stage, right);
  const statusbar = node('footer', 'mdt-statusbar');
  const status = node('p', 'mdt-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const statusEnd = node('div', 'mdt-status-end');
  statusbar.append(status, statusEnd);
  const tooltip = node('div', 'mdt-tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  shell.append(topbar, body, statusbar, tooltip);
  root.append(style, shell);

  // Tooltips: one per instance, positioned inside the component so nothing is portaled to the host page.
  let tipTarget: HTMLElement | null = null;
  let tipTimer = 0;
  const hideTip = () => { clearTimeout(tipTimer); tipTarget = null; tooltip.dataset.show = 'false'; };
  const showTip = (target: HTMLElement) => {
    const text = target.dataset.mdtTip;
    if (!text || (target as HTMLButtonElement).disabled && !target.dataset.mdtTipDisabled) { hideTip(); return; }
    tipTarget = target;
    tooltip.replaceChildren(node('span', '', text));
    if (target.dataset.mdtKbd) tooltip.append(node('kbd', 'mdt-kbd', target.dataset.mdtKbd));
    const host = shell.getBoundingClientRect(), rect = target.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const side = target.dataset.mdtTipSide ?? (rect.top - host.top > host.height * .6 ? 'top' : 'bottom');
    let x = rect.left - host.left + rect.width / 2 - tip.width / 2;
    let y = side === 'top' ? rect.top - host.top - tip.height - 8 : rect.bottom - host.top + 8;
    if (side === 'end') {
      const rtl = shell.dir === 'rtl';
      x = rtl ? rect.left - host.left - tip.width - 8 : rect.right - host.left + 8;
      y = rect.top - host.top + rect.height / 2 - tip.height / 2;
    }
    x = Math.max(6, Math.min(host.width - tip.width - 6, x));
    y = Math.max(6, Math.min(host.height - tip.height - 6, y));
    tooltip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    tooltip.dataset.show = 'true';
  };
  shell.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const target = (event.target as Element).closest<HTMLElement>('[data-mdt-tip]');
    if (target === tipTarget) return;
    hideTip();
    if (target) tipTimer = window.setTimeout(() => showTip(target), 380);
  }, { signal });
  shell.addEventListener('pointerout', event => { if (tipTarget && !tipTarget.contains(event.relatedTarget as Node)) hideTip(); else if (!tipTarget) clearTimeout(tipTimer); }, { signal });
  shell.addEventListener('focusin', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-mdt-tip]');
    hideTip();
    if (target && target.matches(':focus-visible')) showTip(target);
  }, { signal });
  shell.addEventListener('focusout', hideTip, { signal });
  shell.addEventListener('pointerdown', hideTip, { signal });
  shell.addEventListener('keydown', event => { if (event.key === 'Escape' && tooltip.dataset.show === 'true') hideTip(); }, { signal, capture: true });

  // Layout follows the component's own width, not the browser window.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const layoutListeners: Array<(layout: Layout) => void> = [];
  let layout: Layout = 'wide';
  const measure = (width: number) => {
    const next: Layout = width < 760 ? 'narrow' : width < 1120 ? 'medium' : 'wide';
    if (next === layout && shell.dataset.mdtLayout) return;
    layout = next; shell.dataset.mdtLayout = next; hideTip();
    for (const listener of layoutListeners) listener(next);
  };
  container.append(element);
  measure(element.getBoundingClientRect().width || container.getBoundingClientRect().width || 1200);
  const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width) measure(width); });
  observer.observe(element);

  let closeDialog: (() => void) | null = null;
  const ui: UIShell = {
    element, root, shell, topStart, topCenter, topEnd, topTools, topActions, rail, left, right, stage, canvas, artboard, overlay, floating, labels, status, statusEnd,
    get layout() { return layout; },
    coarse,
    t, plural, list, errorText, format,
    keys: {
      mod: isMac() ? '⌘' : `${t('key.ctrl', 'Ctrl')}+`,
      redo: isMac() ? '⇧⌘Z' : `${t('key.ctrl', 'Ctrl')}+Y`,
      shift: t('key.shift', 'Shift'), alt: t('key.alt', 'Alt'), space: t('key.space', 'Space'), esc: t('key.esc', 'Esc'), del: t('key.delete', 'Del'),
    },
    setStatus(message, error = false) {
      status.textContent = message;
      status.dataset.error = String(error);
      status.setAttribute('role', error ? 'alert' : 'status');
    },
    setTheme(theme) { shell.dataset.mdtTheme = theme === 'dark' || theme === 'auto' ? theme : 'light'; },
    setBusy(busy) { shell.setAttribute('aria-busy', String(busy)); },
    onLayout(listener) { layoutListeners.push(listener); },
    preserveFocus(rebuild) {
      const active = root.activeElement as HTMLElement | null;
      const key = active?.dataset.mdtKey;
      rebuild();
      if (!key) return;
      const next = Array.from(root.querySelectorAll<HTMLElement>('[data-mdt-key]')).find(item => item.dataset.mdtKey === key);
      if (next && next !== active && !(next as HTMLButtonElement).disabled) next.focus({ preventScroll: true });
    },
    openDialog(title, content) {
      closeDialog?.();
      const opener = root.activeElement as HTMLElement | null;
      const backdrop = node('div', 'mdt-dialog-backdrop');
      const dialog = node('div', 'mdt-dialog');
      const id = `mdt-dialog-${Math.random().toString(36).slice(2)}`;
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', id);
      const head = node('div', 'mdt-dialog-head');
      const heading = node('h2', '', title); heading.id = id;
      const close = () => { backdrop.remove(); closeDialog = null; opener?.focus?.({ preventScroll: true }); };
      head.append(heading, iconButton(t('shell.close', 'Close'), 'close', close));
      const bodyElement = node('div', 'mdt-dialog-body'); bodyElement.append(content);
      dialog.append(head, bodyElement); backdrop.append(dialog);
      backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) close(); });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
        if (event.key !== 'Tab') return;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && root.activeElement === first) { last.focus(); event.preventDefault(); }
        else if (!event.shiftKey && root.activeElement === last) { first.focus(); event.preventDefault(); }
      });
      shell.append(backdrop);
      (dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
      closeDialog = close;
      return close;
    },
    destroy() {
      hideTip(); events.abort(); observer.disconnect(); layoutListeners.length = 0;
      canvas.width = canvas.height = 0;
      root.replaceChildren(); element.remove();
    },
  };
  ui.setBusy(false);
  return ui;
}

/** Shortcut reference rendered inside the component's own dialog. */
export function shortcutList(groups: Array<[string, Array<[string, string[]]>]>): HTMLElement {
  const wrapper = node('div', 'mdt-shortcut-groups');
  for (const [title, rows] of groups) {
    const list = node('dl', 'mdt-shortcuts');
    for (const [label, keys] of rows) {
      const term = node('dt', '', label), detail = node('dd');
      detail.append(...keys.map(key => node('kbd', 'mdt-key', key)));
      list.append(term, detail);
    }
    wrapper.append(node('h3', 'mdt-shortcut-title', title), list);
  }
  return wrapper;
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !(target instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button'].includes(target.type)));
