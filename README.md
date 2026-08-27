# @coolms/image-editor

Modern image editor for CoolMS DXP. Built on fabric.js v6 via a
custom `FabricEngineAdapter`, wrapped by a CoolMS-native UI shell.
Lives in-tree as a workspace package; not published to npm.

## Status

**Phase γ — fabric.js v6 engine, feature-complete.** The shell
(top toolbar, canvas mount, right sidebar, properties panel) drives
all editing operations through the engine API. The save flow is
integrated end-to-end with the Media Library and the VFS file
manager: open an image asset (or any VFS image file), edit, Save
(overwrite) or Save as new, and the source surface reflects the
change after thumbnail regeneration.

The engine adapter pattern (per ADR-073) was the foundation that
made the Phase γ engine swap from Toast UI to fabric.js v6 viable
without touching the UI shell or any tool component. See
[ADR-079](../../../../../docs/adr/079-toast-ui-rejection.md) for the
rejection rationale and [ADR-081](../../../../../docs/adr/081-image-editor-engine-swap.md)
for the journey.

## Features

### Editing tools

**Transform** (4 tools):
- **Crop** — interactive cropzone overlay built from a fabric `Rect`
  with corner controls; aspect ratio presets (Free, 1:1, 4:3, 16:9,
  3:2). Apply uses the bake-and-replace strategy (γ.3): the image
  is rendered with its current rotation/flip/filters into a canvas
  at the bounding-box dimensions, the cropped sub-region is
  extracted, and the FabricImage is replaced. The cropped output
  is always axis-aligned regardless of how the image was rotated
  when the user drew the crop overlay.
- **Rotate** — preset buttons (90° CW, 90° CCW, 180°) for instant
  commits; free-rotation slider live-bound to the image's actual
  angle (drag rotates in real time, single undo entry per drag
  session)
- **Flip** — horizontal and vertical toggles. Button highlights
  read from `state.imageFlipX/Y` so they stay accurate after
  mouse-driven manipulations and undo/redo
- **Resize** — width and height numeric inputs with aspect lock,
  live-synced to the visually-current dimensions (mouse-scaling on
  the canvas updates the inputs in real time, until the user starts
  typing). Apply commits a real image-data resize via fabric's
  `toCanvasElement` round-trip (rotation, flip, filters all baked
  into the new pixel data)

**Filters** (7 tools):
- **Brightness, Contrast, Saturation** — sliders, range −1..1
- **Blur** — slider, range 0..1
- **Sepia, Grayscale, Sharpen** — toggles, parameter-less

Slider filters live-preview during drag with a coalesced
`undo → applyFilter` cycle so the undo stack stays at one entry per
preview session. `clearRedoStack()` on commit prevents stale preview
entries from leaking into the redo stack.

### Top toolbar

- **Undo** / **Redo** — bound to engine history events. The custom
  command stack (per ADR-081) records one entry per logical
  operation; mouse manipulations and sidebar-driven changes both
  push commands through the same path.
- **Reset** — re-loads the original image and applies fit-to-viewport
  zoom centred. Identity viewport transform is restored so the next
  fit calculation lands the image at the viewport centre regardless
  of where the user had zoomed/panned.
- **Zoom out** / **Zoom %** / **Zoom in** — viewport zoom only,
  clamped 5%..1000% with a 1.25× step. Click the percentage to jump
  to fit. **Ctrl+wheel** (Cmd+wheel on Mac, also covers trackpad
  pinch) zooms with a 1.1× factor anchored at canvas centre.
  Viewport zoom does not affect saved bytes (pure fabric viewport
  transform).
- **Hand tool** — pan the canvas with mouse drag. Single click
  toggles on, second click toggles off. While active, fabric's
  selection and hit-testing are disabled so a drag on empty canvas
  always pans rather than drawing a marquee.
- **Dimensions badge** — current image size in natural pixels.

### Direct mouse manipulation

Click the image to select it; fabric's corner controls render at
the image edges. Drag a corner to scale, the rotation handle
(top-centre) to rotate, or the body to move. On `mouseup` the
adapter pushes a single transform command spanning the entire
gesture, so undo reverts the whole drag in one step rather than
per-pixel. The sidebar tool inputs (Rotate slider, Resize
width/height) live-sync to the image's transform via the
`imageTransformed` event — they reflect mouse-driven changes in
real time, and changes from the sidebar drive the canvas the same
way. Both paths are authoritative; they cannot drift.

