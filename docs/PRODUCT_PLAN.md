# Product plan

Date: 2026-10-22. Stage: proposed design and implementation plan. No runtime functionality or measured usability/performance is claimed.

**Implementation update, 2026-10-22:** the user authorized the first 2D implementation. The initial slice now exists: merchant authoring, multiple flat views/areas, image-layer customer editing, isolated styles, persistence demo, and separate real PNG exports. [INTEGRATION.md](INTEGRATION.md) describes the implemented API and limits. This document remains the broader roadmap; text, variants, shading, advanced mapping and 3D are not implemented. Acceptance criteria below must not be read as an already-passed release certification.

## 1. Product definition

Create a reusable browser library that lets a merchant define **where and how a product may be customized**, and lets a shopper **place their artwork there with very little effort**. It can be embedded in another web application without importing that application's framework, changing its styles, or requiring the application's catalog and cart to be replaced.

Two separately loadable UI components share one canonical document and rendering contract:

| Interface | Primary job | Completion outcome |
| --- | --- | --- |
| Merchant template builder | Prepare a photo/3D product, physical print areas, mappings, variants, and customer permissions | A validated, published, immutable template revision |
| Customer customizer | Upload, position/scale, optionally add allowed text, preview, and confirm | An editable design snapshot plus preview/export references for the host |

Product presets accelerate setup; they do not restrict the data model to T-shirts or mugs. A product can have many print surfaces (front, back, wrap, label) and many preview views. The same surface can appear in multiple views. A customer edits the surface once and all relevant views reflect it.

The original requirements, including strict style isolation and English-default multilingual UI, are recorded in [AGENTS.md](../AGENTS.md). [UX_SPEC.md](UX_SPEC.md) owns interaction detail; [ARCHITECTURE.md](ARCHITECTURE.md) owns data/API detail; [RESEARCH.md](RESEARCH.md) owns source-supported comparison.

## 2. Recommended product principles

1. Start with a useful customization task, not a general graphic-design suite.
2. Make a good result the default: automatic initial fit, preserved aspect ratio, center snapping, obvious print limits, reversible edits.
3. Offer merchant presets and sample assets; disclose advanced mapping, masks, materials, and quality policies only when needed.
4. Separate authoring permissions from the public shopper experience. Hiding admin controls is not authorization; the host must enforce save/publish rights.
5. Make physical print geometry authoritative. Perspective, lighting, and model cameras are preview concerns.
6. Deliver independent packages and an explicit adapter boundary so host applications can extend the library without forking it.

## 3. Feature priorities

| Capability | First complete release: 2D | Subsequent increments |
| --- | --- | --- |
| Merchant assets | Product image, optional foreground/lighting overlay; PNG/JPEG upload validation; reusable template draft | Asset library, WebP policy, batch import, model/material asset inspection |
| Print surfaces | Multiple named surfaces; size in mm; safe area, bleed, allowed transforms; clipping contour | Cut paths, repeating patterns, linked surfaces and per-size mappings |
| Photo preview | Affine rectangle placement plus safe polygon/mask clipping; multiple views | Four-corner perspective, cylindrical wrap, mesh/displacement mapping with capability gates |
| Customer artwork | PNG/JPEG upload, initial contain fit, move, uniform resize, rotate, align, replace, remove | Sanitized SVG, richer crop/masks, optional pattern/background services |
| Layers/text | Several artwork layers, selection/reorder, undo/redo; optional basic text enabled by merchant | Curved text, uploaded font management, advanced typography only with print parity |
| Variants | Named variants, stable identifiers, view/asset mapping, explicit unsupported-design warnings | Efficient large catalogs and automated variant mapping tools |
| Customer experience | Desktop and touch UI; view/area selection; preview; quality feedback; host confirmation event | Guided personalization fields and host-specific commerce extensions |
| Persistence | Template draft/published revision; design JSON; injectable asset/store callbacks; immutable confirmation snapshot | Collaboration and production render service as optional services |
| Output | Preview PNG and per-surface transparent raster at configured physical dimensions/DPI, plus design metadata | Provider-specific delivery adapters, tiled/server export for large jobs |
| 3D | Schema and renderer boundary reserved; no 3D download required for 2D | Optional glTF 2.0/GLB renderer with prepared UVs, camera presets, material rules, 2D fallback |
| Embedding | Isolated admin/customer components, multi-instance lifecycle, local events, theming tokens | Thin Vue/React wrappers and alternative host adapters |
| Localization | English messages; translation injection; per-instance locale/direction; RTL verification | Additional translated catalogs supplied by hosts/community |

