/**
 * Filter contract for the engine.
 *
 * The public API uses lowercase names and normalised parameter ranges
 * so the UI shell never has to know about fabric.js conventions.
 * The `FabricEngineAdapter` is the single translation point: lowercase
 * filter names map to fabric's BaseFilter classes, and `sharpen`
 * resolves to a `Convolute` filter constructed with the canonical
 * 3x3 sharpen kernel.
 */

export type FilterName =
    | 'brightness'
    | 'contrast'
    | 'saturation'
    | 'sepia'
    | 'grayscale'
    | 'invert'
    | 'blur'
    | 'sharpen'
    | 'noise'
    | 'pixelate';

/**
 * Per-filter parameter shape. Range conventions:
 *   brightness   -1..1   (0 = no change)
 *   contrast     -1..1   (0 = no change)
 *   saturation   -1..1   (0 = no change)
 *   blur          0..1   (0 = no blur, 1 = max)
 *   noise         0..1
 *   pixelate     blockSize in pixels (>= 2)
 *
 * sepia / grayscale / invert are parameterless (boolean toggles via
 * `applyFilter(name)` and `removeFilter(name)`).
 */
export interface FilterParams {
    readonly brightness?: number;
    readonly contrast?:   number;
    readonly saturation?: number;
    readonly blur?:       number;
    readonly noise?:      number;
    readonly pixelate?:   number;
}
