import './style.css';
import { mountAdmin } from '../src/admin.js';
import { mountCustomer } from '../src/customer.js';
import { assertDesign, assertTemplate, clone, EditorError, newId } from '../src/core.js';
import { downloadBlob } from '../src/assets.js';
import { icon } from '../src/icons.js';
import type { AdminController, CustomerController, DesignDocument, EditorOptions, EditorTheme, ProductTemplate, SubmissionSnapshot } from '../src/types.js';
import { createProduct, isProduct, PRODUCTS, productThumbnail, sampleArtwork, type ProductKind } from './fixtures.js';
import { demoText, isLanguage, LANGUAGES, type DemoKey, type DemoLanguage } from './i18n.js';

const STORAGE_KEY = 'mdt-demo-session-v1';
const THEME_KEY = 'mdt-demo-theme';
const LANGUAGE_KEY = 'mdt-demo-language';
const MAX_SESSION_BYTES = 20 * 1024 * 1024;
interface Session { schemaVersion: 1; template: ProductTemplate; design: DesignDocument; draft?: ProductTemplate }

const app = document.querySelector<HTMLDivElement>('#app')!;
app.className = 'demo-app';
// Text lives in data-i18n hooks so a language switch updates the page without rebuilding the editor containers.
app.innerHTML = `
  <header class="demo-top">
    <div class="demo-brand">
      <a class="demo-brand-home" href="./" data-i18n-aria="brand.home"><span class="demo-mark" aria-hidden="true">M</span><span class="demo-brand-text">Mockup Studio</span><span class="demo-tag">2D · 3D</span></a>
      <!-- The Selldone credit is a brand line: always English, left to right. -->
      <a class="demo-selldone" href="https://selldone.com" target="_blank" rel="noopener" dir="ltr" lang="en" aria-label="Made for Selldone (opens selldone.com)">Made for <strong>Selldone</strong><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
    </div>
    <div class="demo-tabs" role="tablist" data-i18n-aria="tabs.label">
      <button class="demo-tab" id="demo-admin-tab" type="button" role="tab" aria-selected="true" aria-controls="demo-admin-panel"><span class="demo-tab-number">1</span><span class="demo-tab-text"><span class="demo-tab-title" data-i18n="tabs.admin"></span><span class="demo-tab-role" data-i18n="tabs.adminRole"></span></span></button>
      <button class="demo-tab" id="demo-customer-tab" type="button" role="tab" aria-selected="false" aria-controls="demo-customer-panel" tabindex="-1"><span class="demo-tab-number">2</span><span class="demo-tab-text"><span class="demo-tab-title" data-i18n="tabs.customer"></span><span class="demo-tab-role" data-i18n="tabs.customerRole"></span></span></button>
    </div>
    <div class="demo-actions">
      <button type="button" class="demo-button demo-accent-button" id="demo-sample" hidden><span data-icon="image"></span><span class="demo-sample-label" data-i18n="sample"></span></button>
      <details class="demo-menu" id="demo-menu">
        <summary class="demo-button demo-icon-button" data-i18n-aria="menu.label"><span data-icon="more"></span></summary>
        <div class="demo-menu-panel">
          <p data-i18n="menu.note"></p>
          <button type="button" class="demo-menu-item" id="demo-save"><span data-icon="download"></span><span data-i18n="menu.save"></span></button>
          <button type="button" class="demo-menu-item" id="demo-restore"><span data-icon="replace"></span><span data-i18n="menu.restore"></span></button>
          <button type="button" class="demo-menu-item" id="demo-export"><span data-icon="duplicate"></span><span data-i18n="menu.export"></span></button>
          <button type="button" class="demo-menu-item" id="demo-import"><span data-icon="upload"></span><span data-i18n="menu.import"></span></button>
          <div class="demo-menu-sep"></div>
          <button type="button" class="demo-menu-item" id="demo-hostile" aria-pressed="false"><span data-icon="warning"></span><span id="demo-hostile-label"></span></button>
          <p data-i18n="menu.isolation"></p>
        </div>
      </details>
      <label class="demo-language"><span data-icon="globe"></span><select class="demo-select" id="demo-language" data-i18n-aria="language.label">${LANGUAGES.map(item => `<option value="${item.code}" lang="${item.code}" dir="${item.dir}">${item.name}</option>`).join('')}</select></label>
      <button type="button" class="demo-button demo-icon-button" id="demo-theme"><span data-icon="moon"></span></button>
    </div>
  </header>
  <nav class="demo-gallery" data-i18n-aria="gallery.label">
    <span class="demo-gallery-title" data-i18n="gallery.title"></span>
    <div class="demo-gallery-list" id="demo-gallery">
      ${PRODUCTS.map(kind => `<button type="button" class="demo-product" data-product="${kind}" aria-pressed="false"><span class="demo-product-thumb" data-loading="true"></span><span data-i18n="product.${kind}"></span></button>`).join('')}
      <button type="button" class="demo-product" data-product="blank" aria-pressed="false"><span class="demo-product-thumb"><span data-icon="plus"></span></span><span data-i18n="product.blank"></span></button>
    </div>
  </nav>
  <main class="demo-main">
    <section class="demo-editor" id="demo-admin-panel" role="tabpanel" aria-labelledby="demo-admin-tab"><div id="demo-admin"></div></section>
    <section class="demo-editor" id="demo-customer-panel" role="tabpanel" aria-labelledby="demo-customer-tab" hidden><div id="demo-customer"></div></section>
    <input type="file" class="demo-file" id="demo-import-file" accept="application/json,.json" data-i18n-aria="import.label" />
  </main>
  <footer class="demo-bottom">
    <p class="demo-status" id="demo-status" role="status" aria-live="polite"></p>
    <div class="demo-meta"><span id="demo-published-note"></span><span data-i18n="footer.local"></span><a href="tests/browser.html" target="_blank" rel="noopener" data-i18n="footer.checks"></a></div>
  </footer>
`;
for (const placeholder of Array.from(app.querySelectorAll<HTMLElement>('[data-icon]'))) placeholder.replaceWith(icon(placeholder.dataset.icon as Parameters<typeof icon>[0], 16));

