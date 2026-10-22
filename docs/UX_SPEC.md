# Mockup Designer: UX specification

Status: proposed design, ready for review before implementation. Written 2026-10-22.

This document describes two embeddable interfaces: a merchant **Template Builder** and a shopper **Product Customizer**. They share product and artwork data but expose different levels of control. All UI examples below use the default English locale. These are proposed flows and acceptance targets, not results of usability testing.

## 1. Product principles

- Put the product and the customer's artwork in the center. Keep one primary action visible for the current task.
- Make the common task short: add a photo, adjust its size, preview, and confirm. Reveal layers, precision fields, and mapping tools only when they are needed.
- Give merchants reusable presets, then allow arbitrary products through the same print-surface model. Presets must not impose a fixed product catalog.
- Keep **print layout** and **product preview** visibly distinct. A realistic preview never changes the physical print dimensions by itself.
- Show the consequences of a change immediately. Let users undo changes without navigating away.
- Treat embedding, mobile use, keyboard access, localization, and host style isolation as design constraints from the beginning.
- Use plain terms such as “Print area,” “Photo,” “Fit,” and “Preview.” Keep terms such as UV, material slot, and displacement inside advanced merchant setup.

## 2. Shared mental model

| UI term | What it means | What the user should see |
| --- | --- | --- |
| Product | An arbitrary physical item, such as a shirt, mug, box, or label | Product name, available views, and variants |
| Print area | A physical surface that receives one flat print layout | A name, width/height with units, trim boundary, and optional bleed/safe guides |
| View | A photo or 3D camera angle that shows one or more print areas | Front, Back, Left, or another merchant-defined label |
| Design | Customer artwork, optional text, and their placement within print areas | An editable layout that remains consistent across views |
| Preview | A representation of that layout on the product | Flat artwork projected onto the prepared product view |
| Template | A published product setup and allowed customer actions | A version that the host application can load |

One print area may appear in several views. For example, a mug wrap is one print area shown from three camera angles; it must not become three independent customer designs. Front and back of a shirt are two separate print areas. Switching the preview view must not silently switch the active print area.

Physical dimensions belong to the print area. The preview's scale, crop, perspective, and camera position belong to the view. Editing a photo corner changes the preview projection; editing the print width changes the production specification and requires a warning when existing designs are affected.

The UI should not promise that any photograph can automatically become a realistic curved or 3D mockup. Prepared masks, mappings, or an appropriate 3D model are required for those cases.

## 3. Template Builder for merchants

### Entry and navigation

The host can open the builder with a product already selected or as a new template. The component should not introduce its own store login, catalog, billing, or navigation shell. Provide a local title, draft status, Back/Next navigation, Save draft, and an explicit Publish action. The host owns the final persistence and authorization response.

Start with three choices:

| Choice | Initial setup | Still editable |
| --- | --- | --- |
| T-shirt | Front photo and one rectangular Front print area; optional Back | Photos, number of areas, dimensions, masks, rules, variants |
| Mug | One physical wrap area and a prepared photo view; optional extra angles | Wrap dimensions, handle exclusion, mapping, views, variants |
| Any product | An empty photo-based template with one named print area | All fields; no product-category assumptions |

“Use a 3D model” is a separate capability shown only when the installed renderer supports it. Label presets as starting points. A mug preset cannot produce correct wrap geometry from an arbitrary photo without merchant setup.

### Guided setup

| Step | Main action | Visible by default | Advanced or conditional controls | Completion check |
| --- | --- | --- | --- | --- |
| 1. Product | Add a product photo | Name, preset, photo upload, view label, thumbnail | Extra views, variants, transparent foreground overlay | At least one supported, readable view asset |
| 2. Print areas | Define where printing happens | Area name, physical width/height, units, print boundary, safe guide | Bleed, exclusion masks, additional areas, technique-specific constraints | Dimensions are positive; required areas and boundaries are defined |
| 3. Appearance | Place the print area on the product | A sample design, drag/resize, Fit, Center, photo preview | Four-corner perspective, contour mask, curved mapping where supported, blend/shading controls | Every required view binding renders the correct sample area |
| 4. Customer options | Choose allowed edits | Photo upload, move, resize, rotate, replace; optional text | Layer limits, locks, allowed colors/fonts, per-area requirements | At least one useful allowed customer action; conflicting rules resolved |
| 5. Review | Try the customer experience | Customer preview, upload test, all views, print layout check, Publish | Template revision summary, diagnostics | Required assets load, required mappings pass, no blocking print/setup issues |

