 
import {
    Canvas, FabricImage, Point, Rect as FabricRect, filters,
    config as fabricConfig, initFilterBackend, setFilterBackend,
    Ellipse, Line, Triangle, Polygon, Textbox, Gradient, Path,
    Control, util,
} from 'fabric/es';
import type { FabricObject, Transform } from 'fabric/es';
import type { ImageEditorEngine } from './image-editor-engine.interface';
import type { Point as PointType, Rect, Size } from '../types/geometry.types';
import type { FilterName, FilterParams } from '../types/filter.types';
import type {
    LayerInfo, LayerKind, ShapeKind, ShapeOptions, TextOptions, ObjectProps, FillSpec, MaskSpec,
    ShapeGeometry, AnnotationShapeOptions,
} from '../types/layer.types';
import { DEFAULT_SHAPE_OPTIONS, DEFAULT_TEXT_OPTIONS, DEFAULT_MASK_SPEC, MASK_PATHS } from '../types/layer.types';
import type {
    EngineEventType, EngineEventHandler, EngineEvents,
} from './engine-events';
import { CommandStack } from './command/command-stack';
import type { EngineCommand } from './command/engine-command.types';

interface FabricEngineCreateOptions {
    container: HTMLElement;
}

interface ImageTransformState {
    angle:  number;
    scaleX: number;
    scaleY: number;
    flipX:  boolean;
    flipY:  boolean;
    left:   number;
    top:    number;
}

interface VertexEditSnapshot {
    points: PointType[];
    left:   number;
    top:    number;
}

interface VertexEditState {
    obj:           Polygon;
    savedControls: Record<string, Control>;
    savedProps: {
        hasBorders:         boolean;
        lockMovementX:      boolean;
        lockMovementY:      boolean;
        cornerStyle:        'rect' | 'circle';
        cornerColor:        string;
        cornerStrokeColor:  string;
        transparentCorners: boolean;
    };
    /** Non-null while a vertex drag is in flight (snapshot for undo). */
    pointsBefore: VertexEditSnapshot | null;
}

type SliderFilterCtor = new (params: Record<string, number>) => any;
type ToggleFilterCtor = new (params?: Record<string, number>) => any;
type ConvoluteFilterCtor = new (params: { matrix: number[]; opaque?: boolean }) => any;

const SHARPEN_KERNEL: readonly number[] = [0, -1, 0, -1, 5, -1, 0, -1, 0];

/**
 * Pin the loaded image to v6's `left`/`top` origin so the
 * captureTransform snapshot/restore path and frame-overlay math
 * keep treating `image.left/image.top` as visual top-left
 * coordinates (fabric 7 default flipped to `center`/`center`).
 */
const IMAGE_ORIGIN_OPTIONS = { originX: 'left', originY: 'top' } as const;

/**
 * fabric.js v7 adapter for the CoolMS image editor.
 *
 * Mounts a fresh `<canvas>` element inside the consumer-provided
 * container and takes ownership of canvas backstore + CSS dimensions
 * so viewport zoom is the single source of truth for visual scale.
 * No vendor CSS auto-fit layer in front of fabric, so small images
 * (sub-viewport) zoom predictably and large images shrink-to-fit
 * through the same `setZoom` path.
 *
 * fabric 7 flipped the FabricObject default origin from 'left'/'top'
 * (v6) to 'center'/'center'. The crop overlay's `bounds.left/top`
 * positioning math assumes 'left'/'top' semantics, and we keep
 * `image.left/image.top` referring to the visual top-left corner so
 * the snapshot/restore captureTransform path stays a no-op. Image
 * and crop-overlay constructors below pass explicit `originX: 'left',
 * originY: 'top'` to preserve v6 behavior bit-for-bit. The frame
 * overlay mirrors `image.originX/originY` so it follows whatever the
 * image uses.
 *
 * Use `FabricEngineAdapter.create(options)` rather than `new`. The
 * factory wires up the canvas element and seeds initial dimensions
 * from the container's measured size.
 */
export class FabricEngineAdapter implements ImageEditorEngine {
    private static readonly TOGGLE_FILTERS: Partial<Record<FilterName, ToggleFilterCtor>> = {
        sepia:     filters.Sepia,
        grayscale: filters.Grayscale,
        invert:    filters.Invert,
    };

    private static readonly SLIDER_FILTERS: Partial<Record<FilterName, SliderFilterCtor>> = {
        brightness: filters.Brightness,
        contrast:   filters.Contrast,
        saturation: filters.Saturation,
        blur:       filters.Blur,
        noise:      filters.Noise,
        pixelate:   filters.Pixelate,
    };

    private readonly canvas: Canvas;
    private readonly canvasEl: HTMLCanvasElement;
    private readonly container: HTMLElement;
    /** The default annotation-shape fill; `setLayerFill(id, null)` restores it. */
    private static readonly DEFAULT_SHAPE_FILL = 'rgba(37, 99, 235, 0.20)';

    private readonly listeners = new Map<EngineEventType, Set<(data: any) => void>>();
    private readonly commandStack = new CommandStack();

    private image: FabricImage | null = null;
    private vertexEdit: VertexEditState | null = null;
    private originalSource: { url: string; name: string } | { blob: Blob; name: string } | null = null;
    private cropOverlay: FabricRect | null = null;
    private frameOverlay: FabricRect | null = null;
    private mouseTransformSnapshot: ImageTransformState | null = null;

    // --- C.1 layer model -------------------------------------------
    /** Monotonic id source for shape / text layers. */
    private nextLayerId = 1;
    /**
     * Transform snapshot for a non-image object captured on
     * `mouse:down`, so `object:modified` can build the inverse for
     * undo (mirrors `mouseTransformSnapshot` but for shapes / text).
     */
    private objTransformSnapshot: { obj: FabricObject; state: Record<string, number> } | null = null;

    private constructor(canvas: Canvas, canvasEl: HTMLCanvasElement, container: HTMLElement) {
        this.canvas = canvas;
        this.canvasEl = canvasEl;
        this.container = container;
        this.attachVendorListeners();
    }

    /**
     * Build an adapter against the given container element. Creates a
     * `<canvas>` child sized to the container and constructs a fabric
     * Canvas around it.
     */
    static async create(options: FabricEngineCreateOptions): Promise<FabricEngineAdapter> {
        const container = options.container;
        const canvasEl = document.createElement('canvas');
        canvasEl.width = Math.max(1, container.clientWidth);
        canvasEl.height = Math.max(1, container.clientHeight);
        container.appendChild(canvasEl);

        const canvas = new Canvas(canvasEl, {
            preserveObjectStacking: true,
            selection:              true,
            backgroundColor:        'transparent',
            renderOnAddRemove:      true,
        });

        return new FabricEngineAdapter(canvas, canvasEl, container);
    }

    async loadImage(source: string | Blob, name = 'image'): Promise<Size> {
        const url = typeof source === 'string'
            ? source
            : URL.createObjectURL(source);
        const ownsUrl = typeof source !== 'string';

        try {
            const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' }, IMAGE_ORIGIN_OPTIONS);
            if (this.image !== null) {
                this.canvas.remove(this.image);
            }
            // A fresh load / reset wipes annotation layers too, so the
            // canvas returns to a truly pristine single-image state.
            this.removeLayerObjects();
            this.removeFrameOverlay();
            this.image = image;
            this.stampLayer(image, 'image', 'Background');
            this.canvas.add(image);
            this.canvas.centerObject(image);
            // Reset viewport to identity so the canvas-mount's
            // imageLoaded -> applyFitZoom path computes its
            // zoomToPoint anchor from a known centered baseline.
            // Without this a prior zoom + pan persists across the
            // load and centerObject puts the image at canvas-center
            // in canvas coords but off-screen in viewport pixels.
            this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            this.addFrameOverlay();
            this.canvas.requestRenderAll();
            this.commandStack.clear();

            this.originalSource = typeof source === 'string'
                ? { url: source, name }
                : { blob: source, name };

            const size: Size = { width: image.width, height: image.height };
            this.emit('imageLoaded', size);
            this.emit('imageChanged', undefined);
            this.emit('historyStateChanged', { canUndo: false, canRedo: false });
            this.emit('layersChanged', undefined);
            this.emit('activeObjectChanged', { id: null, kind: null });
            return size;
        } finally {
            if (ownsUrl) URL.revokeObjectURL(url);
        }
    }

    async reset(): Promise<void> {
        if (this.originalSource === null) return;
        const src = this.originalSource;
        const source = 'url' in src ? src.url : src.blob;
        await this.loadImage(source, src.name);
    }