const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const adminContainer = query<HTMLDivElement>('demo-admin');
const customerContainer = query<HTMLDivElement>('demo-customer');
const gallery = query<HTMLDivElement>('demo-gallery');
const productButtons = Array.from(gallery.querySelectorAll<HTMLButtonElement>('.demo-product'));
const status = query<HTMLParagraphElement>('demo-status');
const menu = query<HTMLDetailsElement>('demo-menu');
const controls = ['demo-save', 'demo-restore', 'demo-export', 'demo-import', 'demo-sample', 'demo-language'];
let admin: AdminController;
let customer: CustomerController;
let busy = false;
let lastSnapshot: SubmissionSnapshot | undefined;
let theme: EditorTheme = 'light';
let language: DemoLanguage = 'en';
let messages: Record<string, string> | undefined;
let hostile = false;
let publishedNote: { key: DemoKey; vars?: Record<string, string> } = { key: 'footer.starter' };
let lastMessage: { key: DemoKey; vars?: Record<string, string>; error: boolean } | null = null;
try {
  theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  const stored = localStorage.getItem(LANGUAGE_KEY);
  language = isLanguage(stored) ? stored : 'en';
} catch { /* storage unavailable */ }
let product: ProductKind | 'blank' = 'tshirt';
let template: ProductTemplate;

const d = (key: DemoKey, vars?: Record<string, string>) => demoText(language, key, vars);
const directionOf = (code: DemoLanguage) => LANGUAGES.find(item => item.code === code)!.dir;
/** Editor catalogs load on demand, so each extra language costs nothing until someone picks it. English is built in. */
const catalogs: Record<DemoLanguage, () => Promise<Record<string, string> | undefined>> = {
  en: async () => undefined,
  fa: () => import('../src/locales/fa.js').then(module => module.fa),
  de: () => import('../src/locales/de.js').then(module => module.de),
};
const editorOptions = (): EditorOptions => ({ theme, locale: language, direction: directionOf(language), messages });

