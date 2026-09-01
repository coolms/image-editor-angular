/**
 * Object / layer model for the image editor (Track C.1).
 *
 * The editor was historically single-image (one `FabricImage`, flat
 * bitmap). C.1 introduces an **objects-as-layers** model: the base
 * image is the bottom layer; every shape / text the author adds is a
 * layer stacked on top. Fabric's canvas is already an ordered object
 * stack, so a "layer" is just a canvas object carrying a stable id.
 *
 * Resize / filters still operate on the base image only — they're
 * pixel-baking ops, meant to run before annotations. C.1c makes
 * **rotate / flip** target the selected non-image layer (falling back
 * to the base image) and adds **masking** (a clip-path on the target;
 * see {@link MaskSpec}); C.1e makes **crop** composition-aware — the
 * annotation layers shift with the cropped content and clip at the new
 * edges, so a crop after annotating stays aligned.
 */

/** What a layer is. `image` is the immovable-from-the-stack base. */
export type LayerKind = 'image' | 'shape' | 'text';

/** The shape primitives the Shapes tool can insert. */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle';

/**
 * Canvas-space geometry of an annotation shape — the round-trippable
 * subset consumers that author geometry (e.g. the ImageMap region
 * page) read and write via `addShapeAt()` / `getShapeGeometry()`.
 * Coordinates are SCENE space (viewport zoom/pan factored out), the
 * same space `getImageBounds()` reports in.
 */
export type ShapeGeometry =
    | { kind: 'rect'; rect: { x: number; y: number; width: number; height: number } }
    | { kind: 'ellipse'; center: { x: number; y: number }; rx: number; ry: number }
    | { kind: 'polygon'; points: { x: number; y: number }[] };

/**
 * Options for `addShapeAt()`. Style keys mirror {@link ShapeOptions};
 * the extras tune the shape for geometry-authoring use:
 * - `name`: layer display name (defaults to the shape kind).
 * - `lockRotation`: hide the rotate handle — authored geometry is
 *   axis-aligned (rect regions have no rotation representation).
 * - `lockNonUniformScaling`: hide the edge handles so corner drags
 *   scale uniformly (keeps a circle circular).
 */
export interface AnnotationShapeOptions {
    fill?:        string;
    stroke?:      string;
    strokeWidth?: number;
    name?:        string;
    lockRotation?: boolean;
    lockNonUniformScaling?: boolean;
}

/**
 * How a shape / text layer is filled (C.1b).
 *
 * - `solid`  : a single flat colour.
 * - `linear` : a linear gradient from `color` -> `color2` along `angle`.
 * - `radial` : a radial gradient from `color` (centre) -> `color2` (edge).
 */
export type FillType = 'solid' | 'linear' | 'radial';

/**
 * UI-friendly, serialisable description of a fill. The engine
 * translates this to / from a fabric solid colour or `Gradient`, so the
 * tool components never import fabric. Colours are `#rrggbb` hex (what
 * `<input type="color">` reads / writes); `angle` is in degrees
 * (0 = left->right, 90 = top->bottom) and only meaningful for `linear`.
 */
export interface FillSpec {
    type:   FillType;
    color:  string;
    color2: string;
    angle:  number;
}

/**
 * A read-only view of one layer, surfaced to the Layers panel. The
 * engine owns the fabric objects; this is the serialisable projection
 * the UI binds to (never a live fabric handle).
 */
export interface LayerInfo {
    readonly id:      string;
    readonly kind:    LayerKind;
    readonly name:    string;
    readonly visible: boolean;
    /** 0..1. */
    readonly opacity: number;
    /**
     * True for the base image: it can't be deleted or reordered below
     * itself (it's the canvas floor). Shapes / text are never locked.
     */
    readonly locked:  boolean;
}

/** Style options for an inserted shape. */
export interface ShapeOptions {
    fill:        string;
    stroke:      string;
    strokeWidth: number;
    /**
     * Richer fill description (solid colour or gradient). When present
     * it takes precedence over the flat `fill` string. The Shapes tool
     * always sends this; `fill` stays a plain-colour fallback for any
     * caller that doesn't. (C.1b)
     */
    fillSpec?:   FillSpec;
}

/** Style options for inserted text. */
export interface TextOptions {
    text:       string;
    fontFamily: string;
    fontSize:   number;
    fill:       string;
    fontWeight: 'normal' | 'bold';
    fontStyle:  'normal' | 'italic';
    textAlign:  'left' | 'center' | 'right';
    /** Gradient-capable fill; see {@link ShapeOptions.fillSpec}. (C.1b) */
    fillSpec?:  FillSpec;
}

