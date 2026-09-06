import { Injectable, computed, signal } from '@angular/core';
import { FabricEngineAdapter } from '../engine/fabric-engine.adapter';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';
import type { Size } from '../types/geometry.types';
import type { LayerInfo, LayerKind } from '../types/layer.types';

/**
 * Lifecycle states the shell renders against.
 *
 * `uninitialized` -- fresh service instance, no engine yet.
 * `loading`       -- engine creation or initial image load is in flight.
 * `ready`         -- engine is mounted and the image is on the canvas.
 * `error`         -- engine creation or initial load failed; `errorMessage`
 *                   holds the user-facing reason.
 */
export type EditorState = 'uninitialized' | 'loading' | 'ready' | 'error';

/**
 * Shared editor state for the in-tree shell.
 *
 * Scoped to the `CoolmsImageEditorComponent` instance via that
 * component's `providers` array, so opening two editors at once would
 * give each one its own engine, history flags, and active-tool slot.
 *
 * Kept deliberately thin: signals + the methods that mutate them. Tool
 * implementations in beta.4 reach the engine through `engine()` rather
 * than threading domain logic through this service.
 */
@Injectable()
export class ImageEditorStateService {
    private readonly engineInstance = signal<ImageEditorEngine | null>(null);

    readonly state         = signal<EditorState>('uninitialized');
    readonly canvasSize    = signal<Size | null>(null);
    readonly canUndo       = signal<boolean>(false);
    readonly canRedo       = signal<boolean>(false);
    /** Tool ID set by the right-sidebar picker. beta.3 leaves this null. */
    readonly activeTool    = signal<string | null>(null);
    readonly errorMessage  = signal<string | null>(null);
    /**
     * Viewport zoom level, where 1.0 = 100%. Mirrors the engine's
     * canvas zoom; mutated through `zoomIn` / `zoomOut` / `resetZoom` /
     * `setZoom`, never directly by consumers (the value here must
     * stay in lockstep with what the engine actually rendered).
     */
    readonly currentZoom   = signal<number>(1);
    /**
     * Fit-to-viewport zoom -- the scale at which the loaded image
     * fills the canvas-mount (with a small margin). Calculated by
     * the canvas-mount component once it has measured its viewport,
     * and re-calculated on container resize. Used as the target for
     * `resetZoom()` and the full `reset()` so "back to 100%" lands
     * the user at the same view they saw on first mount.
     */
    readonly fitZoom       = signal<number>(1);
    /**
     * Hand-tool toggle. When true, mouse-down + drag on the canvas
     * pans the viewport instead of doing nothing. The cursor swaps
     * to grab / grabbing via canvas-mount's class bindings.
     */
    readonly handToolActive = signal<boolean>(false);

