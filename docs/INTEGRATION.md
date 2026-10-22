# Initial 2D library integration

Implemented 2026-10-22. This guide describes the actual v0.1 code. The other architecture/UX documents also discuss later capabilities.

## Files and entry points

| Source | Responsibility |
| --- | --- |
| `src/types.ts` | Serializable contracts and typed controllers |
| `src/core.ts` | Pure schema/preflight, mm geometry, fit, constraints, quality and output sizes |
| `src/assets.ts` | Local PNG/JPEG ingestion and Blob download helper |
| `src/render.ts` | Per-instance Canvas rendering, view-coordinate inversion, separate outputs |
| `src/png.ts` | PNG physical-resolution chunk, with CRC |
| `src/ui.ts` | Shared isolated shell, design tokens and themes, scoped controls (numeric scrub fields, switches, segmented controls, tooltips, dialog), localization |
| `src/icons.ts` | Inline stroke icons; no icon font or sprite request |
| `src/viewport.ts` | Zoom/pan state and rotated-box geometry for move/resize/rotate handles |
| `src/stage.ts` | Shared canvas interaction: pointer routing, pinch, wheel, drop, tool palette and zoom controls |
| `src/view3d.ts` | Editor-side 3D layer: lazy loading, print-texture updates, toolbar, loading and fallback states |
| `src/model3d.ts` | Lazily imported WebGL2 viewer: studio shading, fabric relief, orbit/pinch/keyboard controls, the pull tool, snapshots, and product photos rendered from the model |
| `src/meshes.ts` | Pure generated shapes (T-shirt, hoodie, sweater, cap, mug, cushion, box, card) with baked ambient occlusion, part spaces, and print-rectangle math |
| `src/softbody.ts` | Pure preview-only soft body (shape matching with overlapping clusters) behind the pull tool and the fabric sway |
| `src/presets.ts` | Small preset facts (default sizes, default looseness, default placements) shared without loading the mesh generators |
| `src/glb.ts` | Defensive reader for the static-mesh subset of binary glTF 2.0 |
| `src/locales/en.ts` | English reference catalog with every message key; the source for new translations |
| `src/locales/fa.ts`, `src/locales/de.ts` | Complete Persian and German catalogs, published as optional `locales/<code>` entries |
| `src/admin.ts` | Merchant template authoring controller |
| `src/customer.ts` | Shopper design editing controller |
| `demo/` | Example host with a ready-made product gallery, storage, publication and handoff |

`npm run build` emits ESM and declarations into `dist/lib/`. The package is private/local for now. A consuming bundler can use the package export paths after a local package install, or import the generated modules directly. No global stylesheet, framework, or registration call is needed. Importing these modules does not mount UI or access the DOM; call mount functions in the browser after a container exists.

```ts
import { mountAdmin } from 'mockup-designer-tools/admin';
import { mountCustomer } from 'mockup-designer-tools/customer';
import { downloadBlob } from 'mockup-designer-tools';

// publishedTemplate is a complete ProductTemplate, status: 'published'.
const customer = await mountCustomer(document.querySelector('#customizer')!, {
  template: publishedTemplate,
  locale: 'en',
  direction: 'ltr',
});

customer.element.addEventListener('mdt:confirm', event => {
  const { snapshot } = (event as CustomEvent).detail;
  // Persist the cloned template + design + assets in your host workflow.
});

await customer.addImage(file); // a real PNG/JPEG File
const output = await customer.exportPrint('front');
downloadBlob(output.blob, 'front-print.png');

// On host route unmount:
customer.destroy();
```

Use `mountAdmin(container, {template: draftOrPublishedTemplate})` for the merchant component. The demo's `createProduct()` in `demo/fixtures.ts` builds complete templates for its ready-made products. For an empty draft, provide schema version, identity, revision, title, `status:'draft'`, `assets:{}`, `surfaces:[]`, `views:[]`; the admin can add areas and upload the first photo. Empty drafts cannot publish.

## Actual controllers

Both mount functions return a Promise after initial asset preparation and rendering. A merchant can recover an incomplete or missing-photo draft; publishing stays blocked until it is valid and its images load. A shopper requires a valid published template. Controller state belongs to that instance; returned documents are clones.

| Controller | Methods |
| --- | --- |
| Admin | `getTemplate()`, `setTemplate(template)`, `publish()`, `setTheme(theme)`, `destroy()` |
| Customer | `getDesign()`, `setDesign(design)`, `setTemplate(template)`, `addImage(file)`, `validate()`, `createSnapshot()`, `exportPrint(surfaceId?)`, `exportPreview()`, `setTheme(theme)`, `destroy()` |

