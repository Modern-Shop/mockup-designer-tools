# Mockup Designer Tools — agent guide

Read this file before changing the project. It records the user's product intent from 2026-10-22. Later explicit user instructions take precedence. Supporting plans are in [README.md](README.md) and [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md).

## Product intent

Build a lightweight, extensible **embeddable product customization library** with two independently loadable interfaces:

1. **Merchant / admin template builder**: add product photos or prepared 3D assets, define physical print surfaces and their visual mappings, configure allowed customization, test the shopper experience, and publish reusable templates.
2. **Customer / storefront customizer**: upload artwork, adjust its placement and size within merchant-defined rules, preview the customized product, and pass a reproducible design to the host application.

Examples include T-shirts, mugs, packaging, labels, and other printable merchandise. These are presets, not hardcoded product types. The long-term scope includes 2D contours/photo mapping and 3D surfaces. Comparable workflows include Printful and Printify, but this project is an independent reusable tool, not a fulfillment platform.

## Non-negotiable requirements

- **Easy for both audiences.** Use guided merchant setup, safe defaults, direct customer manipulation, a clear primary action, and progressive disclosure. Keep modeling/mapping jargon out of the ordinary customer flow.
- **Host-page isolation is critical.** Do not ship Bootstrap, Tailwind preflight, a global reset, global element selectors, or any stylesheet that changes the embedding site. Do not assume host styles will supply the UI.
- Use custom styles. Namespace classes, data hooks, IDs, animations, and public CSS properties with `mdt-` / `--mdt-`. Scope all selectors to the component. Shadow DOM is the recommended default boundary, with deliberate handling of inherited properties and overlays; a prefix alone does not stop host CSS entering a light-DOM component.
- Keep menus, tooltips, dialogs, and portal content inside the isolation boundary. Do not inject global font styles or replace host font-family registrations; any required shared font registry needs namespaced family IDs and explicit ownership/cleanup. Document the limitations of host control over the outer custom element. Do not attach styles or ordinary editor keyboard handlers globally.
- **Small and modular.** Separate UI, document state, rendering, validation, asset access, and host integrations. Admin code must not be part of the ordinary customer download. Load 3D and advanced tools only when used. Justify new runtime dependencies.
- **Embeddable first.** The host owns authentication, catalog, storage, cart, orders, and fulfillment. Expose typed inputs, events, and adapters. Do not require a specific web framework or a provider account. Multiple independent instances on one page must work.
- **English is the default UI language.** All user-visible strings, errors, accessible names, units, and plural forms need a translation mechanism. Support per-instance locale and direction; use logical CSS properties. RTL UI must not mirror artwork, UVs, or print coordinates.
- **Separate print truth from preview.** Store artwork placement in a canonical physical print surface. Map that surface to a photo or 3D mesh for display. Export print artwork independently of product photography, shadows, guides, and perspective.
- Publish versioned, serializable templates and designs. Preserve the template revision and asset references used by an order; later template edits must not silently change existing designs.
- Arbitrary products require prepared assets and valid mappings. Do not promise automatic 3D creation, correct UVs from any model, or accurate perspective from any uploaded photo.
- Use browser-compatible asset pipelines. The proposed 3D interchange is glTF 2.0 / GLB through an optional renderer; browsers need a rendering library/loader and do not display arbitrary GLB files natively.
- Make touch, keyboard operation, responsive layouts, and text-based alternatives to canvas interactions part of the design. Treat uploaded files and external assets as untrusted input.

## Current project stage

The initial request was **research, UX design, architecture, and an implementation plan first**, plus this durable agent guideline. The user subsequently authorized implementation of the initial 2D version on 2026-10-22. The project now has a TypeScript core, native Canvas renderer, independently mounted admin/customer Shadow DOM components, and a Vite demo. On 2026-10-22 the user asked for a very simple, modern, professional editing environment comparable to Photoshop or the Freepik editor; both components now use that workspace (top bar, panels, zoomable canvas with on-canvas handles, inspector, light/dark themes). Keep new UI consistent with it and with the shopper's simplicity requirement. The same day the user asked for a rotatable 3D product image and several UI languages selectable from a dropdown, including German: an optional lazily loaded WebGL2 3D view (generated shapes plus a GLB subset) and English/Persian/German catalogs now exist; see `docs/INTEGRATION.md` for what is and is not supported. Later that day the user asked to label which demo mode is for store admins and which for shoppers, for more realistic 3D models, for ready-made sample products (cap, mug, cushion, T-shirt, sweater, hoodie) that load into both editors, and for a jelly-like stiff/loose pull on soft products such as lifting a sleeve, but not on rigid mugs. These exist as preview features: generated garments/cap/cushion with studio shading, a preview-only soft body, photos rendered from 3D, and the demo product gallery. The pull never changes print data. The user then asked for a "Made for Selldone" link under the demo brand (always English, like the other Modern Shop concepts), for the 3D models to be as realistic as possible (they called out sleeves that looked separate from the body; sleeves are now sewn along the torso surface, with shadows and seams added), and for the project to be published as a concept store in the `Modern-Shop` GitHub organization with a GitHub Pages demo and an entry in the organization's gallery (`Modern-Shop/.github`, `profile/README.md`). See `README.md` and `docs/INTEGRATION.md` for the actual API, supported subset, commands, and verification. The broader planning documents still contain future work and are not a claim that all planned capabilities exist.

The recommended sequence is a complete 2D vertical slice, richer photo mapping, then optional 3D. This sequencing is a proposal, not a user cancellation of 3D. Follow subsequent user instructions when implementation begins; do not introduce an additional approval process.

## Working conventions for implementation

- Recommended foundation: framework-neutral TypeScript core, isolated Web Component shells, Canvas 2D baseline, optional lazy renderer packages. Technical recommendations and alternatives are in `docs/ARCHITECTURE.md`.
- Keep renderer-specific scene objects out of the saved document format. Add migrations when a persisted schema changes.
- Make storage/network services injectable. Do not embed credentials or depend on a global singleton editor or locale.
- Report print quality from actual placed raster resolution; preview appearance is not proof of print quality. Printer-specific thresholds belong to template rules.
- Define unit/origin/rotation/crop conventions before implementing coordinate math. Any new renderer must consume the same canonical design and export contract.
- Verify scoped styles on a hostile host page, at least two simultaneous instances, mount/unmount cleanup, mobile/touch, keyboard access, English and an RTL locale, save/reload parity, and print/preview consistency as appropriate to the change.
- Route every user-visible string, unit, plural, and accessible name through the editor `t()`/`plural()` helpers, and throw user-facing failures as coded `EditorError`s. Add each new message to every catalog in `src/locales/` (the `en.ts` reference plus each translation) in the same change; the catalog tests fail otherwise.
- Keep review notes honest about implemented vs planned features and measured vs proposed budgets. Add focused tests for meaningful risks; documentation-only work does not need a dummy application or invented test suite.
- Before editing a shared file, read its current contents. Avoid overwriting unrelated work from other agents.

## Documentation map

- `docs/PRODUCT_PLAN.md`: scope, priorities, milestones, acceptance criteria, and open decisions.
- `docs/INTEGRATION.md`: implemented v0.1 API, limitations, embedding and verification.
- `docs/UX_SPEC.md`: merchant and customer journeys, screen behavior, accessibility, and localization.
- `docs/ARCHITECTURE.md`: technical boundaries, data contracts, embedding, renderers, and validation.
- `docs/RESEARCH.md`: official-source competitor research and implications; vendor claims are not independent benchmarks.
