import type { Point, Rect, Size } from '../types/geometry.types';
import type { FilterName, FilterParams } from '../types/filter.types';
import type {
    LayerInfo, ShapeKind, ShapeOptions, TextOptions, ObjectProps, FillSpec, MaskSpec,
    ShapeGeometry, AnnotationShapeOptions,
} from '../types/layer.types';
import type { EngineEventType, EngineEventHandler } from './engine-events';

/**
 * Engine contract for image manipulation.
 *
 * `FabricEngineAdapter` is the current implementation, built on
 * fabric.js v6. The interface is the firewall between the UI shell
 * and the rendering engine: a future implementation could target a
 * different canvas library without touching consumers.
 *
 * Async semantics:
 *   - All mutations return `Promise` so consumers can chain reliably
 *     even when the underlying engine is partly synchronous.
 *   - Read-only accessors (`canUndo`, `getCanvasSize`, etc.) are
 *     synchronous because the engine's internal state is queryable
 *     without a tick.
 */
export interface ImageEditorEngine {
    /**
     * Load an image into the canvas. Replaces any existing content.
     * Returns the loaded image's intrinsic dimensions.
     */
    loadImage(source: string | Blob, name?: string): Promise<Size>;

    /**
     * Roll back every change since the last `loadImage()`. Implemented
     * via repeated `undo()` until the stack is empty rather than a
     * separate "reset" semantic, so behaviour is consistent with the
     * undo button in the UI.
     */
    reset(): Promise<void>;

    /** Crop to the given rectangle (in canvas coordinates). */
    crop(rect: Rect): Promise<void>;

    /**
     * Enter the engine's interactive crop UI: a draggable cropzone
     * appears on the canvas and the user resizes / repositions it
     * with the mouse. The actual crop operation only happens when
     * `crop(rect)` is called against the rect returned by
     * `getCropRect()`. Idempotent: a second call while already in
     * crop mode is a no-op.
     */
    enterCropMode(): Promise<void>;

    /**
     * Exit the interactive crop UI without applying. The cropzone
     * overlay is removed; the canvas state is unchanged.
     */
    exitCropMode(): Promise<void>;

    /**
     * Lock the cropzone to a fixed `width / height` ratio. `null`
     * frees the cropzone (user can drag any rectangle). Only valid
     * while in crop mode; outside crop mode this is a no-op.
     */
    setCropAspectRatio(ratio: number | null): void;

    /**
     * Read the current cropzone rectangle in canvas-space coordinates
     * (the overlay's `getBoundingRect()` AABB, no viewport zoom or
     * pan factored in). Returns `null` when not in crop mode or when
     * the overlay has zero width or height.
     */
    getCropRect(): Rect | null;

    /**
     * Rotate by `degrees` (positive = clockwise). Targets the active
     * non-image layer (shape / text) when one is selected, otherwise
     * the base image (C.1c per-layer transforms).
     */
    rotate(degrees: number): Promise<void>;

    /**
     * Flip along the given axis. Targets the active non-image layer
     * when one is selected, otherwise the base image (C.1c).
     */
    flip(axis: 'horizontal' | 'vertical'): Promise<void>;

    /** Resize the canvas (and the loaded image) to `size`. */
    resize(size: Size): Promise<void>;

    /**
     * Apply a filter. Idempotent: re-calling with new params updates
     * the existing instance of that filter rather than stacking a new
     * one. Parameter ranges are normalised — see FilterParams docblock.
     */
    applyFilter(name: FilterName, params?: FilterParams): Promise<void>;

    /** Remove a previously-applied filter (no-op if not active). */
    removeFilter(name: FilterName): Promise<void>;

    /** True when the named filter is currently active. */
    hasFilter(name: FilterName): boolean;

    // --- Layers / objects (C.1) -------------------------------------
    //
    // The base image is layer 0 (bottom, locked). Shapes and text are
    // added as canvas objects stacked on top; export flattens them.
    // All mutating ops push a single undo command and emit
    // `layersChanged` (+ `activeObjectChanged` where selection moves).

