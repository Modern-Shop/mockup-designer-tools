# Comparable products and design implications

Status: planning research, not an implementation audit. Sources checked on **2026-10-22**. This review uses public, first-party documentation; no paid accounts, private dashboards, conversion measurements, bundle inspection, or hands-on usability tests were used.

## Finding

The product should combine two established patterns: a merchant prepares reusable product constraints, then a shopper personalizes within those constraints. Printful and Printify are useful references for the editing sequence. Zakeke and Kickflip are closer references for merchant setup and embedding a personalization experience in an existing store. The proposed scope is a reusable library with host integrations, rather than a fulfillment platform.

## Evidence matrix

“Documented” below means the vendor describes the capability. It does not mean that performance, usability, or output quality was independently verified. A missing capability in this table means it was outside the reviewed evidence, not that the vendor lacks it.

| Reference | Documented behavior | Pattern worth adopting | Project implication — our recommendation |
| --- | --- | --- | --- |
| **Printful Design Maker** | Reusable product templates; image uploads and text; multiple print placements; move, resize, rotate, and layers; image quality warnings; mockup/3D preview and mockup download. Product-specific file guidelines are surfaced in the editor. [Official guide](https://help.printful.com/hc/en-us/articles/50264179910673-How-does-the-Design-Maker-work) | Put placement, quality feedback, and preview beside the design. Keep templates reusable. | Make print constraints part of each template. Keep shopper tools limited by merchant policy. |
| **Printify Product Creator** | The documented sequence is product selection, artwork upload, size/placement, colors, preview, save. Alignment controls, resolution guidance, layered designs, and downloadable mockup previews are included. [Official guide](https://help.printify.com/hc/en-us/articles/4483617169809-How-do-I-use-the-Product-Creator) | A small number of understandable actions leads to an immediate product preview. | Give a shopper one obvious initial action, **Upload image**, then contextual size/position tools. Avoid exposing the merchant's template controls. |
| **Zakeke customizable products** | Templates link to store products; products have sides and print areas. Setup includes images, printable zones, optional variants, a review stage, draft saving, publishing, and an internal test customizer. Print output is generated per customized area. [Official setup guide](https://zakeke.zendesk.com/hc/en-us/articles/360026668693-Create-a-customizable-product) | A structured merchant setup flow with a shopper test before publishing. | Separate a template draft from a published revision. Include **Test as customer** and explicit publishing validation. |
| **Zakeke 3D preview** | An existing customizable product can gain a 3D preview. Dedicated printable meshes must match the 2D print areas. Setup includes side mapping, optional materials, and named camera views. glTF/GLB are among its recommended formats. [Official 3D preview guide](https://zakeke.zendesk.com/hc/en-us/articles/360011939619-3D-Preview-and-Augmented-Reality) | Add 3D to an existing personalization model rather than creating a separate design document. | Treat 3D as an optional renderer of the same print surfaces. Require prepared geometry/UV mapping and provide a 2D fallback. |
| **Kickflip Design Studio** | Merchants can offer a constrained text question, a logo upload question, or a free-form studio. The studio supports image/text layers and transformations inside a defined area, configurable clipping, physical dimensions, quality warnings, and print-file settings. Configure and Design are distinct customer tabs. [Official Design Studio guide](https://help.gokickflip.com/en/articles/17069715-allowing-customers-to-combine-multiple-images-and-text-with-design-studio) | Choose the degree of customer freedom per product. | Support **guided slots** and **free placement** as template policies. A name-and-logo product should not require learning a full graphics editor. |
| **Kickflip asset preparation** | Product previews stack prepared image layers. Customizable parts are cut out in image-editing software or rendered from 3D; layers need transparency and matching dimensions. Recolorable parts need suitable neutral source imagery. [Official image preparation guide](https://help.gokickflip.com/en/articles/4580443-prepare-your-product-images) | Explain asset requirements before asking a merchant to start mapping. | Ship starter assets, a preparation checklist, and clear diagnostics. Arbitrary product photography cannot be promised to produce realistic customization automatically. |
| **Kickflip conditional logic** | Rules can restrict answers or show/hide questions based on prior choices. Broken dependencies produce warnings when linked elements are removed. [Official logic guide](https://help.gokickflip.com/en/articles/4586211-adding-conditional-logic-to-your-customizer) | Reveal only relevant controls and validate dependencies. | Start with explicit per-surface capabilities and variant compatibility. Defer a general rule builder until repeated use cases justify it. |

## What these references mean for this project

The following conclusions are **design inferences**, not claims made by the vendors.

### Two interfaces should share one model

The merchant decides what a product permits: printable regions, views, physical sizes, editable content, and applicable variants. The shopper changes artwork inside those boundaries. Separate interfaces allow substantially simpler customer controls without duplicating rendering or inventing incompatible design documents.

Use product-neutral concepts in the core: template, variant, print surface, preview view, mapping, artwork layer, asset, and export specification. A T-shirt and mug should be configurations of those concepts. They should not require separate editor applications.

### Reusable geometry is more valuable than a large toolbar

A convincing preview requires correctly prepared product imagery, clipping/occlusion, and an authored relationship between the printable surface and the displayed product. For 3D it also requires a suitable model and texture mapping. A simple setup wizard cannot remove those requirements, but it can explain them, offer presets, and detect obvious errors.

Offer a progression: flat placement first; photograph perspective/contour mapping and visual overlays next; optional 3D after the same print-surface model is proven. An irregular 2D outline only defines where artwork is visible. It does not, by itself, describe fabric wrinkles or a curved mug's perspective. Those need separately authored mapping data or a 3D model.

### The edit document and product preview have different jobs

The artwork should be stored in the coordinate system of a physical print surface. A preview maps that artwork onto a product image or a 3D mesh. Moving a camera or changing a preview photograph must not silently change the output's physical print size.

Keep the original upload, its editable transforms, and the exact published template revision. Generate previews and print-surface artwork as separate outputs. This also makes it possible for the host to re-render an order later.

### Defaults should minimize decisions

For a first-time shopper, start with a selected product and view, a single upload action, an automatically fitted design, and visible **Fit**, **Center**, **Size**, **Undo**, and **Preview** actions. Show rotation, alignment, and layers when needed. Show tools only if the template permits them.

For a merchant, offer starter presets such as flat front print, front/back apparel, and cylindrical wrap. Each preset should reveal the required inputs, not pretend to infer a print-ready template from a photo. Separate basic setup from advanced mapping and material settings.

### Print warnings must be contextual

An uploaded image's useful resolution depends on the size at which it is placed. Show a warning alongside the selected artwork, offer an actionable fix, and apply the merchant's configured print requirements. Do not hardcode one DPI threshold as correct for all materials and production methods.

Previewing a photo on a screen does not establish exact print color, ink behavior, embroidery feasibility, or production readiness. Use a separate validated output contract for each supported production method. Version one should focus on image/text artwork placement and raster print-surface export, with honest limits.

## Adopt, defer, and deliberately exclude

| Timing | Recommendation | Reason |
| --- | --- | --- |
| **First usable release** | Merchant template setup and draft/published revisions; one or more image views and physical print surfaces; rectangular and simple masked placement; shopper upload/text/transform; undo/redo; quality feedback; mockup preview; saved editable design; separate surface-art export. | Proves the complete author → customize → save/export workflow. |
| **Next** | Prepared perspective/contour mapping, shadow/highlight/occlusion overlays, reusable presets, multiple compatible variants, richer but optional layer controls. | Improves realism and coverage while preserving the original editing model. |
| **Optional extension** | Lazy-loaded GLB/glTF 3D preview, merchant mesh/surface mapping and camera presets, with 2D fallback. | Keeps ordinary photo-based products light; prepared 3D assets remain a separate merchant task. |
| **Defer until demand** | Pattern generation, a general rules engine, vector import/export, specialized print methods, server rendering adapters, advanced production pipelines. | Each adds format, validation, UX, and maintenance obligations. Preserve extension points without implementing every capability first. |
| **Outside the initial library** | Fulfillment, payments, catalog synchronization, inventory, automatic pricing, AI image generation, stock licensing, AR/virtual try-on, a full 3D modeling tool. | These are host applications or separate services. They need not ship to a shopper opening a small embedded editor. |

## Validation before committing to the UI

Use three representative tasks as proposed acceptance tests, not as claims of measured usability:

1. A merchant creates a flat T-shirt front template from a prepared image, defines physical print dimensions, tests one upload as a customer, and publishes a validated revision.
2. A shopper uploads an image, changes its size, centers it, handles a low-resolution warning, previews the result, and hands a saved design to the host without seeing template-authoring controls.
3. A merchant configures a mug wrap using a prepared mapping, then checks the same known reference artwork in 2D, mockup preview, optional 3D, and flat output. A checker/grid and labeled corners should make orientation and distortion mistakes visible.

Test with people who have not used graphics editors. Record task completion, requests for help, mistaken actions, and whether they can explain where their artwork will print. Set speed targets only after a baseline exists.

## Research boundaries and open checks

- No vendor was benchmarked for download size, memory, frame rate, setup time, mobile reliability, accessibility, RTL behavior, or CSS isolation. These remain requirements to validate independently in this project.
- The reviewed guides describe vendor workflows; they do not establish an open, portable template standard. Our public schema and migration policy require a deliberate project design.
- We did not audit vendor SDK licensing or redistribution terms. This research supports product design and does not propose bundling their code.
- Library choices, GLB loading details, canvas export limits, browser support, and Shadow DOM behavior are covered separately in [ARCHITECTURE.md](ARCHITECTURE.md).
- Recheck vendor sources if this document becomes the basis for a later market comparison; current product features can change.