`element` is the mounted component host with an open ShadowRoot. `destroy()` is idempotent. Call it when the containing route/component is removed; removing the container alone is not a cleanup API. It releases event handlers, pending operations, decoded image caches, observers, canvas buffers, and instance history.

`setTemplate()` in the customer starts a **new empty design** for that revision; it does not silently migrate artwork to different manufacturing geometry. `setDesign()` checks the exact template ID/revision, all asset references and allowed placements. Load a compatible saved design explicitly after its template. Newer asynchronous setters/uploads supersede older operations. Failed loads preserve the last working document.

`publish()` checks the current draft, returns a cloned published template with a new revision, and emits a host event. Editing a published template produces a separate draft. Old snapshots do not change. Publication here means creating a valid in-memory revision; the host decides whether/how to save it and make it available in a real storefront.

## Events

Events bubble and are composed across the Shadow DOM boundary; listen on the controller's `element` or its container. No document-global event bus is installed.

| Event | Detail | Meaning |
| --- | --- | --- |
| `mdt:template-change` | `{template}` | Admin draft changed |
| `mdt:publish` | `{template}` | A new published revision was prepared |
| `mdt:test` | `{template}` | Merchant requested the customer test for that published revision |
| `mdt:change` | `{design}` | A committed customer edit/history/restore occurred |
| `mdt:confirm` | `{snapshot}` | Required areas validate; host receives the exact cloned revision/design/assets |
| `mdt:error` | `{message}` | Recoverable component operation error |

The library does not claim a cart/order was saved merely because confirmation was emitted. The demo host acknowledges receiving the snapshot and provides explicit local session saving.

## Coordinates and outputs

- All physical dimensions and artwork positions are in **millimeters**. Print origin is the upper-left of the trim area, X right, Y down. `ImageLayer.xMm/yMm` are its **center**, size is unrotated width/height, and rotation is clockwise degrees.
- A view has one product image plus a list of surface bindings. Binding `x/y` are the **top-left** in normalized photo coordinates; width/height are normalized photo fractions. Rotation is around the binding rectangle's center.
- View selectors/canvas size do not modify artwork print coordinates. A view can show multiple areas; a surface can appear in several views.
- Rectangular bleed adds physical margins to both sides of the print export. Output pixels are `round((trimMm + 2 * bleedMm) / 25.4 * dpi)` on each axis. Effective quality uses source pixels divided by actual placed size, independently of stage zoom or screen DPI.
- `exportPrint()` returns transparent flat artwork only. `exportPreview()` includes the product photograph, without editing guides. Both return `{blob,width,height,templateRevision}`; print adds `dpi,surfaceId`.
- The print PNG has a `pHYs` chunk expressing the configured DPI. Pixel rounding and pixels-per-meter encoding imply tiny rounding differences in the nominal physical size.
- The print export includes the current selected surface; empty areas cannot produce an accidental blank print. Confirming a full design requires all required surfaces to contain artwork. Low DPI is advisory, based on each surface's configurable `minDpi`.
- Ellipse and diamond presets are normalized polygons. A contour clips the visible printable region. Contour offset/extrusion for bleed is not implemented, so a clipped contour with nonzero bleed blocks publication.

Native Canvas is used for flat rectangle placement and clipping on photos; it does not simulate folds, perspective or printing color profiles. Source image pixels are retained after orientation normalization. Text/fonts, masks with holes, lighting overlays, and product variants are not part of this release.

## 3D preview

A template may carry an optional `model3d` (additive to schema version 1; readers that do not know it can ignore it). When present, both editors add a **3D** view next to the photo views. The print truth does not change: the 3D view paints each print surface's flat artwork, rendered by the same code path as the print export (trim area, contour applied, no bleed), onto the model as a texture.

```ts
template.model3d = {
  kind: 'preset', preset: 'mug', color: '#fbfbf9', size: { width: 82, height: 95, depth: 82 },
  bindings: [{ surfaceId: 'front', part: 'wrap', x: .75, y: .5 }],
};
```