    /**
     * Add a shape, centred on the image, styled per `opts` (defaults
     * fill in). The new shape becomes the active object.
     */
    addShape(kind: ShapeKind, opts?: Partial<ShapeOptions>): void;

    /**
     * Add an editable text box, centred on the image. The new text
     * becomes the active object.
     */
    addText(opts?: Partial<TextOptions>): void;

    // --- Annotation-authoring seams ---------------------------------
    //
    // Consumers that author GEOMETRY over the image (the ImageMap
    // region page) rather than pixels: shapes placed at explicit
    // scene coordinates, geometry read back out, and the base image's
    // bounds for normalizing against. Paired with the `scenePointer`
    // engine event, which feeds draw-by-drag interactions.

    /**
     * The base image's scene-space bounding rect (the frame authored
     * geometry is normalized against), or `null` before `loadImage()`.
     */
    getImageBounds(): { x: number; y: number; width: number; height: number } | null;

    /**
     * Add a shape at explicit scene-space geometry (no centering).
     * Becomes the active object; undoable like `addShape`. Returns the
     * new layer's id so the caller can key its own metadata to it.
     */
    addShapeAt(geometry: ShapeGeometry, opts?: AnnotationShapeOptions): string;

    /**
     * Read a shape layer's current scene-space geometry, reflecting
     * any interactive move / scale the user applied. Rects report the
     * axis-aligned box (rotation is not representable — pair with
     * `lockRotation`); ellipses report center + scaled radii; polygons
     * report fully-transformed vertices. `null` for unknown ids, the
     * base image, or non-shape layers.
     */
    getShapeGeometry(id: string): ShapeGeometry | null;

    /**
     * Toggle per-vertex editing on a POLYGON shape layer. While enabled
     * the polygon's default scale/rotate handles are replaced by one
     * draggable control per vertex (whole-shape dragging is locked so
     * the vertices are the only interaction); a completed vertex drag
     * is undoable like any other mutation. Disabling restores the
     * default handles. Returns `false` (no-op) for unknown ids or
     * non-polygon layers; enabling twice is idempotent.
     */
    setVertexEditing(id: string, enabled: boolean): boolean;

    /**
     * Set a layer's fill for a TRANSIENT preview tint (e.g. a live
     * busy/free status overlay while authoring). Not undoable and not part
     * of the shape's geometry, so it never affects what a save persists.
     * Passing `null` restores the default annotation fill. No-op for the
     * base image or an unknown id.
     */
    setLayerFill(id: string, fill: string | null): void;

    /**
     * Insert a new draggable vertex into the polygon `id` currently in
     * vertex-edit mode, at the point on its outline NEAREST to the scene
     * coordinate `(sceneX, sceneY)` — a collinear insert, so the polygon's
     * shape is unchanged, it just gains a handle the author can then drag.
     * The controls are rebuilt (re-indexed) and the insert is undoable.
     * Returns `false` (no-op) if `id` is not the polygon currently in
     * vertex-edit mode. Intended to be wired to a double-click on the
     * outline while editing vertices.
     */
    addVertexAt(id: string, sceneX: number, sceneY: number): boolean;

    /**
     * Remove the vertex of the polygon `id` (currently in vertex-edit mode)
     * NEAREST to the scene coordinate `(sceneX, sceneY)`, but only when the
     * coordinate lands ON a vertex handle (within a fraction of the polygon's
     * own size). The controls are rebuilt (re-indexed) and the removal is
     * undoable. Returns `false` (no-op) if `id` is not the polygon in
     * vertex-edit mode, if removing would drop below the 3-vertex minimum a
     * polygon requires, OR if the coordinate is too far from any vertex — so
     * a caller can route a double-click to this FIRST and fall through to
     * {@link addVertexAt} (which projects onto the outline) when it returns
     * `false`. Intended to be wired to a double-click on a vertex handle.
     */
    removeVertexAt(id: string, sceneX: number, sceneY: number): boolean;