Keep “Advanced setup” collapsed within the relevant step instead of adding a second navigation system. Merchants can return to earlier steps without losing work. If a change invalidates a later step, mark that step as needing attention and explain the affected setting.

Support different degrees of customer freedom through these same rules. A fixed logo slot can allow only upload/replace and uniform sizing; a free-layout area can allow movement and several layers. Start with those simple capabilities rather than a general conditional question builder. A dedicated guided-fields interface can follow when actual products need a name/logo questionnaire.

For physical units, allow mm and inches as display/input preferences while preserving a stable physical value. Switching units must not round and resave the underlying dimensions. Bleed and safe distance should be explicit physical values with visual guides, never inferred from screen pixels.

### Photo mapping and layers

The normal merchant workflow uses a sample design with arrows, text, and a grid so stretching, cropping, mirrored placement, and clipping are easy to detect. Provide a “Show print layout” switch beside “Product preview.” These are two views of the same design, not separate editable artworks.

The proposed composition order is:

1. Base product photo or 3D product material.
2. Customer design transformed from its flat print layout into the prepared view.
3. View masks, occlusion, and optional shading applied at the appropriate compositing stage.
4. Foreground product detail, such as a handle or fold that should cover the artwork.

The exact renderer order may vary for masks and shading; the builder must name their role, show the result, and offer an “Original photo / With design” comparison. A mask used to exclude a non-printable production region is different from a mask used only to hide artwork behind an object in one photo. Label them “Non-printable area” and “Preview mask” so merchants cannot confuse them.

Mapping mode choices appear only when available:

- **Flat:** rectangle placement on a straight-on product view.
- **Perspective:** adjust four corners for a planar surface photographed at an angle. Supply a keyboard/numeric alternative for every handle.
- **Curved:** use a supported cylindrical mapping or a prepared warp asset. Explain which products and input preparation the installed renderer supports.
- **3D:** select the prepared print surface on a model, choose a camera, and preview the shared flat design. Keep mesh/material/UV diagnostics in Advanced setup.

If a selected mode is unavailable, describe what must be supplied or installed. Do not offer an enabled button that leads to a dead end.

### 3D model setup

An advanced merchant may import a supported glTF/GLB model. Before enabling Publish, the builder should:

- Validate file size, required resources, supported features, and configured asset limits.
- Identify the intended mesh/material and usable print mapping; show a grid test design on it.
- Detect or ask about physical scale and print dimensions; do not guess printable dimensions from an arbitrary model's bounds.
- Preview texture seams and coverage; avoid claiming that general UV errors can be automatically repaired.
- Let the merchant define a starting camera and shopper rotation limits.
- Provide a prepared 2D preview fallback for devices where the 3D renderer cannot run.

Where UV repair or model authoring is needed, provide an actionable diagnostic and preserve the draft. This interface is not intended to become a general 3D modeling application.

### Merchant wireframe

```text
Template: Classic tee                         Draft   Save draft
Product  /  Print areas  /  Appearance  /  Options  /  Review

+------------------------+------------------------------------+
| Appearance             | Front                  Print layout |
| Print area: Front      |                                    |
|                        |       product + sample design       |
| Fit        Center      |       with adjustable placement     |
| Size / rotation        |                                    |
|                        |                                    |
| Advanced setup  >      | Front [selected]     Back            |
+------------------------+------------------------------------+
Back                                                   Next
```

On narrower embeds, the stage comes first and the step controls appear beneath it. Do not assume the component fills the browser window. The host can reserve a toolbar slot for its own close/back action.

## 4. Product Customizer for shoppers

### Default flow