### Canvas frame

A thin orange rectangle (`rgba(245, 166, 35, 0.5)`) tracks the
image bounds as a visual hint of the image extent against the dark
canvas background. The frame mirrors the image's `angle / scaleX /
scaleY / flipX / flipY` so it follows rotation and flip natively;
`strokeWidth = 2 / zoom` keeps the visible stroke at a constant 1
visual pixel regardless of viewport zoom. It is `excludeFromExport:
true`, hidden during crop mode (so the dashed cropzone is the only
visible rectangle), and never reaches the saved bytes — the export
path renders only the FabricImage object.

### Save flow

- **Save** — overwrite the original asset (with confirmation dialog)
- **Save as...** — create a new asset with editable filename
  (default `{stem}-edited{ext}`)
- **Cancel** — close without changes

The host calls `shell.deactivateActiveTool()` immediately before
`engine.export()` so any mid-edit tool (most importantly the
cropper, which renders a fabric overlay) cleans up before pixels
are read. Export uses fabric v6's `image.toBlob({format, quality})`
and `image.toDataURL` directly — they render only the FabricImage
object, so the canvas frame and any leftover overlay are never in
the output regardless of `excludeFromExport`.

## Architecture

Three layers, separated for swappability:

```
   UI shell  ──►  ImageEditorEngine  ──►  FabricEngineAdapter  ──►  fabric.js v6
                  (interface)             (this package)             (npm peer dep)
```

1. **UI shell** — `<coolms-image-editor>` host component with three
   panes (top toolbar, canvas mount, right sidebar). Tools register
   themselves into a `ToolRegistryService`; the right sidebar uses
   `NgComponentOutlet` with `inputs` to render the active tool's
   properties panel.
2. **Engine adapter** — `FabricEngineAdapter` implements
   `ImageEditorEngine`. Owns canvas dimensions (no vendor CSS
   auto-fit layer), normalises the public API (lowercase filter
   names, `imageTransformed` event for bidirectional sync, single
   `setCanvasDimensions` for viewport-driven resizing), maintains
   a custom undo / redo command stack, and bumps fabric's filter
   `textureSize` config to fit images larger than 4096 px before
   the first WebGL filter pass.
3. **fabric.js v6** (vendor, MIT) — canvas rendering (`Canvas`),
   image object (`FabricImage`), interactive controls (corner /
   rotation handles), filter pipeline (WebGL backend with Canvas2D
   fallback). Imported via `from 'fabric/es'` for tree-shaking.

### Why an adapter

- **Lazy loading**: the editor module is split into its own lazy
  chunk and only loaded when the user opens the dialog.
- **Stable API**: lowercase filter names; `imageTransformed` event
  abstracts mouse vs sidebar origin; viewport zoom semantics
  (clamped, anchored at canvas centre) live in one place. Vendor
  renames or replacement don't leak to the shell.
- **Engine swap proven viable**: Phase γ replaced Toast UI with
  fabric v6 with zero changes to the UI shell or tool components.
  The interface is the firewall.

### Filter conventions

Public API uses lowercase names ('brightness') and normalised
ranges (see `src/types/filter.types.ts`). The adapter maps them to
fabric `BaseFilter` classes (`Brightness`, `Contrast`, etc.).
Sharpen resolves to a stock `Convolute` filter constructed with
the canonical 3×3 sharpen kernel `[0,-1,0,-1,5,-1,0,-1,0]` —
identical to Toast UI's old extension, but with no extension
import needed.

The adapter calls `ensureFilterBackendFitsImage(image)` before each
`applyFilters` invocation. If the image's longest dimension exceeds
`config.textureSize` (default 4096), `textureSize` is bumped to the
next power of two (capped at 16384) and the filter backend is
re-initialised. Without this, fabric's WebGL filter pipeline
allocates a tile-sized GL canvas that's too small for the image,
leaving pixels past the tile boundary un-rendered (the right-edge
crop bug observed during γ.2 smoke). The factory's `WebGLProbe`
falls back to `Canvas2dFilterBackend` automatically if the GPU
can't support the new size.

## Canvas vs Image semantics

The editor uses a **transform-the-image** model rather than the
Photoshop-style separate-canvas model.

- The **image** is the document. Crop, resize, rotate, flip, and
  filters all mutate the image's pixels or its transform state.
- The **canvas** is a viewport. It is sized to the host container
  via `engine.setCanvasDimensions(viewport)` and only exists to
  display the image; it has no independent dimensions, no
  background colour, no separate save-bounds.
- **Save** outputs the current image with all transforms applied
  (`image.toBlob` / `image.toDataURL`). What you see is what gets
  saved; nothing outside the image bounds is ever in the output.

Practical consequences:

- An image cannot be moved relative to a canvas, because the
  canvas is the viewport, not a separate workspace.
- Crop bakes rotation, flip, and prior crops into the new pixel
  data, then drops the transform state back to identity. The
  cropped output is always axis-aligned regardless of how the
  image was rotated when the user drew the crop overlay.
- Rotation is reversible (undo / redo) until the next crop, after
  which the rotated pixels become part of the image content.
- Viewport zoom is purely visual and never affects saved bytes.

A true Photoshop canvas model (fixed-size workspace, image as a
positioned layer, separate Canvas Size / Image Size / Trim tools)
is deferred to Phase δ. It is significant scope and only worth
building if the editor becomes a distributable product. For
complex multi-layer compositions today, recommend a dedicated
desktop tool.

## Usage

### As a CDK Dialog (the primary integration path)

```typescript
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import {
    CoolmsImageEditorHostComponent,
    type CoolmsImageEditorHostData,
    type CoolmsImageEditorHostResult,
} from '@coolms/image-editor-angular';

