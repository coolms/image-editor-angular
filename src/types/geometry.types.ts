/**
 * Pure geometry primitives shared across the engine and any UI shell
 * sitting on top. Deliberately framework-agnostic: no Angular, no
 * fabric.js, no Toast UI imports — these types are part of the public
 * surface of `@coolms/image-editor` and need to compile without the
 * peer dependency installed.
 */

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Size {
    readonly width:  number;
    readonly height: number;
}

/**
 * Axis-aligned rectangle. The engine's `crop(rect)` consumes this shape
 * directly; UI shells produce one from their cropzone overlay.
 */
export interface Rect {
    readonly x:      number;
    readonly y:      number;
    readonly width:  number;
    readonly height: number;
}

export interface Bounds {
    readonly minWidth:  number;
    readonly minHeight: number;
    readonly maxWidth:  number;
    readonly maxHeight: number;
}