- **Generated presets** have named printable parts: `tshirt`, `hoodie` and `sweater` have `front`, `back`, `left-sleeve` and `right-sleeve`; `cap` has `front`; `mug` has `wrap`; `cushion` has `front`/`back`; `box` has `front`/`back`/`left`/`right`/`top`; `card` has `front`/`back`. Sizes are millimeters (garments: chest width, body length, depth; cushion: width, height, thickness; mug: diameter and height; box: width, height, depth; card: width, height, thickness; the cap has a fixed size). A binding's `x`/`y` is the print area's center in the part's normalized space; the printed width and height come from the surface's millimeters, so artwork keeps its real proportions. On sleeves, `x = 0.5` is the outer side and `y` runs from the armhole to the cuff. On the mug, `x = 0` is the handle and `x = 0.75` faces the viewer with the handle on the right. These shapes illustrate the design (shown as on an invisible mannequin, with sleeves sewn along the torso surface, seams and topstitching, a woven neck label, studio lighting with soft shadow-mapped shadows on the product and the floor, baked ambient occlusion, and fabric, knit, twill or glaze surface relief); they are not measured product models.
- **Fabric pull (preview only).** Garments, cushions and caps can be pulled with the **Pull fabric** tool in the 3D toolbar: dragging deforms the fabric like a soft, jelly-like material that springs back when released, and loose fabric sways when the product is spun. Shoulders, neckline, armholes, and a cushion's base stay in place. `model3d.softness` (0–1, optional) sets the default looseness; shoppers can change it with the **Stiff / Loose** slider, which is not saved. Mugs, boxes, cards and GLB models are rigid and do not show the tool. The deformation never changes the design, the print export, or the photo views.
- **Photos from the 3D model.** The builder's **Create photos from 3D** adds one studio photo view per placed part (front, back, a sleeve, the mug wrap …), with each print area already positioned on the photo (its projected outline, including small rotations on sleeves). The photos go through the normal asset adapter. Check the placement afterwards: on curved parts the flat 2D rectangle is an approximation of the wrapped print.
- **Prepared GLB** (`kind: 'gltf'`, `src` as an https/blob URL or a `data:model/gltf-binary;base64,…` URL, at most 15 MB): material names identify parts, and bindings use the material's `TEXCOORD_0` space with explicit `width`/`height` (0–1). The reader supports static triangle meshes, node transforms, base-color factors, and embedded PNG/JPEG base-color textures. It rejects external resources, sparse accessors, required extensions (such as Draco or KTX2), out-of-range data, cyclic node graphs, and more than one million vertices, with `EditorError` codes `model-invalid` and `model-unsupported`. Prepare UVs so the print region is not stretched; automatic UV repair is not provided.
- The builder's **Product** step chooses the shape, color, size, fabric looseness, or GLB file (an optional `assets.ingestModel(file, {signal})` adapter can store the file and return `{src, name}`; otherwise it is embedded as a data URL). With the 3D model selected, **Placement** chooses the part and position for each print area. Removing a print area removes its 3D binding.
- Shoppers drag to rotate (with inertia), Ctrl/⌘ + scroll or pinch to zoom, use the arrow keys on the focused 3D canvas, press 0 or double-click to reset, and can toggle auto-rotate and save a 3D image. Choosing a print area turns the model to it. While the 3D view is open, `exportPreview()` returns the current 3D render.
- The viewer needs WebGL2. Without it, or after a graphics reset, the 3D view explains the problem and offers **Show photo preview** and **Try again**; the photo views and every editing control keep working. Inspector edits update the model live, but dragging artwork directly on the 3D surface is not implemented yet.
- The WebGL module, generated shapes, soft body, and GLB reader are separate files that load only when a 3D view is opened or photos are created. Generating a garment (mesh plus baked occlusion) takes roughly 0.1–0.3 s once per shape and size on a desktop; it is cached for the page.

## Assets and storage

By default, `ingestImage()` accepts PNG/JPEG by file signature, limits uploads to 12 MiB and 32 megapixels, decodes browser orientation, then normalizes into a PNG data URL with decoded dimensions. This local adapter makes demo JSON self-contained; an original compressed JPEG is not retained byte-for-byte. All rendered images must match their manifest dimensions. Data URLs are never inserted as HTML.

A host can supply `assets: {async ingest(file, {signal}) { return asset; }}` to either component. Return the typed raster asset `{id,name,src,width,height,mimeType}` using durable URLs or data. The renderer uses anonymous CORS for external images. The host must provide allowed origins, working CORS responses, authorization, durable retention, and server-side validation. Expiring URLs/blob URLs need to be replaced with durable references before a real production handoff.

The demo saves a full `{schemaVersion:1,template,design,draft?}` session to localStorage or a JSON file. Browser storage can be much smaller than a photo collection; quota failure retains work and recommends JSON export. Imported session files are limited to 20 MiB. Original prepared source assets are included, so users can reopen and re-export. This is an example adapter, not a mandatory persistence service.

## Styling and localization

All styles are inside each component's ShadowRoot, use `mdt-` classes and `--mdt-` tokens, and reset inherited typography on the internal shell. Menus and controls stay in the component. No Bootstrap, reset, external font, body portal, global keyboard handler, or stylesheet is injected into the host document. The outer host element can still be hidden/resized by the embedding application; Shadow DOM is not a security sandbox.