1. **Add your photo.** Show the product, selected print area, upload button, supported types/limits, and a brief privacy statement supplied by the host. Support dropping a file as an additional convenience.
2. **Adjust your design.** Put the photo in the active print area using a safe initial Fit placement. Show direct manipulation plus a small set of relevant controls. Optional text appears only when the merchant enables it.
3. **Preview.** Hide editing handles, show prepared product views, keep any actionable quality warnings visible, and allow “Edit design.”
4. **Confirm design.** Validate required areas and the current assets. Emit the design and output request to the host; show success only after the host acknowledges the operation.

The host chooses the final action label, for example “Use this design,” “Save design,” or “Add to cart.” The library must not pretend to create an order or persist a cart independently. Preserve the design if the host returns a failure.

### Editor controls

The primary desktop layout contains a large stage, a compact context panel, area/view selectors, Undo/Redo, and one Preview action. Show controls for the selected object only.

| Control | Behavior |
| --- | --- |
| Fit | Places the entire artwork inside the allowed boundary without distortion |
| Fill | Covers the target boundary, potentially cropping artwork; show the crop and retain the source |
| Size | Changes scale with aspect ratio locked by default; supports a labeled numeric/range input |
| Position | Direct drag, center alignment, arrow-key movement, and optional numeric fields |
| Rotate | Simple rotation input; available only when permitted by the template |
| Replace photo | Replaces the image while preserving placement where valid; lets the user undo |
| Remove | Removes the selected artwork; does not erase other areas |
| Layers | A collapsed list shown when multiple editable objects exist |
| Add text | Appears only when enabled; uses approved fonts and the template's editing rules |

Canvas zoom changes the view only. It must never change the artwork's print size. In 3D preview, rotating the product changes the camera only. Clearly label the transition back to editing.

Scale and rotate gestures are optional shortcuts. Every essential operation must have a visible, keyboard-accessible control. Handle hits must remain usable on touch screens without making the selected artwork unexpectedly larger.

### Multi-area and variant behavior

- Show human-readable area labels such as Front and Back with a “Required” or “Optional” status.
- When an area is required, Preview may remain available but confirmation must explain which area needs artwork.
- Switching product color updates the preview while retaining the same design unless the merchant has explicitly configured a different design for that variant.
- If a variant changes physical print dimensions, apply a defined template rule and disclose any crop/repositioning before confirmation. Never silently stretch artwork.
- Give “Apply this design to another area” an explicit action and a preview. Do not copy implicitly.

### Shopper desktop wireframe

```text
Customize your tee                    Undo  Redo      Preview
Front [selected]    Back (optional)             Color: White

+------------------------------------+------------------------+
|                                    | Your photo             |
|          product + artwork          | Replace       Remove   |
|          selected handles           |                        |
|                                    | Fit            Fill    |
|                                    | Size        [---o----] |
|                                    | Center      Rotation   |
+------------------------------------+------------------------+
Print quality: Good                    Front view  /  Back view
```

“Good” is based on a defined quality rule, not an invented score. The control panel should give the recommended source dimensions when the image is too small.

### Shopper mobile wireframe

```text
Customize your tee                     Undo
Front v                         Color: White
+------------------------------------------+
|                                          |
|            product + artwork             |
|                                          |
+------------------------------------------+
Replace photo             Fit       Center
Size  [-------------o---------------------]
More adjustments v
Quality message, when needed
Preview
```

At 320 CSS pixels wide, controls wrap into a single column and remain readable. The stage uses the component's available width. Avoid a permanently open side panel, a horizontal toolbar that hides actions, or a page-sized fixed overlay. A host can opt into a fullscreen mobile editor, but the library should not force it.

In mobile preview, show a prominent “Edit design” and the host's confirmation action. If a bottom action bar is sticky within the component, reserve its space and respect safe-area insets; it must not cover warnings, keyboard focus, or host navigation.

## 5. States and messages

Messages should explain what happened and offer one useful next action. Dynamic status changes should be announced without narrating every drag or render frame.

