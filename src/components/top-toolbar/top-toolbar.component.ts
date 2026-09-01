import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';

/**
 * Action commands for the editor: history (undo / redo), reset, and a
 * read-only image-size badge. beta.3 ships these because they are
 * engine-level concerns the shell already exposes via the state
 * service — tool-specific buttons (crop, rotate, etc.) come in beta.4.
 *
 * The toolbar talks to the engine through the state service rather
 * than holding its own engine reference; that keeps it interchangeable
 * with whatever beta.4 wires up.
 */
@Component({
    selector: 'coolms-image-editor-top-toolbar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './top-toolbar.component.html',
    styleUrls: ['./top-toolbar.component.scss'],
})
export class TopToolbarComponent {
    protected readonly state = inject(ImageEditorStateService);

    async undo(): Promise<void> {
        const engine = this.state.engine();
        if (engine !== null) await engine.undo();
    }

    async redo(): Promise<void> {
        const engine = this.state.engine();
        if (engine !== null) await engine.redo();
    }

    async reset(): Promise<void> {
        // Goes through the state service's reset() rather than
        // calling engine.reset() directly so the active tool gets
        // closed and the viewport zoom snaps back to 100% in the
        // same action.
        await this.state.reset();
    }
}