Supported branding tokens include `--mdt-font-family`, `--mdt-color-text`, `--mdt-color-background`, `--mdt-color-stage`, `--mdt-color-accent`, `--mdt-color-on-accent`, `--mdt-radius` (outer corner radius), `--mdt-height` (editor height on wide and medium layouts, default `720px`), and `--mdt-mobile-stage-height` (canvas height on narrow layouts). Set them on the component host or its container. Keep contrast suitable for controls and text; color tokens apply to every theme, so a host that overrides them should do so per theme.

Pass `theme: 'light' | 'dark' | 'auto'` (default `light`) to either mount function, or call `setTheme()` later. `auto` follows the viewer's `prefers-color-scheme` inside the component only.

The layout follows the component's own width, not the window: below 760 CSS px the editor stacks (top bar, canvas, panel tabs, inspector) with natural height; below 1120 px the side panel opens as an overlay; wider embeds show all panels. Touch devices get 44 px targets and pinch zoom. Ctrl/⌘ + wheel zooms the canvas; a plain wheel only pans after the user has zoomed in, so a framed product never captures host-page scrolling.

Keyboard shortcuts are handled only while focus is inside the component and never while typing in a field: Ctrl/⌘ + Z, Shift + Z or Y (history); Ctrl/⌘ + 0, 1, + and − (fit, 100%, zoom); V and H (select and hand tools); Space + drag (pan); arrows and Shift + arrows (nudge the selection on the focused canvas); Delete, Ctrl/⌘ + D, `[` and `]` (shopper artwork); Esc (deselect or leave preview); and `?` (a shortcut reference dialog rendered inside the component). Pasting a PNG/JPEG while the shopper editor has focus adds it as artwork. The host's CSP must allow the component's internal style tags and its chosen image sources; strict nonce-only CSP integration is not currently provided.

```ts
import { mountCustomer } from 'mockup-designer-tools/customer';
import { fa } from 'mockup-designer-tools/locales/fa';

const shopper = await mountCustomer(container, {
  template: publishedTemplate,
  locale: 'fa', direction: 'rtl',
  // Spread to override individual entries, e.g. the host's own confirmation label.
  messages: { ...fa, 'customer.confirm': 'افزودن به سبد خرید' },
});
```

Catalogs ship as separate entries so a host downloads only the language it uses: `locales/en` (the reference, about 440 messages, matching the built-in English), `locales/fa` (Persian, right-to-left), and `locales/de` (German). Each covers both editors: labels, accessible names, tooltips, shortcut descriptions and key names (German uses Strg/Umschalt/Entf; Persian keeps Latin key caps), units, plural forms, status messages, 3D controls, and errors. Product, view, and print-area names are host data and are not translated by the catalogs.

To add a language, copy `src/locales/en.ts` to `src/locales/<code>.ts`, export a const named after the code, translate every value while keeping each `{placeholder}`, and pass it with `locale` and `direction`. `npm test` fails if any catalog misses a key, keeps a stale one, or changes placeholders, and if `en.ts` drifts from the code. The demo lists languages in `demo/i18n.ts` and lazy-loads the chosen catalog; switching remounts both editors and keeps the published template, the builder draft, the shopper design, the theme, and the active workflow tab.

Messages use stable keys with English fallbacks and `{name}` interpolation. Numbers are formatted for the locale (Persian digits in `fa`), lists use `Intl.ListFormat`, and plural messages use `Intl.PluralRules` categories as `key.one`, `key.other`, and so on. Interpolated text values are wrapped in Unicode bidi isolates, so a Latin product name inside a Persian sentence (or the reverse) cannot reorder the surrounding numbers. Validation, ingestion, and rendering failures are `EditorError`s with a stable `code` (exported from the core entry); editors display `errors.<code>` and fall back to the English message, and any other failure uses `errors.operation`. The browser checks also scan both editors in Persian, including the 3D view, for any remaining English text. Artwork, image, and print coordinates stay LTR regardless of UI direction. User-authored text is deferred.

## Limits and verification

Local output is capped at 24 megapixels and 16,384 pixels per axis. Uploads are capped at 32 megapixels, 16,384 pixels per axis, 12 MiB per file. A template allows up to 16 print areas, 24 views, 100 assets per manifest, and 20 layers per surface. All limits produce preflight or upload errors instead of promising unlimited browser memory.

Run `npm run check`, `npm test`, and `npm run build`. Browser checks at `/tests/browser.html` examine actual exported pixels, alpha and DPI metadata, clipping, coordinate inversion, asset identity/cache validation, upload preservation, CSS isolation, RTL, independent instances, snapshots, restore, cleanup, and pointer-driven corner resizing with keyboard undo. Keep that page visible while it runs: browsers pause image decoding in hidden tabs. Manual browser QA also covers the visible merchant → publish → shopper → resize → preview → download path and narrow embeds. These are functional checks, not a completed usability study or a cross-browser performance certification.