| State | Proposed English UI | Required behavior |
| --- | --- | --- |
| Empty shopper design | “Add a photo to get started.” / “Upload photo” | Product is visible; permitted area is understandable |
| File decoding/upload | “Preparing your photo…” | Preserve prior artwork until replacement succeeds; show progress when known and allow cancellation |
| Unsupported file | “This file type isn't supported. Choose a PNG or JPEG.” | State the actual enabled types; preserve the current design |
| Image too small | “This photo may look blurry at this size. Use a larger image or make it smaller.” | Show effective resolution or recommended pixel dimensions; follow merchant-configured warning/blocking rules |
| Artwork cropped | “Part of your photo is outside the print area.” / “Fit photo” | Highlight the affected boundary and offer recovery |
| Missing required area | “Add a design to Front before continuing.” / “Go to Front” | Move focus to the relevant area when requested |
| Asset unavailable | “We couldn't load this product view.” / “Try again” | Keep design edits; use a valid alternate view if one exists |
| 3D unavailable | “3D preview isn't available on this device.” / “Show photo preview” | Offer the prepared fallback without losing the design |
| Save failure | “Your design couldn't be saved. Try again.” | Keep the in-memory design and let the host provide a specific recoverable reason |
| Restorable work | “Continue your previous design?” / “Continue” / “Start new” | Restore only a compatible design for the same product/template; confirm before discarding it |
| Template mismatch | “This product setup has changed. Review your design before continuing.” | Apply supported migration or stop with a recoverable explanation; never silently reinterpret dimensions |
| Merchant missing mapping | “Front isn't connected to a product view yet.” / “Set up appearance” | Link directly to the setup issue; retain the draft |

Draft persistence is a host capability. Show “Saved” only after acknowledgment; otherwise use “Unsaved changes” or a local-draft label that accurately describes the state. Before overwriting or abandoning a draft, preserve what can be restored and use the host's configured navigation guard.

Successful customer confirmation should preserve an immutable reference to the template revision, selected variant, artwork assets, placements, and production settings used. A later merchant template edit must not change the meaning of a previously confirmed design.

## 6. Print layout and preview quality

The preview is an illustration. The final print layout is generated from physical print coordinates and the original assets, without photo perspective, shadows, camera settings, or product backgrounds. Let the merchant inspect that flat output during Review. Keep production diagnostics out of the shopper's main workflow unless they require a decision.

Quality rules depend on the merchant's printing method. Do not hardcode one DPI threshold as universally correct. A warning should connect image pixels, physical placement size, and the configured target. Enlarging a design must refresh the warning; changing preview zoom must not.

Use “Preview colors may differ from the printed product” when relevant and avoid claiming that a normal browser preview is a certified color proof. Do not expose a CMYK toggle as a guarantee of physical color accuracy.

Bleed and safe area guides are optional in the shopper interface. Required constraints still apply even when the guides are hidden. Treat clipping according to the template's explicit rule: hard boundaries may clamp placement, while allowed bleed should remain editable and visible in Preview.

## 7. Accessibility and localization

### Accessibility

- Every tool has a visible label or accessible name. Do not rely on tooltip-only instructions, color alone, or hover-only actions.
- Keep native focus order and a clear focus indicator. Dialogs restore focus to the action that opened them, support Escape where appropriate, and avoid trapping focus in the drawing stage.
- Expose an accessible object/layer list and numeric controls as alternatives to canvas manipulation. Selecting an object through that list should identify it on the stage.
- Provide keyboard movement, scale/rotation controls, undo/redo, and a documented shortcut help panel. Ignore global shortcuts while the user is typing or when focus is outside the component.
- Keep touch targets at least 44 by 44 CSS pixels where possible, with non-overlapping effective hit areas.
- Announce upload completion, validation failures, view changes, and save results with appropriate live regions. Do not announce every pointer movement.
- Respect reduced motion and browser zoom. Test 200% text zoom and a keyboard-only session with both components embedded in a host page.
- A 3D view must have descriptive text and useful fallback controls. Orbit gestures alone cannot be the only route to Preview or confirmation.

### Language and direction

