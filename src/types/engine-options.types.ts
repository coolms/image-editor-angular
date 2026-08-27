import type { Size } from './geometry.types';

/**
 * Construction options for any `ImageEditorEngine`. The container is
 * required; everything else is optional with sensible defaults.
 *
 * No engine-specific knobs leak into this shape — Toast-UI-only
 * options (selectionStyle borderColor etc.) belong on a Toast-UI-only
 * sub-options bag if a future shell needs to thread them through. For
 * MVP, the defaults are enough.
 */
export interface EngineOptions {
    /** DOM element the engine mounts its canvas into. */
    readonly container: HTMLElement;

    /** Initial canvas size. Defaults to the container's measured size. */
    readonly initialSize?: Size;

    /** Display-side cap for canvas width in CSS pixels. */
    readonly cssMaxWidth?: number;

    /** Display-side cap for canvas height in CSS pixels. */
    readonly cssMaxHeight?: number;

    /**
     * Toast UI's anonymised usage telemetry. Off by default; flip true
     * only with explicit user consent.
     */
    readonly usageStatistics?: boolean;
}