function message(key: DemoKey, vars?: Record<string, string>, error = false) {
  lastMessage = { key, vars, error };
  status.textContent = d(key, vars);
  status.dataset.error = String(error);
}
function showError(error: unknown) {
  lastMessage = null;
  // Library errors carry stable codes, so the demo can show them in the active language.
  status.textContent = error instanceof EditorError
    ? error.localized ? error.message : messages?.[`errors.${error.code}`] ?? error.message
    : error instanceof Error ? error.message : String(error);
  status.dataset.error = 'true';
}
class DemoError extends Error { readonly key: DemoKey; constructor(key: DemoKey) { super(key); this.key = key; } }
function applyChrome() {
  document.documentElement.lang = language;
  document.documentElement.dir = directionOf(language);
  for (const element of Array.from(app.querySelectorAll<HTMLElement>('[data-i18n]'))) element.textContent = d(element.dataset.i18n as DemoKey);
  for (const element of Array.from(app.querySelectorAll<HTMLElement>('[data-i18n-aria]'))) element.setAttribute('aria-label', d(element.dataset.i18nAria as DemoKey));
  query<HTMLSelectElement>('demo-language').value = language;
  app.querySelectorAll<HTMLElement>('.demo-tab-number').forEach((element, index) => { element.textContent = new Intl.NumberFormat(language).format(index + 1); });
  query('demo-hostile-label').textContent = d(hostile ? 'menu.hostileOff' : 'menu.hostile');
  query('demo-theme').setAttribute('aria-label', d(theme === 'dark' ? 'theme.light' : 'theme.dark'));
  query('demo-published-note').textContent = d(publishedNote.key, publishedNote.vars);
  if (lastMessage) message(lastMessage.key, lastMessage.vars, lastMessage.error);
}
function applyTheme(next: EditorTheme) {
  theme = next;
  document.documentElement.dataset.theme = next;
  query('demo-theme').replaceChildren(icon(next === 'dark' ? 'sun' : 'moon', 16));
  query('demo-theme').setAttribute('aria-label', d(next === 'dark' ? 'theme.light' : 'theme.dark'));
  admin?.setTheme(next); customer?.setTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
}
function showProduct(next: ProductKind | 'blank') {
  product = next;
  for (const button of productButtons) button.setAttribute('aria-pressed', String(button.dataset.product === next));
}
function selectMode(mode: 'admin' | 'customer') {
  for (const key of ['admin', 'customer'] as const) {
    const tab = query<HTMLButtonElement>(`demo-${key}-tab`);
    tab.setAttribute('aria-selected', String(key === mode));
    tab.tabIndex = key === mode ? 0 : -1;
    query<HTMLElement>(`demo-${key}-panel`).hidden = key !== mode;
  }
  query('demo-sample').hidden = mode !== 'customer';
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  for (const button of productButtons) button.disabled = true;
  for (const id of controls) query<HTMLButtonElement>(id).disabled = true;
  try { await action(); } catch (error) { if (error instanceof DemoError) message(error.key, undefined, true); else showError(error); }
  finally {
    busy = false;
    for (const button of productButtons) button.disabled = false;
    for (const id of controls) query<HTMLButtonElement>(id).disabled = false;
  }
}
function published(next: ProductTemplate) {
  publishedNote = { key: 'footer.published', vars: { title: next.title, revision: next.revision } };
  query('demo-published-note').textContent = d(publishedNote.key, publishedNote.vars);
}
function session(): Session { return { schemaVersion: 1, template: clone(template), design: customer.getDesign(), draft: admin.getTemplate() }; }
function readSession(value: unknown): Session {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('template' in value) || !('design' in value)) throw new DemoError('status.badSession');
  const nextTemplate = assertTemplate(value.template);
  if (nextTemplate.status !== 'published') throw new DemoError('status.unpublished');
  const design = assertDesign(nextTemplate, value.design);
  const draft = 'draft' in value && value.draft ? assertTemplate(value.draft) : clone(nextTemplate);
  return { schemaVersion: 1, template: nextTemplate, design, draft };
}
async function restore(value: unknown) {
  const next = readSession(value);
  // Validate both documents before replacing the working session.
  const previous = session();
  try {
    await customer.setTemplate(next.template);
    await customer.setDesign(next.design);
    await admin.setTemplate(next.draft || next.template);
    template = clone(next.template);
    const kind = (next.draft || next.template).id.replace(/^demo-/, '');
    showProduct(isProduct(kind) ? kind : 'blank');
    published(template);
    lastSnapshot = undefined;
    selectMode('customer');
  } catch (error) {
    await customer.setTemplate(previous.template);
    await customer.setDesign(previous.design);
    await admin.setTemplate(previous.draft || previous.template);
    throw error;
  }
}
function setStoredSession(value: Session): void {
  const serialized = JSON.stringify(value);
  try { localStorage.setItem(STORAGE_KEY, serialized); }
  catch { throw new DemoError('status.quota'); }
}
function closeMenu() { menu.open = false; }
async function mountEditors(draft: ProductTemplate, design?: DesignDocument) {
  admin = await mountAdmin(adminContainer, { template: draft, ...editorOptions() });
  customer = await mountCustomer(customerContainer, { template: clone(template), design, ...editorOptions() });
}
/** Remount both editors in another language. Documents are serializable, so the work carries over unchanged. */
async function switchLanguage(next: DemoLanguage) {
  if (next === language) return;
  // Load the catalog first so a failed download leaves the current editors in place.
  const nextMessages = await catalogs[next]();
  const draft = admin.getTemplate(), design = customer.getDesign();
  admin.destroy(); customer.destroy();
  language = next; messages = nextMessages;
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* storage unavailable */ }
  applyChrome();
  await mountEditors(draft, design);
  message('status.language');
}