    // Image transform state. Kept in sync with the engine through
    // the `imageTransformed` event. Tool components read these to
    // bind their UI (rotate slider value, flip button highlight,
    // resize input fields) to the actual image, regardless of
    // whether the change came from a mouse drag on the canvas or
    // from another sidebar tool.
    readonly imageRotation = signal<number>(0);
    readonly imageScaleX   = signal<number>(1);
    readonly imageScaleY   = signal<number>(1);
    readonly imageFlipX    = signal<boolean>(false);
    readonly imageFlipY    = signal<boolean>(false);
    readonly imagePosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });

    /**
     * The layer stack (top-most first), mirrored from the engine's
     * `layersChanged` event. The Layers panel binds to this. (C.1)
     */
    readonly layers = signal<LayerInfo[]>([]);
    /** Active layer id, mirrored from `activeObjectChanged`. (C.1) */
    readonly activeLayerId = signal<string | null>(null);
    /** Active layer kind, so style panels know which controls apply. (C.1) */
    readonly activeLayerKind = signal<LayerKind | null>(null);

    /**
     * The active non-image layer's transform, mirrored from the engine
     * (C.1c). The Rotate / Flip tools read these via the
     * `transformTarget*` computeds so a selected shape / text layer is
     * the transform target instead of the base image.
     */
    readonly activeLayerAngle = signal<number>(0);
    readonly activeLayerFlipX = signal<boolean>(false);
    readonly activeLayerFlipY = signal<boolean>(false);

    /** True when a non-image layer (not the Background) is the active object. */
    private readonly targetingLayer = computed(() => {
        const kind = this.activeLayerKind();
        return kind !== null && kind !== 'image';
    });

    /**
     * The rotation / flip the Rotate + Flip tools bind to: the selected
     * non-image layer's when one is active, else the base image's. (C.1c)
     */
    readonly transformTargetRotation = computed(() =>
        this.targetingLayer() ? this.activeLayerAngle() : this.imageRotation(),
    );
    readonly transformTargetFlipX = computed(() =>
        this.targetingLayer() ? this.activeLayerFlipX() : this.imageFlipX(),
    );
    readonly transformTargetFlipY = computed(() =>
        this.targetingLayer() ? this.activeLayerFlipY() : this.imageFlipY(),
    );

    /**
     * Image scale as a percentage rounded to a whole number. Uses the
     * absolute scale value so a horizontally-flipped image at scale
     * -1 reads as 100%, not -100%. Flip is reported separately.
     */
    readonly imageScalePercent = computed(() =>
        Math.round(Math.abs(this.imageScaleX()) * 100)
    );

    /** Read-only handle the toolbar and tools use to drive the engine. */
    readonly engine        = computed(() => this.engineInstance());

    readonly isReady       = computed(
        () => this.state() === 'ready' && this.engineInstance() !== null,
    );

    /**
     * Create the engine, load the image, and attach the listeners that
     * keep the history-state signals in sync. Throws (and flips state to
     * 'error') if either step fails -- the shell surfaces the message
     * through the canvas-mount overlay.
     *
     * The 'uninitialized' guard is what makes the service safe to call
     * from `ngAfterViewInit`: a re-entrant call (e.g. after a hot
     * module replace cycle in dev) is a no-op rather than a duplicate
     * mount.
     */
    async initializeEngine(
        container: HTMLElement,
        sourceUrl: string,
        filename: string,
    ): Promise<void> {
        if (this.state() !== 'uninitialized') {
            throw new Error('Engine already initialised');
        }

        this.state.set('loading');

        try {
            const engine = await FabricEngineAdapter.create({ container });
            engine.setCanvasDimensions({
                width:  Math.max(1, container.clientWidth),
                height: Math.max(1, container.clientHeight),
            });
            const size = await engine.loadImage(sourceUrl, filename);

            this.engineInstance.set(engine);
            this.canvasSize.set(size);
            this.state.set('ready');

            this.attachEngineListeners(engine);
        } catch (err) {
            this.state.set('error');
            this.errorMessage.set(
                err instanceof Error ? err.message : 'Failed to initialise editor',
            );
            throw err;
        }
    }

    /**
     * Tear down the engine and reset every signal to its starting
     * state. Idempotent so the host can call it from `ngOnDestroy`
     * without checking `state()` first.
     */
    destroyEngine(): void {
        const engine = this.engineInstance();
        if (engine !== null) {
            engine.destroy();
            this.engineInstance.set(null);
        }
        this.state.set('uninitialized');
        this.canvasSize.set(null);
        this.canUndo.set(false);
        this.canRedo.set(false);
        this.activeTool.set(null);
        this.errorMessage.set(null);
        this.currentZoom.set(1);
        this.fitZoom.set(1);
        this.handToolActive.set(false);
        this.imageRotation.set(0);
        this.imageScaleX.set(1);
        this.imageScaleY.set(1);
        this.imageFlipX.set(false);
        this.imageFlipY.set(false);
        this.imagePosition.set({ x: 0, y: 0 });
        this.layers.set([]);
        this.activeLayerId.set(null);
        this.activeLayerKind.set(null);
        this.activeLayerAngle.set(0);
        this.activeLayerFlipX.set(false);
        this.activeLayerFlipY.set(false);
    }

    setActiveTool(toolId: string | null): void {
        this.activeTool.set(toolId);
    }

    /**
     * Refresh the cached canvas dimensions after an in-place
     * operation that the engine doesn't proactively re-measure for
     * us (Resize tool's primary use). Engine load + initial mount
     * still write through `initializeEngine`.
     */
    updateCanvasSize(size: Size): void {
        this.canvasSize.set(size);
    }

    /**
     * Viewport zoom controls. Clamped 0.05..10 (5%..1000%) -- wide
     * range to accommodate fit-zoom for very large images (a 8000px
     * image in a 600px viewport fits at ~7%) and the occasional
     * pixel-peeping zoom-in on small images. Step factor of 1.25
     * matches the convention used by Photoshop, Affinity, and most
     * desktop image editors.
     */
    private static readonly ZOOM_MIN  = 0.05;
    private static readonly ZOOM_MAX  = 10;
    private static readonly ZOOM_STEP = 1.25;

    setZoom(scale: number): void {
        const engine = this.engineInstance();
        if (engine === null) return;
        const clamped = Math.min(
            ImageEditorStateService.ZOOM_MAX,
            Math.max(ImageEditorStateService.ZOOM_MIN, scale),
        );
        engine.setZoom(clamped);
        this.currentZoom.set(clamped);
    }

    zoomIn():  void { this.setZoom(this.currentZoom() * ImageEditorStateService.ZOOM_STEP); }
    zoomOut(): void { this.setZoom(this.currentZoom() / ImageEditorStateService.ZOOM_STEP); }

    resetZoom(): void {
        const engine = this.engineInstance();
        if (engine === null) return;
        // The "%" button returns to fit (not raw 1.0). Pan is also
        // cleared so a zoomed-and-panned view snaps back to the
        // canonical centred fit view.
        engine.resetZoom();
        const fit = this.fitZoom();
        engine.setZoom(fit);
        this.currentZoom.set(fit);
    }

    /**
     * Compute and apply the fit-to-viewport zoom for the currently
     * loaded image. Called by canvas-mount after the engine emits
     * `imageLoaded` and on container resize. The fabric adapter
     * owns canvas dimensions, so the returned fit factor drives the
     * viewport zoom directly (small images upscale beyond 1.0 to
     * fill the viewport, large images shrink below 1.0 to fit).
     */
    applyFitZoom(viewportSize: Size): void {
        const engine = this.engineInstance();
        if (engine === null) return;
        const fit = engine.getFitZoom(viewportSize);
        this.fitZoom.set(fit);
        this.setZoom(fit);
    }

    /**
     * Update the cached fit zoom without touching the live view.
     * Used by the resize observer so a window resize while the
     * user has manually zoomed in doesn't yank them back to fit
     * mid-edit; the next Reset / "%" click picks up the fresh
     * value instead.
     */
    recalculateFitZoom(viewportSize: Size): void {
        const engine = this.engineInstance();
        if (engine === null) return;
        this.fitZoom.set(engine.getFitZoom(viewportSize));
    }

    toggleHandTool(): void {
        this.handToolActive.update(v => !v);
    }

    /**
     * Top-toolbar Reset button entry point. Restores the canvas to
     * the pristine loaded state in one call:
     *   - any active tool is closed (its `ngOnDestroy` runs the
     *     tool's deactivation, e.g. `exitCropMode` for the cropper);
     *   - the Hand tool is deactivated;
     *   - the engine reloads the original image and clears both
     *     undo and redo stacks;
     *   - the viewport pan offset is zeroed and the zoom is set to
     *     the fit-to-viewport value (matches what the user saw on
     *     first mount, not the raw 1.0x that would shrink large
     *     images).
     *
     * The order matters: tool deactivation first so a mid-edit
     * cropper doesn't try to re-render against a stale canvas while
     * the engine is reloading the original image.
     */
    async reset(): Promise<void> {
        const engine = this.engineInstance();
        if (engine === null) return;

        this.activeTool.set(null);
        this.handToolActive.set(false);
        await engine.reset();
        // Full identity transform (zoom 1, pan 0). Was `resetPan()`,
        // which preserved the old zoom and left `setZoom(fit)` below
        // anchoring at `canvas-center * old_zoom` rather than the
        // viewport center, dropping the image into a corner after
        // Reset whenever the user had previously zoomed away from 1.
        engine.resetZoom();
        const fit = this.fitZoom();
        engine.setZoom(fit);
        this.currentZoom.set(fit);
    }

    private attachEngineListeners(engine: ImageEditorEngine): void {
        // Seed history flags from the engine's current state so the
        // toolbar's disabled state matches reality on the very first
        // render (before any action fires `historyStateChanged`).
        this.canUndo.set(engine.canUndo());
        this.canRedo.set(engine.canRedo());

        engine.on('historyStateChanged', ({ canUndo, canRedo }) => {
            this.canUndo.set(canUndo);
            this.canRedo.set(canRedo);
        });

        // Crop / resize replace the FabricImage with a new instance
        // and re-emit `imageLoaded`. Update canvasSize so canvas-mount
        // refits the view to the new dimensions, and reset
        // currentZoom because the adapter resets the viewport
        // transform during the replacement. The image transform
        // signals also reset here because the new image always lands
        // at angle 0 / scale 1 / no flips after the adapter's
        // `replaceImage` runs (the prior transforms are baked into
        // the replacement's pixel data).
        engine.on('imageLoaded', size => {
            this.canvasSize.set(size);
            this.currentZoom.set(1);
            this.imageRotation.set(0);
            this.imageScaleX.set(1);
            this.imageScaleY.set(1);
            this.imageFlipX.set(false);
            this.imageFlipY.set(false);
            this.imagePosition.set({ x: 0, y: 0 });
        });

        // Mouse drag on the canvas or any sidebar action that mutates
        // the image's transform routes through `imageTransformed`.
        // Mirroring it into signals here keeps the rotate slider,
        // flip-button highlight, and resize inputs reading the live
        // value without each tool wiring up its own listener.
        engine.on('imageTransformed', t => {
            this.imageRotation.set(t.angle);
            this.imageScaleX.set(t.scaleX);
            this.imageScaleY.set(t.scaleY);
            this.imageFlipX.set(t.flipX);
            this.imageFlipY.set(t.flipY);
            this.imagePosition.set({ x: t.left, y: t.top });
        });

        // C.1 layer stack + selection mirror. Seed from the freshly
        // loaded image (one Background layer, nothing selected) then
        // track the engine's layer / selection events.
        this.layers.set(engine.getLayers());
        this.activeLayerId.set(engine.getActiveLayerId());
        engine.on('layersChanged', () => this.layers.set(engine.getLayers()));
        engine.on('activeObjectChanged', ({ id, kind }) => {
            this.activeLayerId.set(id);
            this.activeLayerKind.set(kind);
            // Mirror the selected non-image layer's transform so the
            // Rotate / Flip tools target it (C.1c). `null` (image or
            // nothing selected) leaves the last values -- the
            // `transformTarget*` computeds fall back to image state.
            const t = engine.getActiveLayerTransform();
            if (t !== null) {
                this.activeLayerAngle.set(t.angle);
                this.activeLayerFlipX.set(t.flipX);
                this.activeLayerFlipY.set(t.flipY);
            }
        });
    }
}
