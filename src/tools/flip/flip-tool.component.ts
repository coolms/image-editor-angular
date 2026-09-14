import {
    ChangeDetectionStrategy, Component, inject, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';

/**
 * Properties panel for the Flip tool. Stateless on commit -- each
 * click flips the canvas immediately, no Apply / Cancel.
 *
 * The visual `--active` state on each button is local to the tool's
 * lifetime: when the user closes the tool and reopens it, both
 * indicators reset even if the canvas is currently flipped. Toast
 * UI doesn't expose a public getter for the canvas's flip state, so
 * tracking it across tool re-opens would require burrowing into
 * private fabric.js state -- not worth the fragility for an
 * indicator. The actual canvas pixels are the source of truth; the
 * undo stack reverses any flip if the user wants to back out.
 */
@Component({
    selector: 'coolms-image-editor-flip-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './flip-tool.component.html',
    styleUrls: ['./flip-tool.component.scss'],
})
export class FlipToolComponent {
    private readonly state = inject(ImageEditorStateService);

    // Bound to the transform target's flip state (selected layer, else
    // the base image -- C.1c) so the button highlight tracks any path
    // that mutates flipX/flipY: this tool's buttons, a mouse rotation
    // that crosses 180 deg, an undo/redo, or a flip via another tool.
    readonly flippedH = this.state.transformTargetFlipX;
    readonly flippedV = this.state.transformTargetFlipY;

    async toggleHorizontal(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;
        await engine.flip('horizontal');
    }

    async toggleVertical(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;
        await engine.flip('vertical');
    }

    closeTool(): void {
        this.state.setActiveTool(null);
    }
}