for (const mode of ['admin', 'customer'] as const) query<HTMLButtonElement>(`demo-${mode}-tab`).addEventListener('click', () => selectMode(mode));
// Roving tab focus: arrow keys move between the two workflow tabs, following the reading direction.
for (const [mode, other] of [['admin', 'customer'], ['customer', 'admin']] as const) {
  query(`demo-${mode}-tab`).addEventListener('keydown', event => {
    const next = language === 'fa' ? 'ArrowLeft' : 'ArrowRight';
    const previous = language === 'fa' ? 'ArrowRight' : 'ArrowLeft';
    if ((mode === 'admin' && event.key === next) || (mode === 'customer' && event.key === previous)) { selectMode(other); query(`demo-${other}-tab`).focus(); }
  });
}
query('demo-theme').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
query<HTMLSelectElement>('demo-language').addEventListener('change', event => {
  const select = event.currentTarget as HTMLSelectElement;
  const next = select.value;
  select.value = language;
  if (isLanguage(next)) void run(() => switchLanguage(next));
});
document.addEventListener('click', event => { if (menu.open && !menu.contains(event.target as Node)) closeMenu(); });
menu.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(); menu.querySelector('summary')?.focus(); } });

// A ready-made product loads into both editors: as an editable draft for the merchant and as the published storefront product.
for (const button of productButtons) button.addEventListener('click', () => void run(async () => {
  const kind = button.dataset.product;
  if (kind === 'blank') {
    const draft: ProductTemplate = {
      schemaVersion: 1, id: newId('product'), revision: newId('draft'), status: 'draft',
      title: d('blank.title'), assets: {}, surfaces: [], views: [],
    };
    await admin.setTemplate(draft);
    showProduct('blank');
    selectMode('admin');
    message('status.blank');
    return;
  }
  if (!isProduct(kind)) return;
  message('status.loading', { title: d(`product.${kind}`) });
  const next = await createProduct(kind, language);
  await admin.setTemplate({ ...clone(next), status: 'draft' });
  await customer.setTemplate(next);
  template = clone(next);
  showProduct(kind);
  lastSnapshot = undefined;
  publishedNote = { key: 'footer.starter' };
  query('demo-published-note').textContent = d('footer.starter');
  message('status.preset', { title: next.title });
}));
query('demo-sample').addEventListener('click', () => void run(async () => { await customer.addImage(await sampleArtwork()); message('status.sample'); }));
query('demo-save').addEventListener('click', () => { closeMenu(); void run(async () => { setStoredSession(session()); message('status.saved'); }); });
query('demo-restore').addEventListener('click', () => {
  closeMenu();
  void run(async () => {
    let raw: string | null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { throw new DemoError('status.storageUnavailable'); }
    if (!raw) throw new DemoError('status.noSession');
    await restore(JSON.parse(raw));
    message('status.restored');
  });
});
query('demo-export').addEventListener('click', () => {
  closeMenu();
  void run(async () => {
    downloadBlob(new Blob([JSON.stringify(session(), null, 2)], { type: 'application/json' }), 'mockup-studio-session.json');
    message('status.exported');
  });
});
query('demo-import').addEventListener('click', () => { closeMenu(); query<HTMLInputElement>('demo-import-file').click(); });
query<HTMLInputElement>('demo-import-file').addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  void run(async () => {
    if (file.size > MAX_SESSION_BYTES) throw new DemoError('status.tooLarge');
    await restore(JSON.parse(await file.text()));
    message('status.imported');
  });
});
query<HTMLButtonElement>('demo-hostile').addEventListener('click', event => {
  hostile = app.classList.toggle('demo-hostile');
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(hostile));
  query('demo-hostile-label').textContent = d(hostile ? 'menu.hostileOff' : 'menu.hostile');
  message(hostile ? 'status.hostileOn' : 'status.hostileOff');
});