    /**
     * The current layer stack, **top-most first** (so a Layers panel
     * lists it the way every editor does). Always includes the base
     * image as the last (bottom) entry.
     */
    getLayers(): LayerInfo[];

    /** The active layer's id, or `null` when nothing is selected. */
    getActiveLayerId(): string | null;

    /** Select a layer by id (`null` clears selection). */
    selectLayer(id: string | null): void;

    /** Delete a shape / text layer (no-op for the locked base image). */
    removeLayer(id: string): void;

    /** Show / hide a layer. */
    setLayerVisibility(id: string, visible: boolean): void;

    /** Set a layer's opacity (0..1). */
    setLayerOpacity(id: string, opacity: number): void;

    /**
     * Restack a layer. `up`/`down` move one step; `front`/`back` jump
     * to the extremes. The base image is pinned to the bottom — other
     * layers can't sink below it.
     */
    reorderLayer(id: string, direction: 'up' | 'down' | 'front' | 'back'): void;

    /**
     * Read the active object's editable style props (`fill`, `stroke`,
     * `strokeWidth`, `opacity`, plus font props for text). Returns
     * `null` when no object — or the base image — is selected.
     */
    getActiveObjectProps(): ObjectProps | null;

    /**
     * Apply style props to the active object (single undo command).
     * No-op when nothing editable is selected.
     */
    updateActiveObject(props: ObjectProps): void;

    /**
     * Read the active object's fill as a UI-friendly {@link FillSpec},
     * resolving a fabric `Gradient` back to mode + colour stops + angle
     * so the style panels can round-trip a gradient on re-select.
     * Returns `null` when no shape / text layer is selected. (C.1b)
     */
    getActiveObjectFill(): FillSpec | null;

    /**
     * Set the active object's fill from a {@link FillSpec}, building a
     * fabric `Gradient` for the linear / radial modes (single undo
     * command). No-op when nothing editable is selected. (C.1b)
     */
    setActiveObjectFill(spec: FillSpec): void;

    // --- Per-layer transforms + masking (C.1c) ----------------------

    /**
     * The active non-image layer's rotation + flip state, so the
     * Rotate / Flip tools can bind to the selected layer rather than
     * the base image. Returns `null` when the base image — or nothing
     * — is the active object (the tools fall back to image state).
     */
    getActiveLayerTransform(): { angle: number; flipX: boolean; flipY: boolean } | null;

    /**
     * Clip the mask target to a shape (single undo command). The target
     * is the active non-image layer when one is selected, otherwise the
     * base image — so selecting a layer masks it, selecting nothing (or
     * the Background) masks the photo. `shape: 'none'` clears the mask.
     */
    setMask(spec: MaskSpec): void;

    /**
     * Read the mask target's current {@link MaskSpec} so the Mask tool
     * can seed its controls on (re)selection. Returns the default
     * (`shape: 'none'`) when the target has no mask, or `null` when
     * there is no target at all (no image loaded).
     */
    getMask(): MaskSpec | null;

    undo(): Promise<void>;
    redo(): Promise<void>;
    canUndo(): boolean;
    canRedo(): boolean;

    /**
     * Forget every entry currently in the redo stack.
     *
     * Used by the live-preview filter tools: each slider drag does an
     * `undo()` followed by an `applyFilter()`, so the redo stack
     * accumulates one stale entry per drag. Calling this on commit
     * leaves the stack in the same shape it would have had if the
     * user had jumped straight to the final value, with no preview
     * cycle at all.
     */
    clearRedoStack(): void;

    /**
     * Whether the flattened render contains any transparency, so the
     * save flow can force a PNG export instead of flattening a masked /
     * transparent image onto an opaque (JPEG) background — which loses
     * the cut-away region to opaque black (C.1d). True when the base
     * image or any visible layer carries a mask (`clipPath`), or when
     * the flattened pixels contain a non-opaque alpha value. Cheap for
     * the masking case; scans pixels only as a fallback.
     */
    hasAlpha(): boolean;