These are recommended release boundaries, not a reduction of the user's long-term 2D/3D scope. If curved mugs or 3D are required for the first launch, promote the corresponding mapping/renderer milestone before calling the launch complete. A mug preset must not suggest photorealistic wrapping until that renderer passes its mapping checks.

Basic text belongs in the first release only if font readiness, non-Latin shaping, save/restore, and print/export parity are reliable. Otherwise expose the capability as unavailable and ship the image workflow first; do not show a tool that cannot produce the promised output.

## 4. Explicit boundaries

The library owns template/design editing, validation, preview rendering, and export requests. The host owns sign-in, permissions, product/SKU identifiers, pricing, shipping, cart, checkout, orders, storage, retention, and fulfillment. Host-provided callbacks may upload assets or create an order attachment; the library must not require a particular commerce service.

Defer AI image generation, background removal, stock artwork marketplaces, fulfillment integrations, full CAD/mesh/UV editing, collaborative editing, and printer color management unless a concrete integration needs them. Keep extension points for optional services rather than bundling them into every storefront.

An RGB browser mockup is a presentation aid. Correct physical dimensions and raster resolution can be validated; exact color, fabric folds, embroidery, engraving, and manufacturing tolerances require technique-specific asset pipelines and production validation. Do not label an output universally production-ready because it looks correct on screen.

## 5. Release sequence and concrete gates

No calendar estimates are asserted before the technical spikes. Each increment should finish a reviewable vertical slice.

### P0 — Prove the contracts and embedding boundary

- Finalize schema vocabulary, units/origin/rotation rules, asset references, template revisioning, and adapter responsibilities.
- Make a disposable embed proof with two isolated components on a hostile CSS host page and at least two instances; verify styles, overlays, focus, events, and unmount cleanup.
- Prove physical-surface artwork → photo placement → transparent print export with a known ruler/test image. Check dimensions, DPI calculation, alpha, EXIF orientation, and save/restore.
- Compare native Canvas implementation cost with any proposed interaction library using the actual required controls; record measured bundle/memory behavior before adding dependencies.
- Exercise a failed cross-origin asset and an oversized output; agree on explicit error/fallback behavior.

**Exit:** technical evidence supports the proposed model and budgets, or the architecture document records the necessary change. The UX concept alone does not pass this gate.

### P1 — Complete the ordinary 2D journey

- Admin creates a flat product, adds front/back views and physical surfaces, maps a rectangle, sets rules, tests as a customer, and publishes a revision.
- Customer uploads artwork, selects a surface, adjusts within rules, undoes/redoes, switches preview views, saves/reloads, and confirms.
- Host receives the exact revisioned snapshot; print and preview exports derive from the same state.
- Include optional supported basic text, layers, localization hooks, RTL, touch/keyboard controls, loading/errors, and cleanup.

**Exit:** one flat label and one T-shirt front/back fixture pass the acceptance matrix below, including print output. No provider backend is required to complete the fixture workflow.

### P2 — Flexible photo surfaces and realistic mockups

- Add arbitrary printable contours/masks, four-corner perspective, cylindrical wrapping, and optional shadow/highlight compositing incrementally.
- Keep mapping authoring merchant-only. Publish capability checks and sample assets for flat, angled, curved, and occluded cases.
- Provide a clear fallback when a template needs a renderer not available on the device.

**Exit:** a mug-wrap fixture, a perspective label/box, and an irregular masked object preserve print coordinates across views and survive save/reload. Lighting/occlusion layers never enter print artwork.

### P3 — Optional 3D without changing the shopper's task

- Load prepared GLB/glTF through a lazy optional renderer; validate limits, supported features, node/material bindings, UV mappings, camera presets, and external dependencies.
- Apply the same canonical surface artwork as a texture; address seams, orientation, mirroring, and overlapping UVs explicitly.
- Offer rotate-product preview separately from move-artwork editing, plus a merchant-provided 2D fallback.

