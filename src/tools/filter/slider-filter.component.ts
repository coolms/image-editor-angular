import {
    ChangeDetectionStrategy, Component, OnDestroy, OnInit,
    computed, inject, input, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { ImageEditorTool } from '../tool.types';
import type { SliderFilterConfig } from './filter.types';
import type { FilterParams } from '../../types/filter.types';

/**
 * Generic slider-driven filter tool (Brightness, Contrast,
 * Saturation, Blur).
 *
 * Live preview model -- each slider drag applies the filter to the
 * canvas immediately so the user sees the change in real time. The
 * undo stack stays clean by undoing the previous preview before
 * applying the new one: at any moment during a preview session the
 * stack holds at most a single preview entry.
 *
 *   drag -> [undo prev preview] -> apply new preview -> repeat
 *   apply -> commit (no engine call; current preview already on canvas)
 *           -> clearRedoStack() so the redo button doesn't surface
 *              stale intermediate values
 *   cancel -> undo() the in-flight preview
 *           -> clearRedoStack()
 *
 * Coalescing -- slider `input` events fire much faster than each
 * undo+apply cycle can finish (especially for Blur on large images).
 * The `inFlight` guard drops intermediate values; only the most
 * recent slider position is rendered. The stale ones are silently
 * abandoned, so the UI never falls behind the pointer.
 *
 * Identity-value short-circuit -- when the slider sits at `default`
 * (typically 0), the tool removes the filter entirely instead of
 * applying an identity pass. This means the pre-tool canvas state
 * is byte-equal to the "slider returned to zero" state.
 */
@Component({
    selector: 'coolms-image-editor-slider-filter',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './slider-filter.component.html',
    styleUrls: ['./slider-filter.component.scss'],
})
export class SliderFilterComponent implements OnInit, OnDestroy, ImageEditorTool {
    private readonly state = inject(ImageEditorStateService);

    readonly config = input.required<SliderFilterConfig>();

    readonly currentValue = signal<number>(0);
    /**
     * Tracks whether we have an un-committed preview filter on the
     * canvas. `null` means no preview is currently applied (either
     * because we're at the default value or the preview was reverted).
     */
    private readonly previewActive = signal<boolean>(false);

    readonly isDirty = computed(() => this.currentValue() !== this.config().default);

    /** Coalescing state for the slider input handler. */
    private inFlight = false;
    private pendingValue: number | null = null;

    ngOnInit(): void {
        this.currentValue.set(this.config().default);
    }

    async ngOnDestroy(): Promise<void> {
        // If the user closed the tool without Apply or Cancel
        // (e.g., switched to another tool) revert any preview so the
        // canvas stays in the same state it was in before activation.
        await this.onDeactivate();
    }

    onActivate(): void { /* nothing extra; preview only fires on slider input */ }

    async onDeactivate(): Promise<void> {
        if (this.previewActive()) {
            await this.revertPreview();
        }
    }

    onSliderInput(value: number): void {
        this.currentValue.set(value);
        this.pendingValue = value;
        // Fire-and-forget the coalescer; awaiting would block the UI
        // event handler, which is the opposite of what we want.
        void this.processPendingValue();
    }

    async applyAndCommit(): Promise<void> {
        // Drain any in-flight preview so the canvas matches `currentValue()`.
        // Without this, a fast-clicked Apply right after a slider drag could
        // commit the previous-but-one preview value.
        await this.flushPending();

        const engine = this.state.engine();
        if (engine === null) return;

        // The current preview entry stays in the undo stack as the
        // committed change; we just stop tracking it as "in-flight"
        // and clear the redo stack of stale preview cycles.
        this.previewActive.set(false);
        engine.clearRedoStack();
        this.state.setActiveTool(null);
    }

    async cancel(): Promise<void> {
        await this.flushPending();
        await this.revertPreview();
        const engine = this.state.engine();
        engine?.clearRedoStack();
        this.state.setActiveTool(null);
    }

    async reset(): Promise<void> {
        this.currentValue.set(this.config().default);
        this.pendingValue = this.config().default;
        await this.processPendingValue();
    }

    private async processPendingValue(): Promise<void> {
        if (this.inFlight) return;
        this.inFlight = true;
        try {
            while (this.pendingValue !== null) {
                const value = this.pendingValue;
                this.pendingValue = null;
                await this.applyPreview(value);
            }
        } finally {
            this.inFlight = false;
        }
    }

    private async flushPending(): Promise<void> {
        // If a preview is mid-flight, wait until the queue drains.
        // Re-enters the processor in case the queue picked up a new
        // value between calls.
        while (this.inFlight || this.pendingValue !== null) {
            await Promise.resolve();
            if (this.pendingValue !== null && !this.inFlight) {
                await this.processPendingValue();
            }
        }
    }

    private async applyPreview(value: number): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;

        if (this.previewActive()) {
            await engine.undo();
            this.previewActive.set(false);
        }

        if (value === this.config().default) {
            // No filter to apply at the identity value; the canvas is
            // already in the pre-filter state after the undo above.
            return;
        }

        const params = { [this.config().paramKey]: value } as FilterParams;
        await engine.applyFilter(this.config().filterName, params);
        this.previewActive.set(true);
    }

    private async revertPreview(): Promise<void> {
        if (!this.previewActive()) return;
        const engine = this.state.engine();
        if (engine === null) return;
        await engine.undo();
        this.previewActive.set(false);
    }
}