    /**
     * Render the current canvas as a Blob. `format` defaults to 'png';
     * `quality` (0..1) applies to lossy formats only.
     */
    export(format?: 'png' | 'jpeg' | 'webp', quality?: number): Promise<Blob>;

    /**
     * Synchronous data-URL export. Useful when the consumer needs the
     * dataURL form directly (e.g., immediate <img src> assignment).
     */
    exportDataUrl(format?: 'png' | 'jpeg' | 'webp', quality?: number): string;

    /** Current canvas dimensions. */
    getCanvasSize(): Size;

    /**
     * Set the viewport zoom centred on the canvas. Pure rendering
     * concern — does not modify image data, does not push to the
     * undo stack. The exported bytes are independent of zoom level.
     *
     * `scale = 1` is 100% (one canvas pixel per CSS pixel). Values
     * are clamped at the consumer level (the state service uses
     * 0.1..5).
     */
    setZoom(scale: number): void;

    /** Read the current viewport zoom. Returns 1 when at 100%. */
    getZoom(): number;

    /** Reset the viewport transform to the identity (zoom = 1, no pan). */
    resetZoom(): void;

    /**
     * Pan the viewport by the given pixel deltas. Pure rendering;
     * does not modify image data or push to undo. Used by the Hand
     * tool's drag handler.
     */
    pan(dx: number, dy: number): void;

    /** Current pan offset in viewport coordinates. */
    getPanOffset(): Point;

    /**
     * Set the pan offset to the given absolute viewport translation,
     * leaving the current zoom in place. Used by the state service
     * to centre the scaled image inside the visible viewport after
     * applying a new zoom factor.
     */
    setPanOffset(offset: Point): void;

    /**
     * Reset the pan offset to zero, leaving the current zoom in
     * place. Distinct from `resetZoom()`, which clears both.
     */
    resetPan(): void;

    /**
     * Compute the zoom factor that fits the image into the given
     * viewport rectangle, leaving a small margin so the image edges
     * stay visible. Not clamped: small images upscale to fit the
     * viewport, large images shrink to fit. The adapter computes
     * from image dimensions vs viewport dimensions directly.
     */
    getFitZoom(viewportSize: Size): number;

    /**
     * Set the canvas cursor. fabric.js owns its own cursor state
     * (defaultCursor / hoverCursor / moveCursor) independent of DOM
     * CSS, so a `cursor: grab` rule on the host element is silently
     * overridden by fabric's defaults. Used by the Hand tool to
     * surface grab / grabbing.
     */
    setCursor(cursor: 'default' | 'grab' | 'grabbing' | 'crosshair'): void;

    /**
     * Toggle fabric's group-selection rectangle and object hit
     * detection. Disabled when the Hand tool is active so a drag on
     * empty canvas pans instead of drawing a marquee, and so pointer
     * events don't get sniped by hit-tests against canvas objects.
     */
    setSelectionEnabled(enabled: boolean): void;

    /**
     * Set the canvas backstore + display dimensions to the given
     * viewport. Owning canvas size in the adapter (rather than
     * inheriting from a vendor's CSS auto-fit layer) is what makes
     * viewport zoom the single, predictable scale knob: small
     * images can upscale to fill the viewport without being clipped
     * by the canvas backstore, and large images shrink through the
     * same setZoom path. Recenters the loaded image on the resized
     * canvas.
     */
    setCanvasDimensions(viewport: Size): void;

    on<T extends EngineEventType>(event: T, handler: EngineEventHandler<T>): void;
    off<T extends EngineEventType>(event: T, handler?: EngineEventHandler<T>): void;

    /** Tear down the engine and free its DOM/canvas resources. */
    destroy(): void;

    /**
     * Direct access to the underlying canvas element. Escape hatch for
     * shells that need to hit the DOM API directly (pixel sampling,
     * pointer-event hookup, etc.). Most shells should not need this.
     */
    readonly canvasElement: HTMLCanvasElement | null;
}
