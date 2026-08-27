import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { ImageEditorTool } from '../tool.types';
import type { Size } from '../../types/geometry.types';

/**
 * Properties panel for the Resize tool.
 *
 * Commit-style — no live preview. Live-resizing the canvas on every
 * keystroke would jank the editor, particularly for large images
 * where each resize is a full image-data rewrite. The user changes
 * the numeric fields, optionally toggles the aspect lock, then
 * commits with Apply.
 *
 * Aspect lock — captured against the original (pre-tool) dimensions
 * rather than the current input values so that toggling the lock
 * after free-form edits doesn't snap to a freshly-distorted ratio.
 * When width changes with the lock on, height auto-fills to
 * preserve the original ratio (and vice versa).
 *
 * The Apply path goes through `engine.resize(size)`, which the
 * fabric adapter implements as a bake-and-reload: the current image
 * (with rotation, flip, filters all applied) is rendered to a
 * temp canvas at the target dimensions and reloaded as a fresh
 * FabricImage. Single undo entry, exported bytes match the new
 * dimensions.
 */
@Component({
    selector: 'coolms-image-editor-resize-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './resize-tool.component.html',
    styleUrls: ['./resize-tool.component.scss'],
})
export class ResizeToolComponent implements ImageEditorTool {
    private readonly state = inject(ImageEditorStateService);

    readonly targetWidth  = signal<number>(0);
    readonly targetHeight = signal<number>(0);
    readonly aspectLocked = signal<boolean>(true);

    /**
     * Set to `true` the moment the user types or steps a value in
     * either input. While dirty, the live-sync effect below stops
     * overwriting the user's typed numbers from state. Reset and
     * Apply clear it so the next mouse drag flows back into the
     * inputs.
     */
    private readonly userDirty = signal<boolean>(false);

    /** Live image dimensions in canvas-coords (natural × |scale|). */
    private readonly liveSize = computed<Size>(() => {
        const size = this.state.canvasSize();
        if (size === null) return { width: 0, height: 0 };
        const scaleX = Math.abs(this.state.imageScaleX());
        const scaleY = Math.abs(this.state.imageScaleY());
        return {
            width:  Math.max(1, Math.round(size.width  * scaleX)),
            height: Math.max(1, Math.round(size.height * scaleY)),
        };
    });

    /**
     * Aspect-ratio baseline for the lock. Pinned to the live image
     * dimensions while the user hasn't edited the inputs, captured
     * to a snapshot the moment they do, so a mid-edit width change
     * with the lock on doesn't snap to a freshly-distorted ratio.
     */
    private readonly aspectBaseline = signal<{ width: number; height: number }>({ width: 0, height: 0 });

    private readonly originalAspect = computed(() => {
        const a = this.aspectBaseline();
        return a.height > 0 ? a.width / a.height : 1;
    });

    readonly isDirty = computed(() => {
        const live = this.liveSize();
        return this.targetWidth() !== live.width || this.targetHeight() !== live.height;
    });

    readonly canApply = computed(() =>
        this.isDirty()
        && this.targetWidth()  > 0
        && this.targetHeight() > 0
        && this.state.isReady(),
    );

    /**
     * Display value the template binds for "Original: WxH". Also
     * pinned to the live image dimensions when the user hasn't
     * touched the inputs; once they have, it freezes at the size
     * captured at first edit so the user has a stable reference
     * while typing.
     */
    readonly originalView = this.aspectBaseline.asReadonly();

    constructor() {
        // Live-sync the inputs to the visually-current image
        // dimensions. Picks up:
        //   - the initial dimensions when the tool first opens
        //     (ngOnInit equivalent now folded in here)
        //   - mouse-driven scale changes from corner-handle drags
        //   - undo / redo of any prior resize / scale operation
        // Stops overwriting once the user has typed a value, so the
        // sync doesn't fight the editor.
        effect(() => {
            const live = this.liveSize();
            if (live.width === 0 || live.height === 0) return;
            if (this.userDirty()) return;
            this.aspectBaseline.set(live);
            this.targetWidth.set(live.width);
            this.targetHeight.set(live.height);
        });
    }

    onActivate():   void { /* live-sync handled by the effect */ }
    onDeactivate(): void { /* nothing to clean up */ }

    onWidthChange(value: number): void {
        const valid = Math.max(1, Math.round(value));
        if (!this.userDirty()) this.aspectBaseline.set(this.liveSize());
        this.userDirty.set(true);
        this.targetWidth.set(valid);
        if (this.aspectLocked()) {
            this.targetHeight.set(Math.max(1, Math.round(valid / this.originalAspect())));
        }
    }

    onHeightChange(value: number): void {
        const valid = Math.max(1, Math.round(value));
        if (!this.userDirty()) this.aspectBaseline.set(this.liveSize());
        this.userDirty.set(true);
        this.targetHeight.set(valid);
        if (this.aspectLocked()) {
            this.targetWidth.set(Math.max(1, Math.round(valid * this.originalAspect())));
        }
    }

    toggleAspectLock(): void { this.aspectLocked.update(v => !v); }

    reset(): void {
        // Drop the dirty flag so the live-sync effect repopulates
        // the inputs from the current image state on the next tick.
        this.userDirty.set(false);
        const live = this.liveSize();
        this.aspectBaseline.set(live);
        this.targetWidth.set(live.width);
        this.targetHeight.set(live.height);
    }

    async applyResize(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null || !this.canApply()) return;

        const newSize: Size = {
            width:  this.targetWidth(),
            height: this.targetHeight(),
        };
        await engine.resize(newSize);
        // Refresh the cached canvas size so any subsequent tool
        // (or this tool re-opened) sees the new baseline.
        this.state.updateCanvasSize(newSize);
        // Clear the dirty flag so a re-open of the tool sees the
        // freshly resized image's dimensions through the live sync
        // rather than the stale values we just typed.
        this.userDirty.set(false);
        this.state.setActiveTool(null);
    }

    cancel(): void { this.state.setActiveTool(null); }
}