adminContainer.addEventListener('mdt:publish', event => {
  const next = clone((event as CustomEvent<{ template: ProductTemplate }>).detail.template);
  void run(async () => {
    await customer.setTemplate(next);
    template = next;
    lastSnapshot = undefined;
    published(next);
    selectMode('customer');
    message('status.published');
  });
});
adminContainer.addEventListener('mdt:test', event => {
  if (busy) return; // A preceding publish event is already loading this revision.
  const next = clone((event as CustomEvent<{ template: ProductTemplate }>).detail.template);
  if (next.id === template.id && next.revision === template.revision) {
    selectMode('customer');
    message('status.testReady');
    return;
  }
  void run(async () => {
    await customer.setTemplate(next); template = next;
    published(next);
    selectMode('customer'); message('status.testLoaded');
  });
});
customerContainer.addEventListener('mdt:confirm', event => {
  lastSnapshot = clone((event as CustomEvent<{ snapshot: SubmissionSnapshot }>).detail.snapshot);
  message('status.received', { title: lastSnapshot.template.title });
});

async function boot() {
  messages = await catalogs[language]();
  applyChrome();
  applyTheme(theme);
  message('status.preparing');
  template = await createProduct('tshirt', language);
  showProduct('tshirt');
  await mountEditors({ ...clone(template), status: 'draft' });
  message('status.ready');
  // Host lifecycle integration: consumers call destroy when their containing view unmounts.
  window.addEventListener('pagehide', event => { if (!event.persisted) { admin.destroy(); customer.destroy(); } });
}
/** Gallery thumbnails are rendered from each product's 3D model, one at a time once the studio is ready. */
async function loadThumbnails() {
  for (const kind of PRODUCTS) {
    await new Promise(resolve => ('requestIdleCallback' in window ? requestIdleCallback(resolve, { timeout: 800 }) : setTimeout(resolve, 60)));
    const holder = gallery.querySelector<HTMLElement>(`[data-product="${kind}"] .demo-product-thumb`)!;
    const src = await productThumbnail(kind).catch(() => null);
    holder.dataset.loading = 'false';
    if (src) { const image = document.createElement('img'); image.alt = ''; image.src = src; holder.replaceChildren(image); }
    else holder.replaceChildren(icon(kind === 'mug' ? 'cube' : 'shirt', 18));
  }
}
void run(boot).then(loadThumbnails);