const data: CoolmsImageEditorHostData = {
    asset: {
        uuid:        '...',                  // MediaAsset.id
        originalUrl: '/media/photo.jpg',
        filename:    'photo.jpg',
        mimeType:    'image/jpeg',
        dimensions:  { width: 1920, height: 1080 },
    },
};

const dialogRef = dialog.open<CoolmsImageEditorHostResult, CoolmsImageEditorHostData>(
    CoolmsImageEditorHostComponent,
    {
        data,
        backdropClass: 'cdk-overlay-dark-backdrop',
        disableClose:  true,
    },
);

const result = await firstValueFrom(dialogRef.closed);
if (result?.kind === 'saved') {
    // result.mode is 'overwrite' or 'save_as_new'
    // result.assetUuid is the resulting MediaAsset id
}
```

### Direct engine use (for embedding outside a CDK Dialog)

```typescript
import { FabricEngineAdapter, type ImageEditorEngine } from '@coolms/image-editor-angular';

const engine: ImageEditorEngine = await FabricEngineAdapter.create({
    container: document.querySelector('#editor')!,
});

// Size the canvas backstore + display to your viewport. The adapter
// owns canvas dimensions; without this call the canvas defaults to
// the container's `clientWidth/Height` at construction time.
engine.setCanvasDimensions({ width: 1200, height: 800 });

await engine.loadImage('https://example.com/photo.jpg');
await engine.applyFilter('brightness', { brightness: 0.2 });
await engine.crop({ x: 100, y: 50, width: 800, height: 600 });
await engine.rotate(90);

// Fit-to-viewport zoom (with a 5 % margin around image edges)
const fit = engine.getFitZoom({ width: 1200, height: 800 });
engine.setZoom(fit);

const blob = await engine.export('jpeg', 0.92);

engine.on('historyStateChanged', ({ canUndo, canRedo }) => {
    // wire your own undo / redo buttons
});

engine.on('imageTransformed', t => {
    // mirror to your own sidebar: angle, scaleX/Y, flipX/Y, left, top
    // t.source is 'mouse' (corner-handle drag) or 'sidebar' (engine.rotate / engine.flip / etc.)
});

engine.destroy();
```

## Theming

Every component in the package styles itself through CMS CSS
variables (`--cms-surface`, `--cms-text`, `--cms-accent`,
`--cms-border`, `--cms-canvas-bg`, `--cms-overlay-scrim`, etc.)
defined in the host project's `src/styles.scss`. There is no
per-component colour configuration and no theme prop — the editor
follows whatever the host theme dictates.

When the host project ships a CMS-wide light/dark switch later
(flipping the values of those variables at the `:root`), the editor
reflects the new theme immediately on the next render. No remount,
no `theme` config object to keep in sync.

Two intentionally hard-coded values exist:
- `#ffffff` text on `--cms-overlay-scrim`. The scrim is dark by
  design (legibility over the canvas during loading / saving), so
  the contrast pair is fixed.
- `rgba(245, 166, 35, .15)` focus-ring shadow on the resize tool's
  numeric inputs. Matches the project's existing focus-ring pattern
  (used by `.cms-input`, `.form-control`, etc.); promote together
  if a `--cms-accent-focus-ring` token lands at the project level.