    async crop(canvasSpaceRect: Rect): Promise<void> {
        const image = this.requireImage();
        const imageBounds = image.getBoundingRect();

        // Bake current transform state (rotation, flip, filters, prior
        // crop) into a canvas at the image's bounding-rect dimensions.
        // The cropped output is then a sub-rectangle of THAT baked
        // canvas, which is what the user sees and selects with the
        // overlay. Applying the crop in image-local coordinates instead
        // would crop an axis-aligned rectangle of the un-rotated image
        // and then re-apply the rotation, producing the diamond-shaped
        // output that the engine swap surfaced.
        const baked = image.toCanvasElement({ multiplier: 1 });

        const ox = Math.max(0, canvasSpaceRect.x - imageBounds.left);
        const oy = Math.max(0, canvasSpaceRect.y - imageBounds.top);
        const ow = Math.max(1, Math.min(canvasSpaceRect.width,  imageBounds.width  - ox));
        const oh = Math.max(1, Math.min(canvasSpaceRect.height, imageBounds.height - oy));

        const target = document.createElement('canvas');
        target.width  = Math.round(ow);
        target.height = Math.round(oh);
        const ctx = target.getContext('2d');
        if (ctx === null) {
            throw new Error('FabricEngineAdapter: 2d context unavailable for crop');
        }
        ctx.drawImage(baked, ox, oy, ow, oh, 0, 0, target.width, target.height);
        const newDataUrl = target.toDataURL('image/png');

        // Capture the previous image's PIXEL state via a self-contained
        // data URL so undo can re-create the image without depending on
        // `getSrc()`. For blob-sourced loads we revoke the Object URL
        // after FabricImage.fromURL resolves, so getSrc() would return
        // an unreachable URL by the time the user clicks Undo. The
        // baked snapshot already has rotation/flip/filters applied to
        // its pixels (toCanvasElement bakes transforms by default), so
        // the restored image starts at angle 0 / no flips and still
        // looks identical to the pre-crop view.
        const prevSnapshotDataUrl = baked.toDataURL('image/png');

        // C.1e — composition-aware crop. Annotation layers must shift
        // with the cropped content so they stay aligned (and clip at the
        // new edges). Capture each layer's offset from the ORIGINAL
        // image's content top-left (`imageBounds` = image-pixel space,
        // scale 1), then re-place it relative to whatever image is
        // mounted, minus the crop offset. `placeLayers(0, 0)` (no crop
        // drop) restores the pre-crop layout on undo. Anything left of /
        // above the crop lands at a negative offset and is clipped by the
        // smaller canvas + the export flatten — no need to delete it.
        const offsets = this.layerObjects()
            .filter(o => this.layerKind(o) !== 'image')
            .map(o => ({
                obj:  o,
                left: (o.left ?? 0) - imageBounds.left,
                top:  (o.top  ?? 0) - imageBounds.top,
            }));
        const placeLayers = (originLeft: number, originTop: number, dropX: number, dropY: number): void => {
            for (const { obj, left, top } of offsets) {
                obj.set({ left: originLeft + left - dropX, top: originTop + top - dropY });
                obj.setCoords();
            }
        };

        const newImage = await FabricImage.fromURL(newDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
        this.canvas.remove(image);
        this.replaceImage(newImage);
        placeLayers(newImage.left ?? 0, newImage.top ?? 0, ox, oy);
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: 'crop',
            do: async () => {
                if (this.image === newImage) return;
                this.canvas.remove(this.requireImage());
                const replay = await FabricImage.fromURL(newDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
                this.replaceImage(replay);
                placeLayers(replay.left ?? 0, replay.top ?? 0, ox, oy);
                this.canvas.requestRenderAll();
            },
            undo: async () => {
                this.canvas.remove(this.requireImage());
                const restored = await FabricImage.fromURL(prevSnapshotDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
                this.replaceImage(restored);
                placeLayers(restored.left ?? 0, restored.top ?? 0, 0, 0);
                this.canvas.requestRenderAll();
            },
        });
    }

    async enterCropMode(): Promise<void> {
        const image = this.requireImage();
        if (this.cropOverlay !== null) return;

        // Lock the image so the user can only interact with the crop
        // overlay's handles. Without this, clicking the image inside
        // the crop region would steal the active object from the
        // overlay and turn the gesture into a stray image drag. Lock
        // the annotation layers too (C.1e) so a stray click on a shape
        // can't hijack the crop gesture.
        image.selectable = false;
        image.evented    = false;
        this.setLayersInteractive(false);

        // Hide the canvas frame so the crop overlay's dashed outline
        // is the only rectangle competing for the user's attention.
        if (this.frameOverlay !== null) {
            this.frameOverlay.visible = false;
        }

        const bounds = image.getBoundingRect();
        const overlay = new FabricRect({
            // Pin to v6 left/top origin so `bounds.left/top` place
            // the overlay's visual top-left at the image AABB corner
            // (fabric 7's default center/center would offset it by
            // half the overlay's size).
            originX:             'left',
            originY:             'top',
            left:                bounds.left,
            top:                 bounds.top,
            width:               bounds.width,
            height:              bounds.height,
            fill:                'rgba(0,0,0,0)',
            stroke:              '#ffffff',
            strokeDashArray:     [4, 4],
            strokeUniform:       true,
            cornerStyle:         'circle',
            // Literal on purpose: Fabric paints to a CANVAS, which resolves no
            // CSS custom properties — `var(--cms-text-inverse)` would render as
            // nothing. A tokenising pass swapped this once and it had
            // to be put back; keep it a literal, or thread the resolved value
            // through `getComputedStyle` if it ever needs to follow the theme.
            cornerColor:         '#ffffff',
            cornerStrokeColor:   '#000000',
            transparentCorners:  false,
            lockRotation:        true,
            hasRotatingPoint:    false,
            centeredScaling:     false,
            objectCaching:       false,
        } as any);
        this.cropOverlay = overlay;
        this.canvas.add(overlay);
        this.canvas.setActiveObject(overlay);
        this.canvas.requestRenderAll();
    }

    async exitCropMode(): Promise<void> {
        if (this.cropOverlay !== null) {
            this.canvas.remove(this.cropOverlay);
            this.cropOverlay = null;
        }
        if (this.image !== null) {
            this.image.selectable = true;
            this.image.evented    = true;
        }
        this.setLayersInteractive(true);
        if (this.frameOverlay !== null) {
            this.frameOverlay.visible = true;
            this.syncFrameOverlay();
        }
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
    }

    /** Toggle selectability of the annotation layers (used by crop mode). */
    private setLayersInteractive(enabled: boolean): void {
        for (const o of this.layerObjects()) {
            if (this.layerKind(o) === 'image') continue;
            o.selectable = enabled;
            o.evented    = enabled;
        }
    }

    setCropAspectRatio(ratio: number | null): void {
        const overlay = this.cropOverlay;
        const image = this.image;
        if (overlay === null || image === null) return;

        if (ratio === null) {
            (overlay as any).lockUniScaling = false;
            this.canvas.requestRenderAll();
            return;
        }

        const bounds = image.getBoundingRect();
        const fitW = Math.min(bounds.width, bounds.height * ratio);
        const fitH = fitW / ratio;
        overlay.set({
            left:   bounds.left + (bounds.width - fitW) / 2,
            top:    bounds.top + (bounds.height - fitH) / 2,
            width:  fitW,
            height: fitH,
            scaleX: 1,
            scaleY: 1,
        });
        (overlay as any).lockUniScaling = true;
        overlay.setCoords();
        this.canvas.requestRenderAll();
    }

    getCropRect(): Rect | null {
        const overlay = this.cropOverlay;
        if (overlay === null) return null;
        // Return the overlay's axis-aligned bounding box in canvas
        // coordinate space (no viewport zoom/pan). `crop()` consumes
        // this directly: it bakes the rotated/flipped image to a
        // canvas at its bounding-rect dimensions, then extracts the
        // sub-region the overlay covers within that baked canvas.
        const bounds = overlay.getBoundingRect();
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        return {
            x:      bounds.left,
            y:      bounds.top,
            width:  bounds.width,
            height: bounds.height,
        };
    }

    async rotate(degrees: number): Promise<void> {
        // C.1c: a selected shape / text layer is the rotate target;
        // otherwise the base image (the original whole-image behaviour).
        const layer = this.activeNonImageLayer();
        if (layer !== null) {
            this.rotateLayer(layer, degrees);
            return;
        }
        const image = this.requireImage();
        const previousAngle = image.angle ?? 0;
        const targetAngle = previousAngle + degrees;
        const applyForward = (): void => {
            image.rotate(targetAngle);
            image.setCoords();
            this.canvas.requestRenderAll();
            this.emitImageTransformed(image, 'sidebar');
        };
        applyForward();
        this.pushCommand({
            name: 'rotate',
            do:   () => { applyForward(); },
            undo: () => {
                image.rotate(previousAngle);
                image.setCoords();
                this.canvas.requestRenderAll();
                this.emitImageTransformed(image, 'sidebar');
            },
        });
    }

    async flip(axis: 'horizontal' | 'vertical'): Promise<void> {
        // C.1c: flip the selected non-image layer when one is active,
        // else the base image.
        const layer = this.activeNonImageLayer();
        if (layer !== null) {
            this.flipLayer(layer, axis);
            return;
        }
        const image = this.requireImage();
        const prop: 'flipX' | 'flipY' = axis === 'horizontal' ? 'flipX' : 'flipY';
        const previous = image[prop] ?? false;
        const applyForward = (): void => {
            image[prop] = !previous;
            image.setCoords();
            this.canvas.requestRenderAll();
            this.emitImageTransformed(image, 'sidebar');
        };
        applyForward();
        this.pushCommand({
            name: `flip-${axis}`,
            do:   () => { applyForward(); },
            undo: () => {
                image[prop] = previous;
                image.setCoords();
                this.canvas.requestRenderAll();
                this.emitImageTransformed(image, 'sidebar');
            },
        });
    }

    async resize(size: Size): Promise<void> {
        const image = this.requireImage();
        const imageBounds = image.getBoundingRect();
        const baked = image.toCanvasElement({ multiplier: 1 });

        const target = document.createElement('canvas');
        target.width  = Math.max(1, Math.round(size.width));
        target.height = Math.max(1, Math.round(size.height));
        const ctx = target.getContext('2d');
        if (ctx === null) {
            throw new Error('FabricEngineAdapter: 2d context unavailable for resize');
        }
        ctx.drawImage(baked, 0, 0, target.width, target.height);
        const newDataUrl = target.toDataURL('image/png');

        // Self-contained snapshot of the pre-resize state so undo
        // doesn't depend on the original source URL (which may have
        // been a revoked blob URL for VFS-loaded images).
        const prevSnapshotDataUrl = baked.toDataURL('image/png');

        // C.1f — composition-aware resize. Like crop (C.1e), annotation
        // layers must move with the base image so they stay aligned; but
        // resize ALSO scales the image, so a shape / text layer has to
        // grow or shrink in step (crop is a pure translation, resize is a
        // translation *and* a scale). Capture each layer's offset from the
        // ORIGINAL image's content top-left (`imageBounds` = displayed
        // canvas-space) plus its own scaleX/scaleY, and the resize factor
        // (new pixel size ÷ old displayed size). `scaleLayers(originLeft,
        // originTop, sx, sy)` re-places each layer at
        // `image-top-left + offset*factor` and multiplies its scaleX/scaleY
        // by the factor (origin-center, so it grows about its own centre —
        // matching a handle-resize). `scaleLayers(…, 1, 1)` on undo
        // restores the captured pre-resize position + size verbatim.
        const sx = target.width  / Math.max(1, imageBounds.width);
        const sy = target.height / Math.max(1, imageBounds.height);
        const offsets = this.layerObjects()
            .filter(o => this.layerKind(o) !== 'image')
            .map(o => ({
                obj:    o,
                left:   (o.left   ?? 0) - imageBounds.left,
                top:    (o.top    ?? 0) - imageBounds.top,
                scaleX: o.scaleX ?? 1,
                scaleY: o.scaleY ?? 1,
            }));
        const scaleLayers = (originLeft: number, originTop: number, factorX: number, factorY: number): void => {
            for (const { obj, left, top, scaleX, scaleY } of offsets) {
                obj.set({
                    left:   originLeft + left * factorX,
                    top:    originTop  + top  * factorY,
                    scaleX: scaleX * factorX,
                    scaleY: scaleY * factorY,
                });
                obj.setCoords();
            }
        };

        const newImage = await FabricImage.fromURL(newDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
        this.canvas.remove(image);
        this.replaceImage(newImage);
        scaleLayers(newImage.left ?? 0, newImage.top ?? 0, sx, sy);
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: 'resize',
            do: async () => {
                if (this.image === newImage) return;
                this.canvas.remove(this.requireImage());
                const replay = await FabricImage.fromURL(newDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
                this.replaceImage(replay);
                scaleLayers(replay.left ?? 0, replay.top ?? 0, sx, sy);
                this.canvas.requestRenderAll();
            },
            undo: async () => {
                this.canvas.remove(this.requireImage());
                const restored = await FabricImage.fromURL(prevSnapshotDataUrl, undefined, IMAGE_ORIGIN_OPTIONS);
                this.replaceImage(restored);
                scaleLayers(restored.left ?? 0, restored.top ?? 0, 1, 1);
                this.canvas.requestRenderAll();
            },
        });
    }

    async applyFilter(name: FilterName, params: FilterParams = {}): Promise<void> {
        const image = this.requireImage();
        this.ensureFilterBackendFitsImage(image);
        const ctorTag = this.resolveFilterCtor(name);
        const newFilter = this.instantiateFilter(name, params);

        const existingIndex = image.filters.findIndex(f => (f as any) instanceof ctorTag);
        const previousFilter = existingIndex >= 0 ? image.filters[existingIndex] : null;

        const applyForward = (): void => {
            if (existingIndex >= 0) {
                image.filters[existingIndex] = newFilter;
            } else {
                image.filters.push(newFilter);
            }
            image.applyFilters();
            this.canvas.requestRenderAll();
        };
        applyForward();

        this.pushCommand({
            name: `filter-${name}`,
            do:   () => { applyForward(); },
            undo: () => {
                if (previousFilter !== null) {
                    const idx = image.filters.indexOf(newFilter);
                    if (idx >= 0) image.filters[idx] = previousFilter;
                } else {
                    const idx = image.filters.indexOf(newFilter);
                    if (idx >= 0) image.filters.splice(idx, 1);
                }
                image.applyFilters();
                this.canvas.requestRenderAll();
            },
        });
    }

    async removeFilter(name: FilterName): Promise<void> {
        const image = this.requireImage();
        this.ensureFilterBackendFitsImage(image);
        const ctorTag = this.resolveFilterCtor(name);
        const idx = image.filters.findIndex(f => (f as any) instanceof ctorTag);
        if (idx < 0) return;

        const removed = image.filters[idx];
        const applyForward = (): void => {
            const at = image.filters.indexOf(removed);
            if (at >= 0) image.filters.splice(at, 1);
            image.applyFilters();
            this.canvas.requestRenderAll();
        };
        applyForward();

        this.pushCommand({
            name: `filter-remove-${name}`,
            do:   () => { applyForward(); },
            undo: () => {
                if (!image.filters.includes(removed)) {
                    image.filters.splice(idx, 0, removed);
                }
                image.applyFilters();
                this.canvas.requestRenderAll();
            },
        });
    }

    hasFilter(name: FilterName): boolean {
        if (this.image === null) return false;
        const ctorTag = this.resolveFilterCtor(name);
        return this.image.filters.some(f => (f as any) instanceof ctorTag);
    }

    // --- Layers / objects (C.1) -------------------------------------

    addShape(kind: ShapeKind, opts: Partial<ShapeOptions> = {}): void {
        const o: ShapeOptions = { ...DEFAULT_SHAPE_OPTIONS, ...opts };
        this.placeAndAdd(this.createShape(kind, o), 'shape', this.shapeLabel(kind));
    }

    addText(opts: Partial<TextOptions> = {}): void {
        const o: TextOptions = { ...DEFAULT_TEXT_OPTIONS, ...opts };
        const text = new Textbox(o.text, {
            width:      Math.min(420, (this.image?.width ?? 600) * 0.6),
            fontFamily: o.fontFamily,
            fontSize:   o.fontSize,
            fill:       this.resolveFill(o.fillSpec, o.fill),
            fontWeight: o.fontWeight,
            fontStyle:  o.fontStyle,
            textAlign:  o.textAlign,
        });
        this.placeAndAdd(text, 'text', 'Text');
    }

    // --- Annotation-authoring seams ---------------------------------

    getImageBounds(): Rect | null {
        if (this.image === null) return null;
        const b = this.image.getBoundingRect();
        return { x: b.left, y: b.top, width: b.width, height: b.height };
    }

    addShapeAt(geometry: ShapeGeometry, opts: AnnotationShapeOptions = {}): string {
        const style = {
            fill:          opts.fill        ?? FabricEngineAdapter.DEFAULT_SHAPE_FILL,
            stroke:        opts.stroke      ?? '#2563eb',
            strokeWidth:   opts.strokeWidth ?? 2,
            // Keep the border width constant under interactive scaling —
            // geometry consumers read the shape's box, not its stroke.
            strokeUniform: true,
        };
        let obj: FabricObject;
        switch (geometry.kind) {
            case 'rect':
                obj = new FabricRect({
                    ...style,
                    left:    geometry.rect.x,
                    top:     geometry.rect.y,
                    width:   geometry.rect.width,
                    height:  geometry.rect.height,
                    originX: 'left',
                    originY: 'top',
                });
                break;
            case 'ellipse':
                obj = new Ellipse({
                    ...style,
                    left:    geometry.center.x,
                    top:     geometry.center.y,
                    rx:      geometry.rx,
                    ry:      geometry.ry,
                    originX: 'center',
                    originY: 'center',
                });
                break;
            case 'polygon':
                obj = new Polygon(geometry.points.map(p => ({ x: p.x, y: p.y })), { ...style });
                break;
        }
        if (opts.lockRotation === true) {
            obj.setControlsVisibility({ mtr: false });
        }
        if (opts.lockNonUniformScaling === true) {
            obj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
        }
        obj.setCoords();

        const name = opts.name ?? geometry.kind;
        this.stampLayer(obj, 'shape', name);
        this.canvas.add(obj);
        this.keepImageAtBack();
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: `add ${name}`,
            do: () => {
                this.canvas.add(obj);
                this.keepImageAtBack();
                this.canvas.setActiveObject(obj);
                this.canvas.requestRenderAll();
                this.afterLayerMutation();
            },
            undo: () => {
                this.canvas.remove(obj);
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
                this.afterLayerMutation();
            },
        });
        this.afterLayerMutation();
        return this.layerId(obj);
    }

    getShapeGeometry(id: string): ShapeGeometry | null {
        const obj = this.findLayer(id);
        if (obj === null || this.layerKind(obj) !== 'shape') return null;

        if (obj instanceof Ellipse) {
            const c = obj.getCenterPoint();
            return {
                kind:   'ellipse',
                center: { x: c.x, y: c.y },
                rx:     (obj.rx ?? 0) * (obj.scaleX ?? 1),
                ry:     (obj.ry ?? 0) * (obj.scaleY ?? 1),
            };
        }
        if (obj instanceof Polygon) {
            const m = obj.calcTransformMatrix();
            const points = (obj.points ?? [])
                .map(p => new Point(p.x - obj.pathOffset.x, p.y - obj.pathOffset.y).transform(m))
                .map(p => ({ x: p.x, y: p.y }));
            return { kind: 'polygon', points };
        }
        if (obj instanceof FabricRect) {
            // Axis-aligned box from the center point, ignoring rotation
            // (annotation rects ship lockRotation — see the interface).
            const w = (obj.width  ?? 0) * (obj.scaleX ?? 1);
            const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
            const c = obj.getCenterPoint();
            return { kind: 'rect', rect: { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h } };
        }
        return null;
    }

    setVertexEditing(id: string, enabled: boolean): boolean {
        const obj = this.findLayer(id);
        if (obj === null || !(obj instanceof Polygon) || this.layerKind(obj) !== 'shape') return false;
        if (enabled) {
            if (this.vertexEdit?.obj === obj) return true;
            if (this.vertexEdit !== null) this.exitVertexEdit();
            this.enterVertexEdit(obj);
        } else if (this.vertexEdit?.obj === obj) {
            this.exitVertexEdit();
        }
        this.canvas.requestRenderAll();
        return true;
    }

    /**
     * Swap the polygon's default handles for one draggable Control per
     * vertex — the official fabric "custom polygon controls" pattern:
     * `positionHandler` projects `points[i]` through viewport × object
     * transform; `actionHandler` writes the pointer back into
     * `points[i]` (object-local, stroke-compensated) and re-anchors the
     * polygon on a neighbouring vertex after `setDimensions()` so the
     * shape doesn't jump while its bounding box is recomputed.
     */
    private enterVertexEdit(polygon: Polygon): void {
        const savedControls = polygon.controls;
        const savedProps = {
            hasBorders:         polygon.hasBorders,
            lockMovementX:      polygon.lockMovementX,
            lockMovementY:      polygon.lockMovementY,
            cornerStyle:        polygon.cornerStyle,
            cornerColor:        polygon.cornerColor,
            cornerStrokeColor:  polygon.cornerStrokeColor,
            transparentCorners: polygon.transparentCorners,
        };

        this.rebuildVertexControls(polygon);
        polygon.hasBorders = false;
        // Vertices are the ONLY interaction in edit mode — whole-shape
        // dragging would fight the per-point handles.
        polygon.lockMovementX = true;
        polygon.lockMovementY = true;
        // Filled white dots with a blue ring — fabric's default
        // transparentCorners renders outline-only handles that vanish
        // against same-hue shapes.
        polygon.cornerStyle = 'circle';
        polygon.transparentCorners = false;
        polygon.cornerColor = '#ffffff';
        polygon.cornerStrokeColor = '#2563eb';
        polygon.setCoords();
        this.canvas.setActiveObject(polygon);
        this.vertexEdit = { obj: polygon, savedControls, savedProps, pointsBefore: null };
    }

    private exitVertexEdit(): void {
        const edit = this.vertexEdit;
        if (edit === null) return;
        const obj = edit.obj;
        obj.controls = edit.savedControls;
        obj.hasBorders = edit.savedProps.hasBorders;
        obj.lockMovementX = edit.savedProps.lockMovementX;
        obj.lockMovementY = edit.savedProps.lockMovementY;
        obj.cornerStyle = edit.savedProps.cornerStyle;
        obj.cornerColor = edit.savedProps.cornerColor;
        obj.cornerStrokeColor = edit.savedProps.cornerStrokeColor;
        obj.transparentCorners = edit.savedProps.transparentCorners;
        obj.setCoords();
        this.vertexEdit = null;
    }

    private vertexControlPosition(polygon: Polygon, index: number): Point {
        const p = (polygon.points ?? [])[index] ?? { x: 0, y: 0 };
        return new Point(p.x - polygon.pathOffset.x, p.y - polygon.pathOffset.y).transform(
            util.multiplyTransformMatrices(
                polygon.canvas?.viewportTransform ?? [1, 0, 0, 1, 0, 0],
                polygon.calcTransformMatrix(),
            ),
        );
    }

    private moveVertex(transform: Transform, index: number, x: number, y: number): boolean {
        const polygon = transform.target;
        if (!(polygon instanceof Polygon)) return false;
        const points = polygon.points ?? [];
        if (points.length < 3 || index >= points.length) return false;

        // Anchor: keep a NEIGHBOURING vertex visually fixed across the
        // setDimensions() bounding-box recompute.
        const anchorIndex = index > 0 ? index - 1 : points.length - 1;
        const anchorAbs = new Point(
            points[anchorIndex].x - polygon.pathOffset.x,
            points[anchorIndex].y - polygon.pathOffset.y,
        ).transform(polygon.calcTransformMatrix());

        // Scene -> object-center-local (v7 dropped toLocalPoint; the
        // inverse of calcTransformMatrix is its center-origin equivalent).
        const local = new Point(x, y).transform(util.invertTransform(polygon.calcTransformMatrix()));
        const size = this.polygonSizeWithStroke(polygon);
        points[index] = {
            x: local.x * ((polygon.width ?? 0) / size.x) + polygon.pathOffset.x,
            y: local.y * ((polygon.height ?? 0) / size.y) + polygon.pathOffset.y,
        };
        polygon.setDimensions();

        const sizeAfter = this.polygonSizeWithStroke(polygon);
        const newX = (points[anchorIndex].x - polygon.pathOffset.x) / sizeAfter.x;
        const newY = (points[anchorIndex].y - polygon.pathOffset.y) / sizeAfter.y;
        polygon.setPositionByOrigin(anchorAbs, newX + 0.5, newY + 0.5);
        polygon.setCoords();
        return true;
    }

    /**
     * (Re)build one draggable Control per vertex — used on entering vertex
     * edit AND after a topology change (add/remove) so the `vertexN` controls
     * stay index-aligned with the current `points` array.
     */
    private rebuildVertexControls(polygon: Polygon): void {
        const controls: Record<string, Control> = {};
        (polygon.points ?? []).forEach((_, i) => {
            controls['vertex' + i] = new Control({
                actionName: 'modifyPolygonVertex',
                positionHandler: (dim, finalMatrix, fabricObject) =>
                    this.vertexControlPosition(fabricObject as Polygon, i),
                actionHandler: (eventData, transform, x, y) => this.moveVertex(transform, i, x, y),
                mouseDownHandler: () => { this.vertexDragStart(polygon); return true; },
                mouseUpHandler:   () => { this.vertexDragEnd(polygon); return true; },
            });
        });
        polygon.controls = controls;
    }

    addVertexAt(id: string, sceneX: number, sceneY: number): boolean {
        const polygon = this.findLayer(id);
        if (this.vertexEdit === null || !(polygon instanceof Polygon) || this.vertexEdit.obj !== polygon) return false;
        const points = polygon.points ?? [];
        if (points.length < 3) return false;

        // Scene -> object-local point-space (mirrors moveVertex).
        const local = new Point(sceneX, sceneY).transform(util.invertTransform(polygon.calcTransformMatrix()));
        const size = this.polygonSizeWithStroke(polygon);
        const target = {
            x: local.x * ((polygon.width ?? 0) / size.x) + polygon.pathOffset.x,
            y: local.y * ((polygon.height ?? 0) / size.y) + polygon.pathOffset.y,
        };

        // Project onto the NEAREST edge (segment i->i+1) and insert the
        // projected point after i — a collinear insert, so the polygon's
        // outline is unchanged; it just gains a handle to drag.
        let bestIndex = 0;
        let bestDistSq = Infinity;
        let bestPoint: PointType = { x: points[0].x, y: points[0].y };
        for (let i = 0; i < points.length; i++) {
            const proj = this.projectOnSegment(target, points[i], points[(i + 1) % points.length]);
            const dx = proj.x - target.x;
            const dy = proj.y - target.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) { bestDistSq = distSq; bestIndex = i; bestPoint = proj; }
        }

        const before = points.map(p => ({ x: p.x, y: p.y }));
        const after = before.slice();
        after.splice(bestIndex + 1, 0, bestPoint);

        this.applyVertexTopology(polygon, after);
        this.pushCommand({
            name: 'add vertex',
            do:   () => this.applyVertexTopology(polygon, after),
            undo: () => this.applyVertexTopology(polygon, before),
        });
        this.canvas.requestRenderAll();
        return true;
    }

    removeVertexAt(id: string, sceneX: number, sceneY: number): boolean {
        const polygon = this.findLayer(id);
        if (this.vertexEdit === null || !(polygon instanceof Polygon) || this.vertexEdit.obj !== polygon) return false;
        const points = polygon.points ?? [];
        // A polygon needs at least 3 vertices — never remove past that floor.
        if (points.length <= 3) return false;

        // Scene -> object-local point-space (mirrors addVertexAt / moveVertex).
        const local = new Point(sceneX, sceneY).transform(util.invertTransform(polygon.calcTransformMatrix()));
        const size = this.polygonSizeWithStroke(polygon);
        const target = {
            x: local.x * ((polygon.width ?? 0) / size.x) + polygon.pathOffset.x,
            y: local.y * ((polygon.height ?? 0) / size.y) + polygon.pathOffset.y,
        };

        // Nearest vertex to the click.
        let bestIndex = 0;
        let bestDistSq = Infinity;
        for (let i = 0; i < points.length; i++) {
            const dx = points[i].x - target.x;
            const dy = points[i].y - target.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) { bestDistSq = distSq; bestIndex = i; }
        }

        // Only remove when the click landed ON a handle — within a fraction
        // of the polygon's own size. Otherwise return false so the caller
        // falls through to addVertexAt (which targets the OUTLINE). Scaling
        // the threshold to the shape keeps it zoom- and size-independent.
        const w = polygon.width ?? 0;
        const h = polygon.height ?? 0;
        const threshold = 0.10 * Math.hypot(w, h);
        if (Math.sqrt(bestDistSq) > threshold) return false;

        const before = points.map(p => ({ x: p.x, y: p.y }));
        const after = before.slice();
        after.splice(bestIndex, 1);
        // The surviving anchor vertex: after[0] is before[fromIdx] — removing
        // vertex 0 shifts everyone down, so it lives at before-index 1 then.
        const fromIdx = bestIndex === 0 ? 1 : 0;

        this.applyVertexTopology(polygon, after, fromIdx, 0);
        this.pushCommand({
            name: 'remove vertex',
            do:   () => this.applyVertexTopology(polygon, after, fromIdx, 0),
            undo: () => this.applyVertexTopology(polygon, before, 0, fromIdx),
        });
        this.canvas.requestRenderAll();
        return true;
    }

    /** Closest point on segment `a->b` to `p` (all object-local coords). */
    private projectOnSegment(p: PointType, a: PointType, b: PointType): PointType {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const denom = abx * abx + aby * aby;
        let t = denom === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / denom;
        t = Math.max(0, Math.min(1, t));
        return { x: a.x + t * abx, y: a.y + t * aby };
    }

    /**
     * Replace the polygon's `points` and re-index its vertex controls,
     * keeping one SURVIVING vertex visually fixed across the
     * `setDimensions()` bbox recompute so the shape never jumps.
     *
     * `fromIndex` is the anchor vertex's index in the CURRENT points,
     * `toIndex` its index in the NEW `pts` — the two must be the SAME
     * vertex. For an insert (add) or the identity case both are 0 (the
     * defaults). A removal that drops vertex 0 shifts every later vertex
     * down one, so its surviving anchor lives at different indices before
     * vs after — hence the explicit pair.
     */
    private applyVertexTopology(polygon: Polygon, pts: PointType[], fromIndex = 0, toIndex = 0): void {
        const current = polygon.points ?? [];
        const anchorAbs = new Point(
            (current[fromIndex]?.x ?? 0) - polygon.pathOffset.x,
            (current[fromIndex]?.y ?? 0) - polygon.pathOffset.y,
        ).transform(polygon.calcTransformMatrix());

        polygon.points = pts.map(p => ({ x: p.x, y: p.y }));
        polygon.setDimensions();

        const sizeAfter = this.polygonSizeWithStroke(polygon);
        const newX = ((polygon.points[toIndex]?.x ?? 0) - polygon.pathOffset.x) / sizeAfter.x;
        const newY = ((polygon.points[toIndex]?.y ?? 0) - polygon.pathOffset.y) / sizeAfter.y;
        polygon.setPositionByOrigin(anchorAbs, newX + 0.5, newY + 0.5);

        this.rebuildVertexControls(polygon);
        polygon.setCoords();
    }

    private polygonSizeWithStroke(polygon: Polygon): Point {
        const strokeWidth = polygon.strokeWidth ?? 0;
        const sx = polygon.strokeUniform === true ? strokeWidth / (polygon.scaleX ?? 1) : strokeWidth;
        const sy = polygon.strokeUniform === true ? strokeWidth / (polygon.scaleY ?? 1) : strokeWidth;
        return new Point((polygon.width ?? 0) + sx, (polygon.height ?? 0) + sy);
    }

    private vertexDragStart(polygon: Polygon): void {
        if (this.vertexEdit?.obj !== polygon) return;
        this.vertexEdit.pointsBefore = {
            points: (polygon.points ?? []).map(p => ({ x: p.x, y: p.y })),
            left:   polygon.left ?? 0,
            top:    polygon.top ?? 0,
        };
    }

    private vertexDragEnd(polygon: Polygon): void {
        const edit = this.vertexEdit;
        if (edit?.obj !== polygon || edit.pointsBefore === null) return;
        const before = edit.pointsBefore;
        edit.pointsBefore = null;

        const after = {
            points: (polygon.points ?? []).map(p => ({ x: p.x, y: p.y })),
            left:   polygon.left ?? 0,
            top:    polygon.top ?? 0,
        };
        const unchanged = before.points.length === after.points.length
            && before.points.every((p, i) => p.x === after.points[i].x && p.y === after.points[i].y);
        if (unchanged) return;

        // The drag already happened — record it for undo/redo only
        // (pushCommand does not invoke do()), like addShapeAt.
        const apply = (state: VertexEditSnapshot) => {
            polygon.points = state.points.map(p => ({ x: p.x, y: p.y }));
            polygon.setDimensions();
            polygon.set({ left: state.left, top: state.top });
            polygon.setCoords();
            this.canvas.requestRenderAll();
        };
        this.pushCommand({
            name: 'move vertex',
            do:   () => apply(after),
            undo: () => apply(before),
        });
    }

    getLayers(): LayerInfo[] {
        // Canvas order is bottom->top; the panel lists top->bottom.
        return this.layerObjects()
            .slice()
            .reverse()
            .map(o => ({
                id:      this.layerId(o),
                kind:    this.layerKind(o),
                name:    this.layerName(o),
                visible: o.visible !== false,
                opacity: o.opacity ?? 1,
                locked:  this.layerKind(o) === 'image',
            }));
    }

    getActiveLayerId(): string | null {
        const active = this.canvas.getActiveObject();
        return active ? (this.layerId(active) || null) : null;
    }

    selectLayer(id: string | null): void {
        if (id === null) {
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();
            this.emitActiveFromCanvas();
            return;
        }
        const obj = this.findLayer(id);
        if (obj === null) return;
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();
        this.emitActiveFromCanvas();
    }

    setLayerFill(id: string, fill: string | null): void {
        const obj = this.findLayer(id);
        if (obj === null || this.layerKind(obj) === 'image') return;
        // A transient PREVIEW tint (status overlay etc.) — NOT recorded as an
        // undoable command and NOT part of getShapeGeometry (fill is style, not
        // geometry), so it never touches what the save-diff persists. Passing
        // null restores the default region fill.
        obj.set('fill', fill ?? FabricEngineAdapter.DEFAULT_SHAPE_FILL);
        this.canvas.requestRenderAll();
    }

    removeLayer(id: string): void {
        const obj = this.findLayer(id);
        if (obj === null || this.layerKind(obj) === 'image') return;

        const wasActive = this.canvas.getActiveObject() === obj;
        this.canvas.remove(obj);
        if (wasActive) this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: 'delete layer',
            do: () => {
                this.canvas.remove(obj);
                this.canvas.discardActiveObject();
                this.afterLayerMutation();
            },
            undo: () => {
                this.canvas.add(obj);
                this.keepImageAtBack();
                this.afterLayerMutation();
            },
        });
        this.afterLayerMutation();
    }

    setLayerVisibility(id: string, visible: boolean): void {
        const obj = this.findLayer(id);
        if (obj === null) return;
        const before = obj.visible !== false;
        if (before === visible) return;
        obj.visible = visible;
        this.canvas.requestRenderAll();
        this.pushCommand({
            name: 'toggle visibility',
            do:   () => { obj.visible = visible; this.afterLayerMutation(); },
            undo: () => { obj.visible = before;  this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    setLayerOpacity(id: string, opacity: number): void {
        const obj = this.findLayer(id);
        if (obj === null) return;
        const next = Math.min(1, Math.max(0, opacity));
        const before = obj.opacity ?? 1;
        if (before === next) return;
        obj.set({ opacity: next });
        this.canvas.requestRenderAll();
        this.pushCommand({
            name: 'opacity',
            do:   () => { obj.set({ opacity: next });   this.afterLayerMutation(); },
            undo: () => { obj.set({ opacity: before }); this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    reorderLayer(id: string, direction: 'up' | 'down' | 'front' | 'back'): void {
        const obj = this.findLayer(id);
        if (obj === null || this.layerKind(obj) === 'image') return;

        const beforeIndex = this.canvas.getObjects().indexOf(obj);
        switch (direction) {
            case 'up':    this.canvas.bringObjectForward(obj);  break;
            case 'down':  this.canvas.sendObjectBackwards(obj); break;
            case 'front': this.canvas.bringObjectToFront(obj);  break;
            case 'back':  this.canvas.sendObjectToBack(obj);    break;
        }
        // The base image is the canvas floor; a "send to back" lands a
        // shape just above it, never below.
        this.keepImageAtBack();
        const afterIndex = this.canvas.getObjects().indexOf(obj);
        this.canvas.requestRenderAll();
        if (afterIndex === beforeIndex) { this.afterLayerMutation(); return; }

        this.pushCommand({
            name: 'reorder layer',
            do:   () => { this.canvas.moveObjectTo(obj, afterIndex);  this.keepImageAtBack(); this.afterLayerMutation(); },
            undo: () => { this.canvas.moveObjectTo(obj, beforeIndex); this.keepImageAtBack(); this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    getActiveObjectProps(): ObjectProps | null {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) return null;
        const kind = this.layerKind(active);
        if (kind === 'image' || this.layerId(active) === '') return null;

        if (kind === 'text') {
            const t = active as Textbox;
            return {
                text:       t.text ?? '',
                fontFamily: t.fontFamily ?? 'Arial',
                fontSize:   t.fontSize ?? 48,
                fill:       this.fillToHex(t.fill),
                fontWeight: t.fontWeight ?? 'normal',
                fontStyle:  t.fontStyle ?? 'normal',
                textAlign:  t.textAlign ?? 'left',
                opacity:    active.opacity ?? 1,
            };
        }
        return {
            fill:        this.fillToHex(active.fill),
            stroke:      (active.stroke as string) ?? '',
            strokeWidth: active.strokeWidth ?? 0,
            opacity:     active.opacity ?? 1,
        };
    }

    getActiveObjectFill(): FillSpec | null {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) return null;
        if (this.layerKind(active) === 'image' || this.layerId(active) === '') return null;
        return this.readFill(active.fill);
    }

    setActiveObjectFill(spec: FillSpec): void {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) return;
        if (this.layerKind(active) === 'image' || this.layerId(active) === '') return;

        const before = active.get('fill');
        const next = this.buildFill(spec);
        const apply = (val: unknown): void => {
            active.set('fill', val as any);
            active.setCoords();
            this.canvas.requestRenderAll();
        };
        apply(next);

        this.pushCommand({
            name: 'fill layer',
            do:   () => { apply(next);   this.afterLayerMutation(); },
            undo: () => { apply(before); this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    // --- Per-layer transforms + masking (C.1c) ----------------------

    getActiveLayerTransform(): { angle: number; flipX: boolean; flipY: boolean } | null {
        const layer = this.activeNonImageLayer();
        if (layer === null) return null;
        return {
            angle: layer.angle ?? 0,
            flipX: layer.flipX ?? false,
            flipY: layer.flipY ?? false,
        };
    }

    setMask(spec: MaskSpec): void {
        const target = this.maskTarget();
        if (target === null) return;

        // fabric types `clipPath` with a looser object generic than the
        // default `FabricObject`; cast so the restore-path assignment
        // type-checks against `buildClipPath`'s return.
        const before     = (target.clipPath ?? null) as FabricObject | null;
        const beforeStamp = (target as unknown as Record<string, unknown>)['coolmsMask'] ?? null;
        const apply = (clip: FabricObject | null, stamp: unknown): void => {
            // fabric reads `clipPath` directly; `dirty` busts the object
            // cache so the new clip actually re-renders.
            (target as unknown as Record<string, unknown>)['clipPath']  = clip ?? undefined;
            (target as unknown as Record<string, unknown>)['coolmsMask'] = stamp ?? undefined;
            target.set({ dirty: true });
            target.setCoords();
            this.canvas.requestRenderAll();
        };

        const nextStamp = spec.shape === 'none' ? null : { ...spec };
        apply(this.buildClipPath(target, spec), nextStamp);

        this.pushCommand({
            name: 'mask',
            do:   () => { apply(this.buildClipPath(target, spec), nextStamp); this.afterLayerMutation(); },
            undo: () => { apply(before, beforeStamp); this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    getMask(): MaskSpec | null {
        const target = this.maskTarget();
        if (target === null) return null;
        const stamp = (target as unknown as Record<string, unknown>)['coolmsMask'];
        if (stamp !== null && typeof stamp === 'object') {
            return { ...DEFAULT_MASK_SPEC, ...(stamp as Partial<MaskSpec>) };
        }
        return { ...DEFAULT_MASK_SPEC };
    }

    updateActiveObject(props: ObjectProps): void {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) return;
        if (this.layerKind(active) === 'image' || this.layerId(active) === '') return;

        const before: ObjectProps = {};
        for (const key of Object.keys(props)) {
            before[key] = (active.get(key) as string | number) ?? '';
        }
        active.set(props);
        active.setCoords();
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: 'style layer',
            do:   () => { active.set(props);  active.setCoords(); this.canvas.requestRenderAll(); this.afterLayerMutation(); },
            undo: () => { active.set(before); active.setCoords(); this.canvas.requestRenderAll(); this.afterLayerMutation(); },
        });
        this.afterLayerMutation();
    }

    async undo(): Promise<void> {
        await this.commandStack.undo();
        this.emit('imageChanged', undefined);
        this.emit('historyStateChanged', {
            canUndo: this.commandStack.canUndo(),
            canRedo: this.commandStack.canRedo(),
        });
    }

    async redo(): Promise<void> {
        await this.commandStack.redo();
        this.emit('imageChanged', undefined);
        this.emit('historyStateChanged', {
            canUndo: this.commandStack.canUndo(),
            canRedo: this.commandStack.canRedo(),
        });
    }

    canUndo(): boolean { return this.commandStack.canUndo(); }
    canRedo(): boolean { return this.commandStack.canRedo(); }

    clearRedoStack(): void {
        this.commandStack.clearRedo();
        this.emit('historyStateChanged', {
            canUndo: this.commandStack.canUndo(),
            canRedo: this.commandStack.canRedo(),
        });
    }

    async export(format: 'png' | 'jpeg' | 'webp' = 'png', quality = 0.92): Promise<Blob> {
        const flat = this.renderFlattened();
        const blob = await new Promise<Blob | null>(resolve =>
            flat.toBlob(b => resolve(b), `image/${format}`, quality),
        );
        if (blob === null) {
            throw new Error('FabricEngineAdapter: export produced null blob');
        }
        return blob;
    }

    exportDataUrl(format: 'png' | 'jpeg' | 'webp' = 'png', quality = 0.92): string {
        return this.renderFlattened().toDataURL(`image/${format}`, quality);
    }

    hasAlpha(): boolean {
        if (this.image === null) return false;

        // Cheap structural check first: a mask / clipPath on the base
        // image (or any visible layer) cuts pixels to transparent. This
        // is the masking case (C.1c) — the verified source of opaque
        // black corners on a JPEG save — and returns without a scan.
        if (this.objectHasClip(this.image)) return true;
        for (const o of this.layerObjects()) {
            if (o.visible !== false && this.objectHasClip(o)) return true;
        }

        // Fall back to a pixel scan to catch a transparent source image
        // (PNG / WebP / GIF with alpha) or partial-opacity compositing
        // that leaves the flattened result non-opaque. Early-exits on the
        // first transparent pixel; a fully-opaque image scans in full,
        // which is acceptable for an infrequent save action.
        try {
            const flat = this.renderFlattened();
            const ctx = flat.getContext('2d', { willReadFrequently: true });
            if (ctx === null) return false;
            const { data } = ctx.getImageData(0, 0, flat.width, flat.height);
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] < 255) return true;
            }
        } catch {
            // A tainted canvas (cross-origin source) would throw here as
            // it does for `toBlob`; assume opaque and let the caller fall
            // back to the source-derived format.
            return false;
        }
        return false;
    }

    /** True when `obj` carries a fabric `clipPath` (a mask). */
    private objectHasClip(obj: FabricObject | null): boolean {
        return obj !== null
            && (obj as unknown as Record<string, unknown>)['clipPath'] != null;
    }

    /**
     * Render the base image plus every visible annotation layer into a
     * single bitmap (the export-time flatten). With no annotations the
     * fast path returns the image baked at its own resolution; with
     * annotations we composite each object onto a canvas sized to the
     * image's bounding box, offsetting every object by its position
     * relative to the image (both in canvas-space px, multiplier 1).
     *
     * C.1 keeps transforms whole-image, so the common authoring flow
     * (edit pixels -> annotate -> save) lands annotations at full
     * resolution; a base image the user manually scaled with handles
     * exports at its displayed size (a documented limitation).
     */
    private renderFlattened(): HTMLCanvasElement {
        const image = this.requireImage();
        const extras = this.layerObjects().filter(
            o => this.layerKind(o) !== 'image' && o.visible !== false,
        );

        const baseEl = image.toCanvasElement({ multiplier: 1 });
        if (extras.length === 0) {
            return baseEl;
        }

        const base = image.getBoundingRect();
        const out = document.createElement('canvas');
        out.width  = Math.max(1, Math.round(base.width));
        out.height = Math.max(1, Math.round(base.height));
        const ctx = out.getContext('2d');
        if (ctx === null) {
            throw new Error('FabricEngineAdapter: 2d context unavailable for export');
        }
        ctx.drawImage(baseEl, 0, 0);
        for (const obj of extras) {
            const bounds = obj.getBoundingRect();
            const el = obj.toCanvasElement({ multiplier: 1 });
            ctx.drawImage(el, Math.round(bounds.left - base.left), Math.round(bounds.top - base.top));
        }
        return out;
    }

    getCanvasSize(): Size {
        if (this.image === null) return { width: 0, height: 0 };
        return { width: this.image.width, height: this.image.height };
    }

    setZoom(scale: number): void {
        const center = new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
        this.canvas.zoomToPoint(center, scale);
        this.syncFrameOverlay();
        this.canvas.requestRenderAll();
    }

    getZoom(): number {
        return this.canvas.getZoom();
    }

    resetZoom(): void {
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.syncFrameOverlay();
        this.canvas.requestRenderAll();
    }

    pan(dx: number, dy: number): void {
        this.canvas.relativePan(new Point(dx, dy));
        this.canvas.requestRenderAll();
    }

    getPanOffset(): PointType {
        const vt = this.canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        return { x: vt[4] ?? 0, y: vt[5] ?? 0 };
    }

    setPanOffset(offset: PointType): void {
        const zoom = this.canvas.getZoom();
        this.canvas.setViewportTransform([zoom, 0, 0, zoom, offset.x, offset.y]);
        this.canvas.requestRenderAll();
    }

    resetPan(): void {
        const zoom = this.canvas.getZoom();
        this.canvas.setViewportTransform([zoom, 0, 0, zoom, 0, 0]);
        this.canvas.requestRenderAll();
    }

    getFitZoom(viewportSize: Size): number {
        if (this.image === null) return 1;
        const margin = 0.95;
        const w = this.image.width;
        const h = this.image.height;
        if (w <= 0 || h <= 0) return 1;
        const widthRatio  = (viewportSize.width  * margin) / w;
        const heightRatio = (viewportSize.height * margin) / h;
        return Math.min(widthRatio, heightRatio);
    }

    setCursor(cursor: 'default' | 'grab' | 'grabbing' | 'crosshair'): void {
        this.canvas.defaultCursor = cursor;
        this.canvas.hoverCursor   = cursor;
        this.canvas.moveCursor    = cursor;
    }

    setSelectionEnabled(enabled: boolean): void {
        this.canvas.selection      = enabled;
        this.canvas.skipTargetFind = !enabled;
        if (!enabled) {
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();
        }
    }

    setCanvasDimensions(viewport: Size): void {
        const width  = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        this.canvas.setDimensions({ width, height });
        if (this.image !== null) {
            this.canvas.centerObject(this.image);
            // Re-anchor the viewport transform around the NEW canvas
            // centre while preserving the current zoom level.
            // `setDimensions` updates `canvas.width/height`, and
            // `centerObject` moves the image to the new canvas centre
            // in canvas coords — but the existing viewportTransform's
            // translate term still anchors to the OLD canvas centre.
            // Without re-anchoring, the image drifts off-centre
            // (most visibly vertically when the dialog grows or
            // shrinks) on every container resize. `zoomToPoint(p, s)`
            // is a no-op when `s` equals the current zoom (it's
            // designed to change zoom while keeping `p` fixed on
            // screen), so we rewrite vt[4]/vt[5] directly: at
            // zoom `s` anchored at canvas centre `(cx, cy)`, the
            // identity for "vt maps cx,cy -> cx,cy on screen" is
            // `tx = cx * (1 - s)`, `ty = cy * (1 - s)`.
            const zoom = this.canvas.getZoom();
            const c    = this.canvas.getCenterPoint();
            this.canvas.setViewportTransform([zoom, 0, 0, zoom, c.x * (1 - zoom), c.y * (1 - zoom)]);
        }
        this.syncFrameOverlay();
        this.canvas.requestRenderAll();
    }

    on<T extends EngineEventType>(event: T, handler: EngineEventHandler<T>): void {
        let set = this.listeners.get(event);
        if (set === undefined) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler as (data: any) => void);
    }

    off<T extends EngineEventType>(event: T, handler?: EngineEventHandler<T>): void {
        const set = this.listeners.get(event);
        if (set === undefined) return;
        if (handler === undefined) {
            set.clear();
        } else {
            set.delete(handler as (data: any) => void);
        }
    }

    destroy(): void {
        if (this.cropOverlay !== null) {
            this.canvas.remove(this.cropOverlay);
            this.cropOverlay = null;
        }
        this.removeFrameOverlay();
        this.commandStack.clear();
        this.listeners.clear();
        this.image = null;
        // Canvas.dispose is async in v6; fire-and-forget so a sync
        // destroy from ngOnDestroy doesn't block teardown. Internal
        // listeners detach synchronously inside dispose itself.
        void this.canvas.dispose();
        if (this.canvasEl.parentElement === this.container) {
            this.container.removeChild(this.canvasEl);
        }
    }

    get canvasElement(): HTMLCanvasElement | null {
        return this.canvasEl;
    }

    private requireImage(): FabricImage {
        if (this.image === null) {
            throw new Error('FabricEngineAdapter: no image loaded');
        }
        return this.image;
    }

    /**
     * Add a thin orange rectangle that mirrors the image's transform
     * so the user can see exactly where the image edge is against the
     * dark canvas background. Sent to the back so the image renders
     * on top of the inner half of the stroke; the outer half stays
     * visible just outside the image bounds. `strokeWidth = 2 / zoom`
     * keeps that outer band a constant 1 visual pixel regardless of
     * viewport zoom. Excluded from export by both convention and
     * construction: our `export` / `exportDataUrl` paths render only
     * the FabricImage object, not the canvas.
     */
    private addFrameOverlay(): void {
        if (this.image === null) return;
        if (this.frameOverlay !== null) {
            this.canvas.remove(this.frameOverlay);
            this.frameOverlay = null;
        }
        const image = this.image;
        const zoom = this.canvas.getZoom() || 1;
        const frame = new FabricRect({
            left:    image.left   ?? 0,
            top:     image.top    ?? 0,
            width:   image.width,
            height:  image.height,
            angle:   image.angle  ?? 0,
            scaleX:  image.scaleX ?? 1,
            scaleY:  image.scaleY ?? 1,
            flipX:   image.flipX  ?? false,
            flipY:   image.flipY  ?? false,
            originX: image.originX,
            originY: image.originY,
            fill:              'transparent',
            stroke:            'rgba(245, 166, 35, 0.5)',
            strokeWidth:       2 / zoom,
            strokeUniform:     false,
            selectable:        false,
            evented:           false,
            excludeFromExport: true,
            objectCaching:     false,
            hoverCursor:       'default',
        } as any);
        this.frameOverlay = frame;
        this.canvas.add(frame);
        this.canvas.sendObjectToBack(frame);
        this.canvas.requestRenderAll();
    }

    /**
     * Refresh the frame to mirror the image's current transform and
     * keep the stroke at a constant 1 visual pixel. Called whenever
     * the image moves, scales, rotates, or flips, and after viewport
     * zoom changes (since the latter only matters for the stroke
     * width). Hidden frame stays hidden but its geometry still
     * updates so the next show is in sync.
     */
    private syncFrameOverlay(): void {
        const frame = this.frameOverlay;
        const image = this.image;
        if (frame === null || image === null) return;
        const zoom = this.canvas.getZoom() || 1;
        frame.set({
            left:        image.left   ?? 0,
            top:         image.top    ?? 0,
            width:       image.width,
            height:      image.height,
            angle:       image.angle  ?? 0,
            scaleX:      image.scaleX ?? 1,
            scaleY:      image.scaleY ?? 1,
            flipX:       image.flipX  ?? false,
            flipY:       image.flipY  ?? false,
            strokeWidth: 2 / zoom,
        });
        frame.setCoords();
        this.canvas.requestRenderAll();
    }

    private removeFrameOverlay(): void {
        if (this.frameOverlay !== null) {
            this.canvas.remove(this.frameOverlay);
            this.frameOverlay = null;
        }
    }

    /**
     * Install a new FabricImage as the active image after a crop or
     * resize replacement. Adds it to the canvas, centers it in canvas
     * coordinates, drops any leftover viewport zoom/pan from the
     * previous image (otherwise the new, smaller image lands
     * off-screen because the user was zoomed into the corner of the
     * old one), and re-emits `imageLoaded` so consumers refit the
     * view to the new dimensions.
     */
    private replaceImage(newImage: FabricImage): void {
        this.removeFrameOverlay();
        this.image = newImage;
        this.canvas.add(newImage);
        // Keep the base image the canvas floor: a crop / resize that runs
        // after annotations were added must not stack the fresh image on
        // top of them (C.1e). No-op when there are no annotation layers.
        this.keepImageAtBack();
        this.canvas.centerObject(newImage);
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.addFrameOverlay();
        this.canvas.requestRenderAll();
        this.emit('imageLoaded', { width: newImage.width, height: newImage.height });
    }

    /**
     * Make sure fabric's WebGL filter backend has a GL canvas large
     * enough to hold the image's full pixel area. Fabric defaults
     * `config.textureSize` to 4096 and constructs a 4096×4096 GL
     * canvas; rendering a 4608×3456 image into that backend leaves
     * a ~512 px right-edge band un-rendered (the WebGL viewport is
     * set to image dims but the GL canvas can't hold them), which
     * `copyGLTo2D` then reads as transparent. That surfaced as the
     * right-side crop the user reported on Sharpen.
     *
     * Fix: bump `config.textureSize` to the next power-of-two that
     * fits the image, capped at 16384, then drop the cached backend
     * so `getFilterBackend()` re-initialises with the new tile size.
     * The probe inside `initFilterBackend` falls back to the Canvas2D
     * backend automatically if the GPU can't support the new size,
     * so this is safe on low-end hardware.
     */
    private ensureFilterBackendFitsImage(image: FabricImage): void {
        const required = Math.max(image.width, image.height);
        if (required <= fabricConfig.textureSize) return;
        const nextPow2 = 1 << Math.ceil(Math.log2(required));
        fabricConfig.textureSize = Math.min(16384, nextPow2);
        setFilterBackend(initFilterBackend());
    }

    private pushCommand(cmd: EngineCommand): void {
        this.commandStack.push(cmd);
        this.emit('imageChanged', undefined);
        this.emit('historyStateChanged', {
            canUndo: this.commandStack.canUndo(),
            canRedo: this.commandStack.canRedo(),
        });
    }

    private resolveFilterCtor(name: FilterName): any {
        if (name === 'sharpen') return filters.Convolute;
        const slider = FabricEngineAdapter.SLIDER_FILTERS[name];
        if (slider !== undefined) return slider;
        const toggle = FabricEngineAdapter.TOGGLE_FILTERS[name];
        if (toggle !== undefined) return toggle;
        throw new Error(`FabricEngineAdapter: unknown filter "${name}"`);
    }

    private instantiateFilter(name: FilterName, params: FilterParams): any {
        if (name === 'sharpen') {
            const Ctor = filters.Convolute as ConvoluteFilterCtor;
            return new Ctor({ matrix: [...SHARPEN_KERNEL], opaque: false });
        }
        if (name === 'pixelate') {
            const Ctor = filters.Pixelate as SliderFilterCtor;
            const blocksize = Math.max(2, Math.round(params.pixelate ?? 2));
            return new Ctor({ blocksize });
        }
        const slider = FabricEngineAdapter.SLIDER_FILTERS[name];
        if (slider !== undefined) {
            const value = (params as Record<string, number | undefined>)[name] ?? 0;
            return new slider({ [name]: value });
        }
        const toggle = FabricEngineAdapter.TOGGLE_FILTERS[name];
        if (toggle !== undefined) {
            return new toggle();
        }
        throw new Error(`FabricEngineAdapter: unknown filter "${name}"`);
    }

    private attachVendorListeners(): void {
        // Keep the canvas frame in sync with every image transform.
        // All transform paths (rotate, flip, mouse drag, undo/redo)
        // funnel through `imageTransformed`, so a single subscription
        // is enough to catch them.
        this.on('imageTransformed', () => this.syncFrameOverlay());

        this.canvas.on('selection:created', (e: any) => {
            const target = e.selected?.[0] ?? null;
            this.emit('objectActivated', { objectType: target?.type ?? '' });
            this.emitActiveFromCanvas();
        });
        this.canvas.on('selection:updated', (e: any) => {
            const target = e.selected?.[0] ?? null;
            this.emit('objectActivated', { objectType: target?.type ?? '' });
            this.emitActiveFromCanvas();
        });
        this.canvas.on('selection:cleared', () => {
            this.emit('objectDeactivated', undefined);
            this.emit('activeObjectChanged', { id: null, kind: null });
        });

        // Snapshot the image's transform when the user starts a drag
        // gesture on it. fabric fires `object:modified` once the gesture
        // ends, with the final state on the target; without the
        // snapshot we'd have no way to build the inverse for undo.
        // Filtered to the image only so the crop overlay's drags don't
        // poison the snapshot. Shape / text layers get a parallel
        // snapshot so their moves / resizes are undoable too (C.1).
        this.canvas.on('mouse:down', (e: any) => {
            const target = e.target as FabricObject | undefined;
            if (this.image !== null && target === this.image) {
                this.mouseTransformSnapshot = this.captureTransform(this.image);
            } else if (target && this.layerId(target) !== '' && this.layerKind(target) !== 'image') {
                this.objTransformSnapshot = { obj: target, state: this.captureObjectState(target) };
            }
        });

        this.canvas.on('object:modified', (e: any) => {
            // Shape / text layer moved / resized / rotated with the
            // mouse handles — push a generic transform command.
            const tgt = e.target as FabricObject | undefined;
            if (tgt && this.layerId(tgt) !== '' && this.layerKind(tgt) !== 'image') {
                const snap = this.objTransformSnapshot;
                this.objTransformSnapshot = null;
                if (snap !== null && snap.obj === tgt) {
                    const before = snap.state;
                    const after = this.captureObjectState(tgt);
                    if (JSON.stringify(before) !== JSON.stringify(after)) {
                        this.commandStack.push({
                            name: 'move layer',
                            do:   () => { tgt.set(after);  tgt.setCoords(); this.canvas.requestRenderAll(); this.afterLayerMutation(); },
                            undo: () => { tgt.set(before); tgt.setCoords(); this.canvas.requestRenderAll(); this.afterLayerMutation(); },
                        });
                        this.emit('imageChanged', undefined);
                        this.emit('historyStateChanged', {
                            canUndo: this.commandStack.canUndo(),
                            canRedo: this.commandStack.canRedo(),
                        });
                    }
                }
                // Refresh the active-layer transform mirror so the
                // Rotate / Flip tools pick up a handle-drag rotation /
                // flip as their next baseline (C.1c).
                this.emitActiveFromCanvas();
                return;
            }

            if (this.image === null || e.target !== this.image) return;
            const before = this.mouseTransformSnapshot;
            this.mouseTransformSnapshot = null;
            if (before === null) return;
            const after = this.captureTransform(this.image);
            if (this.transformsEqual(before, after)) return;

            const image = this.image;
            this.commandStack.push({
                name: 'transform',
                do:   () => {
                    image.set(after);
                    image.setCoords();
                    this.canvas.requestRenderAll();
                    this.emitImageTransformed(image, 'sidebar');
                },
                undo: () => {
                    image.set(before);
                    image.setCoords();
                    this.canvas.requestRenderAll();
                    this.emitImageTransformed(image, 'sidebar');
                },
            });
            this.emit('imageChanged', undefined);
            this.emit('historyStateChanged', {
                canUndo: this.commandStack.canUndo(),
                canRedo: this.commandStack.canRedo(),
            });
            this.emitImageTransformed(image, 'mouse');
        });

        // Annotation seam: raw pointer stream in SCENE coordinates so
        // consumers can implement draw-by-drag interactions without
        // touching fabric (see EngineEvents.scenePointer).
        const emitScenePointer = (phase: 'down' | 'move' | 'up' | 'dblclick') => (e: any) => {
            const p = this.canvas.getScenePoint(e.e);
            const target = e.target as FabricObject | undefined;
            this.emit('scenePointer', {
                phase,
                x: p.x,
                y: p.y,
                targetLayerId: target ? (this.layerId(target) || null) : null,
            });
        };
        this.canvas.on('mouse:down', emitScenePointer('down'));
        this.canvas.on('mouse:move', emitScenePointer('move'));
        this.canvas.on('mouse:up', emitScenePointer('up'));
        this.canvas.on('mouse:dblclick', emitScenePointer('dblclick'));
    }

    private captureTransform(image: FabricImage): ImageTransformState {
        return {
            angle:  image.angle  ?? 0,
            scaleX: image.scaleX ?? 1,
            scaleY: image.scaleY ?? 1,
            flipX:  image.flipX  ?? false,
            flipY:  image.flipY  ?? false,
            left:   image.left   ?? 0,
            top:    image.top    ?? 0,
        };
    }

    private transformsEqual(a: ImageTransformState, b: ImageTransformState): boolean {
        return a.angle  === b.angle
            && a.scaleX === b.scaleX
            && a.scaleY === b.scaleY
            && a.flipX  === b.flipX
            && a.flipY  === b.flipY
            && a.left   === b.left
            && a.top    === b.top;
    }

    private emitImageTransformed(image: FabricImage, source: 'mouse' | 'sidebar'): void {
        const t = this.captureTransform(image);
        this.emit('imageTransformed', { ...t, source });
    }

    // --- C.1 layer helpers -----------------------------------------

    /** A filled right-pointing arrow, drawn as a single polygon. */
    private static readonly ARROW_POINTS: readonly { x: number; y: number }[] = [
        { x: 0,   y: 14 }, { x: 150, y: 14 }, { x: 150, y: 0 },
        { x: 200, y: 28 }, { x: 150, y: 56 }, { x: 150, y: 42 }, { x: 0, y: 42 },
    ];

    private createShape(kind: ShapeKind, o: ShapeOptions): FabricObject {
        const base = { fill: this.resolveFill(o.fillSpec, o.fill), stroke: o.stroke, strokeWidth: o.strokeWidth };
        switch (kind) {
            case 'rect':     return new FabricRect({ ...base, width: 220, height: 140 });
            case 'ellipse':  return new Ellipse({ ...base, rx: 120, ry: 80 });
            case 'triangle': return new Triangle({ ...base, width: 200, height: 170 });
            case 'line':     return new Line([0, 0, 240, 0], { stroke: o.stroke, strokeWidth: Math.max(3, o.strokeWidth) });
            case 'arrow':    return new Polygon([...FabricEngineAdapter.ARROW_POINTS], { ...base });
        }
    }

    // --- C.1b fill (solid / gradient) ------------------------------

    /** A fabric fill value: a flat colour string or a `Gradient`. */
    private resolveFill(spec: FillSpec | undefined, fallback: string): string | Gradient<'linear'> | Gradient<'radial'> {
        return spec === undefined ? fallback : this.buildFill(spec);
    }

    /**
     * Build a fabric solid colour or `Gradient` from a {@link FillSpec}.
     * Gradients use `gradientUnits: 'percentage'`, so coords are 0..1 of
     * the object's bounding box (origin top-left) and the gradient
     * tracks the object through resize / text reflow — fabric applies
     * `ctx.transform(width, 0, 0, height, …)` at paint time, including
     * the `toCanvasElement` flatten the export composites.
     */
    private buildFill(spec: FillSpec): string | Gradient<'linear'> | Gradient<'radial'> {
        if (spec.type === 'solid') return spec.color;

        const colorStops = [
            { offset: 0, color: spec.color },
            { offset: 1, color: spec.color2 },
        ];

        if (spec.type === 'radial') {
            // Centre -> edge ellipse spanning the object box.
            return new Gradient<'radial'>({
                type:          'radial',
                gradientUnits: 'percentage',
                coords:        { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 },
                colorStops,
            });
        }

        // Linear: a line through the box centre at `angle` degrees.
        const rad = (spec.angle * Math.PI) / 180;
        const dx  = Math.cos(rad) / 2;
        const dy  = Math.sin(rad) / 2;
        return new Gradient<'linear'>({
            type:          'linear',
            gradientUnits: 'percentage',
            coords:        { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy },
            colorStops,
        });
    }

    /** Resolve a fabric fill (string or `Gradient`) back to a {@link FillSpec}. */
    private readFill(fill: unknown): FillSpec {
        if (this.isGradient(fill)) {
            const stops  = fill.colorStops ?? [];
            const color  = this.colorStopHex(stops[0]?.color, '#000000');
            const color2 = this.colorStopHex(stops[stops.length - 1]?.color, '#ffffff');
            if (fill.type === 'radial') {
                return { type: 'radial', color, color2, angle: 0 };
            }
            const c   = fill.coords;
            const deg = (Math.atan2((c.y2 ?? 0) - (c.y1 ?? 0), (c.x2 ?? 1) - (c.x1 ?? 0)) * 180) / Math.PI;
            return { type: 'linear', color, color2, angle: Math.round((deg + 360) % 360) };
        }
        const color = typeof fill === 'string' && fill !== '' ? fill : '#000000';
        return { type: 'solid', color, color2: '#ffffff', angle: 0 };
    }

    /** Best-effort solid-colour hex for the generic prop bag (gradients collapse to their first stop). */
    private fillToHex(fill: unknown): string {
        if (typeof fill === 'string') return fill;
        return this.readFill(fill).color;
    }

    private isGradient(v: unknown): v is {
        type: 'linear' | 'radial';
        colorStops: { color: string; offset: number }[];
        coords: { x1: number; y1: number; x2: number; y2: number };
    } {
        return v !== null && typeof v === 'object'
            && Array.isArray((v as { colorStops?: unknown }).colorStops);
    }

    /** Coerce a colour-stop value to an `<input type=color>`-safe 6-digit hex. */
    private colorStopHex(color: string | undefined, fallback: string): string {
        return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
    }

    private shapeLabel(kind: ShapeKind): string {
        const labels: Record<ShapeKind, string> = {
            rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', line: 'Line', arrow: 'Arrow',
        };
        return labels[kind];
    }

    /**
     * Centre `obj` on the image, stamp it as a layer, add + select it,
     * and push an add/remove undo command. Shared by addShape/addText.
     */
    private placeAndAdd(obj: FabricObject, kind: LayerKind, name: string): void {
        const center = this.image !== null
            ? this.image.getCenterPoint()
            : new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
        obj.set({ originX: 'center', originY: 'center', left: center.x, top: center.y });
        obj.setCoords();
        this.stampLayer(obj, kind, name);
        this.canvas.add(obj);
        this.keepImageAtBack();
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();

        this.pushCommand({
            name: `add ${name}`,
            do: () => {
                this.canvas.add(obj);
                this.keepImageAtBack();
                this.canvas.setActiveObject(obj);
                this.canvas.requestRenderAll();
                this.afterLayerMutation();
            },
            undo: () => {
                this.canvas.remove(obj);
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
                this.afterLayerMutation();
            },
        });
        this.afterLayerMutation();
    }

    private stampLayer(obj: FabricObject, kind: LayerKind, name: string): void {
        const o = obj as unknown as Record<string, unknown>;
        o['coolmsId']   = kind === 'image' ? 'layer-bg' : `layer-${this.nextLayerId++}`;
        o['coolmsKind'] = kind;
        o['coolmsName'] = name;
    }

    /** Every stamped layer object on the canvas (base image + extras). */
    private layerObjects(): FabricObject[] {
        return this.canvas.getObjects().filter(o => (o as unknown as Record<string, unknown>)['coolmsId'] !== undefined);
    }

    /** Drop every non-image layer (used by load / reset). */
    private removeLayerObjects(): void {
        for (const o of this.layerObjects()) {
            if (this.layerKind(o) !== 'image') this.canvas.remove(o);
        }
        this.nextLayerId = 1;
    }

    private findLayer(id: string): FabricObject | null {
        return this.layerObjects().find(o => this.layerId(o) === id) ?? null;
    }

    private layerId(o: FabricObject): string {
        return (o as unknown as Record<string, unknown>)['coolmsId'] as string ?? '';
    }

    private layerKind(o: FabricObject): LayerKind {
        return (o as unknown as Record<string, unknown>)['coolmsKind'] as LayerKind ?? 'shape';
    }

    private layerName(o: FabricObject): string {
        return (o as unknown as Record<string, unknown>)['coolmsName'] as string ?? 'Layer';
    }

    /** Keep the base image pinned to the canvas floor (z-index 0). */
    private keepImageAtBack(): void {
        if (this.image !== null && this.canvas.getObjects().length > 1) {
            this.canvas.sendObjectToBack(this.image);
        }
    }

    /** Notify consumers a layer changed + re-broadcast the active layer. */
    private afterLayerMutation(): void {
        this.emit('layersChanged', undefined);
        this.emitActiveFromCanvas();
    }

    private emitActiveFromCanvas(): void {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) {
            this.emit('activeObjectChanged', { id: null, kind: null });
            return;
        }
        const id = this.layerId(active);
        this.emit('activeObjectChanged', {
            id:   id === '' ? null : id,
            kind: id === '' ? null : this.layerKind(active),
        });
    }

    private captureObjectState(o: FabricObject): Record<string, number> {
        return {
            left:   o.left   ?? 0,
            top:    o.top    ?? 0,
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            angle:  o.angle  ?? 0,
            skewX:  o.skewX  ?? 0,
            skewY:  o.skewY  ?? 0,
            width:  o.width  ?? 0,
            height: o.height ?? 0,
        };
    }

    // --- C.1c per-layer transforms + masking helpers ---------------

    /**
     * The active object when it's a selectable shape / text layer (not
     * the base image, not nothing). The rotate / flip / mask targeting
     * keys off this: a non-null result means "operate on this layer".
     */
    private activeNonImageLayer(): FabricObject | null {
        const active = this.canvas.getActiveObject();
        if (active === undefined || active === null) return null;
        if (this.layerId(active) === '' || this.layerKind(active) === 'image') return null;
        return active;
    }

    /**
     * The mask target: the active non-image layer if one is selected,
     * else the base image (which may be `null` before any load).
     */
    private maskTarget(): FabricObject | null {
        return this.activeNonImageLayer() ?? this.image;
    }

    private rotateLayer(obj: FabricObject, degrees: number): void {
        const prev = obj.angle ?? 0;
        const next = prev + degrees;
        const apply = (angle: number): void => {
            obj.rotate(angle);
            obj.setCoords();
            this.canvas.requestRenderAll();
            this.afterLayerMutation();
        };
        apply(next);
        this.pushCommand({
            name: 'rotate layer',
            do:   () => { apply(next); },
            undo: () => { apply(prev); },
        });
    }

    private flipLayer(obj: FabricObject, axis: 'horizontal' | 'vertical'): void {
        const prop: 'flipX' | 'flipY' = axis === 'horizontal' ? 'flipX' : 'flipY';
        const prev = obj[prop] ?? false;
        const apply = (value: boolean): void => {
            obj.set(prop, value);
            obj.setCoords();
            this.canvas.requestRenderAll();
            this.afterLayerMutation();
        };
        apply(!prev);
        this.pushCommand({
            name: `flip layer ${axis}`,
            do:   () => { apply(!prev); },
            undo: () => { apply(prev);  },
        });
    }

    /**
     * Build a fabric `clipPath` for `spec` against `target`'s own box.
     * The clip is centred on the object (originX/Y = 'center', left/top
     * = 0): fabric renders clipPaths in the object's centred local space
     * before applying the object's own scale, so the mask tracks the
     * object through scale / move and bakes into `toCanvasElement`.
     * Returns `null` for `shape: 'none'` (clears the mask).
     */
    private buildClipPath(target: FabricObject, spec: MaskSpec): FabricObject | null {
        if (spec.shape === 'none') return null;

        const w = target.width  ?? 0;
        const h = target.height ?? 0;
        const mx = w * (spec.inset / 100);
        const my = h * (spec.inset / 100);
        const cw = Math.max(1, w - 2 * mx);
        const ch = Math.max(1, h - 2 * my);
        const common = { originX: 'center', originY: 'center', left: 0, top: 0 } as const;

        switch (spec.shape) {
            case 'rect':
                return new FabricRect({ ...common, width: cw, height: ch });
            case 'rounded': {
                const r = (Math.min(cw, ch) / 2) * (spec.radius / 100);
                return new FabricRect({ ...common, width: cw, height: ch, rx: r, ry: r });
            }
            case 'ellipse':
                return new Ellipse({ ...common, rx: cw / 2, ry: ch / 2 });
            case 'triangle':
                return new Triangle({ ...common, width: cw, height: ch });
            case 'custom':
                // Arbitrary path geometry from a pasted / uploaded SVG
                // (C.1d). The tool has already sanitised it to a single
                // combined path `d` string (paths only).
                return this.buildPathClip(spec.svgPath ?? '', cw, ch, common);
            default:
                // SVG-path presets (star / heart / hexagon), normalised to
                // a 0..100 box and scaled to the clip box.
                return this.buildPathClip(MASK_PATHS[spec.shape], cw, ch, common);
        }
    }

    /**
     * Build a `Path` clip from raw SVG path `d` data, scaling its
     * bounding box to the `cw × ch` clip box (centred via `common`).
     * Shared by the built-in path presets and arbitrary `custom` masks
     * (C.1d) — fabric computes the path's intrinsic bbox, and the
     * `scaleX/Y` maps it onto the target's clip box, so any path tracks
     * scale / move and bakes into `toCanvasElement` like the presets.
     * Returns `null` for empty / unparseable data (clears the mask).
     */
    private buildPathClip(
        d: string,
        cw: number,
        ch: number,
        common: { originX: 'center'; originY: 'center'; left: number; top: number },
    ): FabricObject | null {
        if (d.trim() === '') return null;
        let path: Path;
        try {
            path = new Path(d, { ...common });
        } catch {
            // Defensive: fabric throws on path data it can't tokenise.
            // The tool validates before sending, so this is a backstop.
            return null;
        }
        const pw = path.width  || 100;
        const ph = path.height || 100;
        path.set({ scaleX: cw / pw, scaleY: ch / ph });
        path.setCoords();
        return path;
    }

    private emit<T extends EngineEventType>(event: T, data: EngineEvents[T]): void {
        const set = this.listeners.get(event);
        if (set === undefined) return;
        for (const handler of set) {
            handler(data);
        }
    }
}
