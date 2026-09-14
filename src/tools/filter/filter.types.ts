import type { FilterName, FilterParams } from '../../types/filter.types';

/**
 * Config for a slider-style filter tool (Brightness, Contrast,
 * Saturation, Blur). Drives both the UI rendering and the engine
 * call: `paramKey` is the property on `FilterParams` the slider's
 * value writes to.
 *
 * `default` is the value at which the filter is treated as "off"
 * (typically 0). When the slider sits at the default, the tool
 * removes the filter entirely instead of applying an identity pass --
 * keeps the canvas pixel-perfect equal to the pre-tool state when
 * the user lands back on zero.
 */
export interface SliderFilterConfig {
    readonly type:        'slider';
    readonly filterName:  FilterName;
    readonly label:       string;
    readonly icon:        string;
    readonly min:         number;
    readonly max:         number;
    readonly step:        number;
    readonly default:     number;
    /** Property name on `FilterParams` to write the slider value to. */
    readonly paramKey:    keyof FilterParams;
}

/**
 * Config for a parameter-less filter (Sepia, Grayscale, Sharpen).
 * The tool just toggles the filter on or off through the engine's
 * `applyFilter` / `removeFilter` pair.
 */
export interface ToggleFilterConfig {
    readonly type:        'toggle';
    readonly filterName:  FilterName;
    readonly label:       string;
    readonly icon:        string;
}

export type FilterToolConfig = SliderFilterConfig | ToggleFilterConfig;
