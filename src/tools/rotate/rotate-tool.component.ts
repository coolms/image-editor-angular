import {
    ChangeDetectionStrategy, Component, OnDestroy,
    computed, effect, inject, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';

/**
 * Properties panel for the Rotate tool.
 *
 * Two interaction modes side-by-side:
 *
 *   - **Quick presets** (90 deg CCW, 90 deg CW, 180 deg). Each button calls
 *     `engine.rotate(degrees)` immediately (relative rotation), which
 *     pushes a single command. Pressing 90 deg CW four times returns to
 *     the original orientation, with four entries in the undo stack.
 *
 *   - **Free rotation slider** (-180..+180 in 1 deg steps). The slider's
 *     value is bound to the live image angle (`state.imageRotation`)
 *     so it stays in sync with mouse-driven rotations on the canvas.
 *     During a drag we use the same preview / commit cycle the
 *     filter sliders use: each input event undoes the previous
 *     preview and applies a fresh rotation from the captured
 *     baseline, so the undo stack ends up with one entry per drag
 *     session rather than one per pixel of slider movement.
 *     `clearRedoStack` on release drops the phantom redo entries
 *     left behind by the undo cycles.
 */
@Component({
    selector: 'coolms-image-editor-rotate-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './rotate-tool.component.html',
    styleUrls: ['./rotate-tool.component.scss'],
})
export class RotateToolComponent implements OnDestroy {
    private readonly state = inject(ImageEditorStateService);

    /**
     * Angle the slider currently displays. Mirrors
     * `state.imageRotation()` while the user isn't actively dragging.
     * During a drag, the user's input value wins so a programmatic
     * mid-drag state change (from the preview cycle's undo step) doesn't
     * yank the slider thumb away from the user's finger.
     */
    readonly displayAngle = signal<number>(0);

    /** Whether the user is currently dragging the slider. */
    readonly dragging = signal<boolean>(false);

    /** True while a preview rotation is currently applied to the engine. */
    private readonly previewActive = signal<boolean>(false);

    /**
     * Image angle captured at the start of the current drag session.
     * Each preview applies `target - baseline` so successive previews
     * compose correctly even after the intermediate undo. Reset to
     * `null` between drag sessions.
     */
    private dragBaselineAngle: number | null = null;

    readonly currentDisplayAngle = computed(() => Math.round(this.displayAngle() * 10) / 10);

    constructor() {
        effect(() => {
            // Pull state into the slider when no drag is in progress.
            // During a drag the user's input is authoritative; once
            // they release, the next state emission re-syncs us. Reads
            // the transform target (selected layer, else the base
            // image) so the slider rotates whatever's selected (C.1c).
            if (!this.dragging()) {
                this.displayAngle.set(this.state.transformTargetRotation());
            }
        });
    }

    ngOnDestroy(): void {
        // Tool dismissed while still mid-drag (rare): commit cleanly so
        // the undo stack lands in a sane shape. The last preview stays
        // as the committed entry; phantom redo entries get cleared.
        if (this.dragging()) this.commitDrag();
    }

    async rotatePreset(degrees: number): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;
        // A preset click while the user is mid-drag would stack a
        // standalone preset command on top of the in-flight preview
        // entry. Cancel any active drag session first so the engine
        // sees a clean state.
        if (this.dragging()) this.commitDrag();
        await engine.rotate(degrees);
    }

    async onSliderInput(value: number): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;

        if (!this.dragging()) {
            this.dragging.set(true);
            this.dragBaselineAngle = this.state.transformTargetRotation();
        }
        this.displayAngle.set(value);

        if (this.previewActive()) {
            await engine.undo();
            this.previewActive.set(false);
        }

        const baseline = this.dragBaselineAngle ?? 0;
        const delta = value - baseline;
        if (Math.abs(delta) < 0.01) return;

        await engine.rotate(delta);
        this.previewActive.set(true);
    }

    onSliderChange(): void {
        if (this.dragging()) this.commitDrag();
    }

    closeTool(): void {
        if (this.dragging()) this.commitDrag();
        this.state.setActiveTool(null);
    }

    private commitDrag(): void {
        const engine = this.state.engine();
        engine?.clearRedoStack();
        this.dragging.set(false);
        this.previewActive.set(false);
        this.dragBaselineAngle = null;
    }
}