- Use English (`en`) by default and a supplied locale dictionary for every visible string, tooltip, accessible name, warning, and error. Host labels such as product names are data and may have their own localized values.
- Use stable keys, for example `customizer.uploadPhoto`, `customizer.fit`, `builder.printArea.width`, and `errors.assetUnavailable`; never use English display strings as IDs.
- Support interpolation, plurals, locale-aware numbers, and explicit units. Do not assemble sentences from translated fragments.
- Accept `locale` and `dir` at the component boundary. Scope direction to the component and allow an intentional override of inherited host direction.
- Use logical CSS properties and layouts that can grow for longer labels. Test a long-label locale and an RTL locale from the first usable milestone.
- Mirror navigation and panel placement when appropriate. Do not mirror customer artwork, print coordinates, physical product views, text entered in another language, or camera rotations automatically.
- User text needs its own direction handling; provide automatic detection and an override when the text feature is enabled. Availability of a localized UI does not imply every font supports that language's glyphs or shaping.

## 8. Embedding behavior

The components should feel like contained product tools inside the host application. They do not change the host document's font, direction, body scrolling, global keyboard behavior, or root CSS variables. All component classes, variables, overlays, and animation names must be isolated; no Bootstrap reset or shared generic selectors are permitted.

Host theming should expose a small documented token set for colors, typography, spacing, and radius. Do not require the merchant to override internal selectors. Menus and dialogs should remain inside the component's isolation boundary or use an explicitly controlled host integration; a global body portal must not be the default.

Two customizers on one page must have separate selection, undo history, asset loading, IDs, and focus handling. The admin component and 3D capabilities should not be loaded merely because a shopper uses the basic photo customizer.

## 9. Scope and validation sequence

### First technical slice (P0)

Validate the full merchant-to-shopper loop with an arbitrary flat product and a shirt example: upload a base photo, define a physical print area, place it on the photo, set customer rules, preview with sample artwork, publish a template through a host adapter, reopen it in the shopper component, and confirm a design. Include save/restore, errors, English localization keys, RTL layout checks, and print-layout export verification in this slice.

### Progressive capabilities (P1 onward)

1. Complete P1 with multiple views/areas, compatible variants, optional controlled text, and simple clipping after the basic loop is understandable. Add richer contour tooling and advanced perspective in P2; see [PRODUCT_PLAN.md](PRODUCT_PLAN.md) for the release boundary.
2. Validate a mug wrap using an explicitly supported curved mapping approach and a prepared asset set. Confirm that one wrap design stays consistent across all views.
3. Add optional 3D authoring and preview behind the renderer capability boundary. Test fallback and model diagnostics before describing 3D as a generally available feature.

These stages sequence delivery. They do not remove the product's long-term requirement to support arbitrary products, 2D mapping, and prepared 3D models.

### Proposed acceptance checks

| Check | Pass condition |
| --- | --- |
| Merchant happy path | A merchant can create a simple template, test a customer upload, and reach a valid publish request without touching raw data or code |
| Shopper happy path | A shopper can upload, fit, resize, preview, and submit a design using visible controls; no layer panel or advanced tool is required |
| First-use usability target | In an observed study, at least 4 of 5 first-time shoppers complete the simple photo task without help in under 2 minutes after assets are ready; at least 4 of 5 merchants complete the prepared flat-template task in under 10 minutes. These are proposed targets, currently unmeasured |
| Correct dimensions | Preview view/camera/zoom changes leave print coordinates unchanged; physical dimension changes disclose consequences |
| Multiple views | One design edit updates every bound view consistently; area and view selections are not conflated |
| Mobile embed | At 320 CSS pixels wide there is no horizontal page overflow, hidden primary action, overlapping control, or loss of essential editing functionality |
| Accessible editing | Upload, select, position, size, rotate when permitted, preview, and confirm are achievable with keyboard and accessible controls |
| Recovery | Bad files, failed asset loads, cancelled replacement, save failures, and incompatible restores retain recoverable work and have a useful next action |
| Localization | English fallback, long translated labels, and an RTL locale work without clipping; artwork and print coordinates are not mirrored |
| Isolation | An aggressive host stylesheet and a second mounted instance cannot change host content or interfere with the other instance's state |
| Production handoff | The confirmed design references the exact template revision and originals; print output excludes photo mockup effects |
| 3D fallback | Missing capability, model load failure, or context loss leads to a useful prepared photo preview and preserves the design |

Research can inform patterns, but only observation with merchants and shoppers can establish that these interfaces are intuitive. Record actual task completion, errors, confusion over print area versus preview, and mobile adjustment difficulties before expanding the toolbar.