## Performance

Measured during γ.6 verification (Chrome on Windows, NVIDIA GTX
1650 via ANGLE D3D11, `WebGLFilterBackend` confirmed,
`MAX_TEXTURE_SIZE=16384`):

| Metric | Toast UI baseline | Phase γ (fabric v6) | Delta |
|---|---|---|---|
| Editor lazy chunk (transfer / gzipped) | 167.60 kB | **78.5 kB** | **−53%** |
| Editor lazy chunk (decoded / raw) | ~722 kB | **290.4 kB** | **−60%** |

Heap behaviour over 10 open / load 4608×3456 image / close cycles
on a 4 GB heap-limit Chrome:

| Checkpoint | Heap used | Canvases | Editor host instances |
|---|---|---|---|
| Baseline | 15.79 MB | 0 | 0 |
| After cycle 1 | 15.82 MB | 0 | 0 |
| After cycle 5 | 15.87 MB | 0 | 0 |
| After cycle 10 | 15.88 MB | 0 | 0 |

Heap delta across 10 cycles: +0.09 MB (~9 kB / cycle, well within
Angular's per-cycle change-detection noise). A single leaked
decoded image at 4608×3456 RGBA would be 64 MB; we see 9 kB.
`engine.destroy()` is fully effective.

End-to-end Sharpen (3×3 Convolute) on a 4608×3456 image: ~331 ms
(click → image rendered, including DOM dispatch + Angular CD +
WebGL filter pass + canvas blit). The actual GPU filter time is a
fraction of that — most is Angular CD + paint.

## Browser compatibility

- Chrome, Firefox, Edge, Safari (modern, evergreen)
- WebGL preferred. fabric's `getFilterBackend` factory falls back
  to `Canvas2dFilterBackend` automatically when WebGL is unavailable
  or when the requested `textureSize` exceeds `MAX_TEXTURE_SIZE`.
- Recommended ≥ 4 GB RAM for images larger than 4096 px on the
  long edge (the WebGL tile bumps to 8192 for those).
- Tested in Chrome (γ.6 smoke). Firefox / Edge / Safari verified
  conceptually but not in this round; report any browser-specific
  issues against the engine adapter, not the UI shell.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| β.1-β.7 | Headless mount, engine adapter, UI shell, 11 tools, theming, save flow | Done |
| γ.1 | fabric.js v6 diagnostic (read-only) | Done |
| γ.2 | `FabricEngineAdapter` rewrite (~640 LOC), state service switch | Done |
| γ.3 | Canvas-space crop (bake-and-replace), Sharpen textureSize fix, blob-URL undo | Done |
| (B) | Bidirectional sync (`imageTransformed` event), live-bound rotate slider, flip / resize signals | Done |
| γ.4 | Canvas frame overlay, three known issues validated as resolved-for-free | Done |
| γ.5 | Toast UI dependency removed (640 LOC adapter deleted, comments cleaned) | Done |
| γ.6 | Bundle / memory / functional verification | Done |
| γ.7 | README + ADR-079 outcomes + ADR-081 journey | Done |

### Phase γ.8+ — incremental tool expansion

- **γ.8** — Shapes (Free Draw, Rectangle, Circle, Text, Icons, Mask)
- **γ.9** — Color picker / eyedropper
- **γ.10** — WebP / AVIF export options
- **γ.11** — Tiptap inline widget integration
- **γ.12** — Server-side preset crops (Media Library thumbnail / banner sizes)
- **γ.13** — Drag-and-drop image into the editor
- **γ.14** — AI integrations (background removal, smart crop, upscaling) — depends on AI endpoints backlog
- **γ.15** — Mobile responsive (touch gestures, pinch-zoom)
- **γ.16** — Keyboard shortcuts (Ctrl+0 fit, Ctrl+1 actual size, etc.)

### Phase δ — distant

- **Standalone npm publication** as `@coolms/image-editor`
- **Framework adapters** — React, Vue, Svelte wrappers around the
  same `ImageEditorEngine` interface
- **Plugin tool registration** — open `ToolRegistryService` to
  consumer-defined tools
- **Video editor companion** sharing the engine-adapter pattern

## License

MIT (CoolMS DXP). The runtime peer dependency `fabric` is also MIT.
See `ATTRIBUTION.md` for the full vendor acknowledgement chain.
