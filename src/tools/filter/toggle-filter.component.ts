import {
    ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { ToggleFilterConfig } from './filter.types';

/**
 * Generic toggle-style filter tool (Sepia, Grayscale, Sharpen).
 *
 * The "applied" state is read from the engine on activation via
 * `hasFilter(name)` so opening the tool against an already-applied
 * filter shows the correct indicator. Each toggle commits to the
 * undo stack (apply or remove); the user can revert through the
 * top toolbar's Undo button just like any other operation.
 */
@Component({
    selector: 'coolms-image-editor-toggle-filter',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './toggle-filter.component.html',
    styleUrls: ['./toggle-filter.component.scss'],
})
export class ToggleFilterComponent implements OnInit {
    protected readonly state = inject(ImageEditorStateService);

    readonly config = input.required<ToggleFilterConfig>();

    readonly isApplied = signal<boolean>(false);
    readonly buttonLabel = computed(() => this.isApplied() ? 'Remove' : 'Apply');

    ngOnInit(): void {
        const engine = this.state.engine();
        if (engine === null) return;
        this.isApplied.set(engine.hasFilter(this.config().filterName));
    }

    async toggle(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;

        if (this.isApplied()) {
            await engine.removeFilter(this.config().filterName);
            this.isApplied.set(false);
        } else {
            await engine.applyFilter(this.config().filterName);
            this.isApplied.set(true);
        }
    }

    closeTool(): void {
        this.state.setActiveTool(null);
    }
}