**Exit:** a prepared 3D mug and box use the same design/export contract as their 2D counterparts. WebGL/context failures recover to a usable fallback. The 2D entry point still excludes 3D code and assets.

### P4 — Packaging and broader host integration

- Package documented independent entry points, TypeScript declarations, assets/worker handling, supported browser matrix, licenses, and migration policy.
- Supply minimal plain HTML integration first; add thin framework wrappers according to actual host demand.
- Validate hostile hosts, several instances, route remounting, CSP/CORS, large assets, memory release, and the declared device/browser targets.

**Exit:** a different host application embeds the customer component using only the public API and adapters, with no source changes or host stylesheet repair.

## 6. Acceptance matrix

These are planned checks, not completed test results.

| Area | Evidence required before release |
| --- | --- |
| Merchant usability | A first-time merchant can prepare a provided flat-product fixture, test it, and publish without reading the schema; advanced mapping is optional for that task |
| Shopper usability | A first-time shopper can upload, center/resize, preview, and confirm; every drag operation has a keyboard/form alternative |
| Arbitrary products | T-shirt front/back, a flat label, a masked contour, and a cylindrical mug are represented by data/presets instead of product-type branches; curved fixture required when curved mapping is claimed |
| Host styles | Host typography, buttons, dialogs, layout, and CSS variables are unchanged after mount; editor remains usable under hostile host selectors; overlays stay inside its boundary |
| Independence | Two editors can use different templates/locales/selection/undo histories; destroying one leaves the other and the host working |
| Output correctness | Physical dimensions, bleed, source orientation, layer order, clipping, and text readiness match saved state; preview lighting/perspective/guides are absent from print output |
| Quality feedback | Effective DPI is calculated from actual raster pixels at the placed physical size; zoom and device-pixel ratio do not affect quality classification |
| Persistence | Save → reload produces equivalent geometry/rendering; template edits do not mutate a previously confirmed design/order snapshot |
| Responsiveness | Main tasks work at 320px and typical desktop widths, using touch and keyboard without overflow or hover-only actions |
| Localization | English fallback works; a long-string pseudolocale and RTL locale fit; changing UI direction does not mirror artwork |
| Asset failures | Unsupported/oversized/corrupt files, missing assets/fonts, canceled upload, denied storage, and CORS/export failure produce useful recoverable errors |
| Performance | Measure the proposed architecture budgets on named devices/browser/network settings; keep admin/3D out of the 2D storefront import |
| Optional 3D | Prepared UVs/material mappings validate; seam/orientation fixtures pass; context loss and unsupported capability select the configured fallback |

The UX document adds proposed usability study targets. They are test hypotheses until measured with real people.

## 7. Risks and decisions to resolve during P0

| Decision / risk | Working assumption | What resolves it |
| --- | --- | --- |
| First embedding host | Plain browser integration; Vue/React wrappers optional | A real host integration fixture and its CSP/build constraints |
| First release mapping | Flat 2D journey first; richer curve/3D capabilities follow | Whether the first launch catalog requires curved mugs/3D; adjust launch scope accordingly |
| Text and fonts | Small bundled/host-provided licensed font set; explicit readiness | Print parity on agreed Latin/non-Latin fixtures and font licensing |
| Production output limits | Per-template mm/DPI and limits; client export within safe memory budgets | Real printer/fulfillment requirements and representative large jobs |
| Preview asset preparation | Merchants start with presets/sample packs; advanced mapping is guided | Observe nontechnical merchants prepare actual catalog assets |
| Template-to-variant mapping | Explicit compatible surfaces; do not silently stretch designs | Catalog fixture with several colors/sizes and changed print geometry |
| 3D asset pipeline | Prepared UVs and constrained GLB profile, lazy runtime | Real mug/box models and target device capability measurements |
| Hosting/storage/privacy | Host-supplied async adapters; local-only UI concept | Actual host storage lifecycle, retention policy, and order attachment design |

These are implementation inputs, not blockers to completing the current planning work. This plan deliberately does not choose a commerce backend, demand tokens, or introduce a mandatory external service.