/**
 * Generic property bag the style panels read/write against the active
 * object. Keys are fabric property names (`fill`, `stroke`,
 * `strokeWidth`, `opacity`, `fontFamily`, …); the engine reads them off
 * / sets them on the active object without the UI importing fabric.
 */
export type ObjectProps = Record<string, string | number>;

export const DEFAULT_SHAPE_OPTIONS: ShapeOptions = {
    fill:        '#4f8cff',
    stroke:      '#1b1f24',
    strokeWidth: 2,
};

/** Starting fill for the Shapes / Text tools (solid, blue accent). (C.1b) */
export const DEFAULT_FILL_SPEC: FillSpec = {
    type:   'solid',
    color:  DEFAULT_SHAPE_OPTIONS.fill,
    // Literal on purpose — this is a CANVAS fill, not CSS: Fabric resolves no
    // custom properties, so a `var()` here renders as nothing.
    color2: '#ffffff',
    angle:  0,
};

export const DEFAULT_TEXT_OPTIONS: TextOptions = {
    text:       'Text',
    fontFamily: 'Arial',
    fontSize:   48,
    fill:       '#1b1f24',
    fontWeight: 'normal',
    fontStyle:  'normal',
    textAlign:  'left',
};

/** Font families offered in the Text tool (web-safe set). */
export const TEXT_FONT_FAMILIES = [
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Georgia',
    'Courier New',
    'Verdana',
    'Trebuchet MS',
    'Impact',
] as const;

/**
 * Mask / clip shapes a layer can be cut to (C.1c / C.1d).
 *
 * `none` clears the mask. `rect` / `rounded` / `ellipse` / `triangle`
 * are geometric primitives; `star` / `heart` / `hexagon` are SVG-path
 * presets. `custom` (C.1d) clips to arbitrary path geometry the user
 * pasted or uploaded as an SVG — see {@link MaskSpec.svgPath}. The
 * engine builds the matching fabric `clipPath` against the target's own
 * box, so the mask tracks the object through scale / move, and the
 * export flatten bakes it in (the clip is part of the object's normal
 * render path).
 */
export type MaskShape =
    | 'none' | 'rect' | 'rounded' | 'ellipse' | 'triangle'
    | 'star' | 'heart' | 'hexagon' | 'custom';

/**
 * UI-friendly description of a layer mask. The engine translates it to /
 * from a fabric `clipPath`, so the tool component never imports fabric.
 *
 * - `inset`   : 0..40, percent each edge is pulled in from the box (a
 *               symmetric margin around the clip).
 * - `radius`  : 0..50, corner radius for `rounded` only, as a percent of
 *               the clip's shorter half-dimension (50 = pill / circle).
 * - `svgPath` : SVG path `d` data for `shape: 'custom'` (C.1d). Sanitised
 *               geometry extracted from a pasted path string or uploaded
 *               SVG file — every drawable element is flattened to a single
 *               combined path (paths only, no script / external refs). The
 *               engine scales its bounding box to the clip box exactly
 *               like the built-in path presets, so it tracks scale / move
 *               and round-trips through the `coolmsMask` stamp.
 */
export interface MaskSpec {
    shape:   MaskShape;
    inset:   number;
    radius:  number;
    svgPath?: string;
}

/** Starting mask for the Mask tool (no clip). (C.1c) */
export const DEFAULT_MASK_SPEC: MaskSpec = {
    shape:  'none',
    inset:  0,
    radius: 30,
};

/**
 * SVG path data for the path-preset masks, normalised to a 0..100 box.
 * The engine scales each to the target's clip box. (C.1c)
 */
export const MASK_PATHS: Readonly<Record<'star' | 'heart' | 'hexagon', string>> = {
    star:    'M50 3 L61 38 L98 38 L68 60 L79 96 L50 73 L21 96 L32 60 L2 38 L39 38 Z',
    heart:   'M50 90 C18 66 4 46 4 28 C4 14 16 6 28 6 C39 6 47 13 50 22 C53 13 61 6 72 6 C84 6 96 14 96 28 C96 46 82 66 50 90 Z',
    hexagon: 'M50 3 L93 27 L93 73 L50 97 L7 73 L7 27 Z',
} as const;
