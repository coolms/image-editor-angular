import {
    ChangeDetectionStrategy, Component, computed, inject,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import type { ToolMetadata } from '../../tools/tool.types';

/**
 * Tool-picker pane.
 *
 * Renders the registered tools grouped by category (β.4a ships only
 * the `transform` group). The active tool's properties component is
 * mounted into the lower slot via `NgComponentOutlet` — that
 * component's lifecycle (`ngOnInit` / `ngOnDestroy`) drives the
 * tool's activation hooks, so the sidebar stays a dumb shell.
 *
 * The tool catalogue is rendered ahead-of-mount; buttons are
 * disabled until `state.isReady()` to prevent users from clicking
 * Crop while the engine is still loading the image.
 */
@Component({
    selector: 'coolms-image-editor-right-sidebar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgComponentOutlet],
    templateUrl: './right-sidebar.component.html',
    styleUrls: ['./right-sidebar.component.scss'],
})
export class RightSidebarComponent {
    protected readonly state    = inject(ImageEditorStateService);
    protected readonly registry = inject(ToolRegistryService);

    /** Tools to surface in the Transform section. */
    protected readonly transformTools = computed<ToolMetadata[]>(
        () => this.registry.byCategory('transform'),
    );

    /** Tools to surface in the Filters section (β.4b). */
    protected readonly filterTools = computed<ToolMetadata[]>(
        () => this.registry.byCategory('filter'),
    );

    /** Insert tools — shapes / text (C.1). */
    protected readonly insertTools = computed<ToolMetadata[]>(
        () => this.registry.byCategory('insert'),
    );

    /** Layers panel entry (C.1). */
    protected readonly layersTools = computed<ToolMetadata[]>(
        () => this.registry.byCategory('layers'),
    );

    /** Metadata of the currently-active tool, or `null` if none. */
    protected readonly activeTool = computed<ToolMetadata | null>(() => {
        const id = this.state.activeTool();
        if (id === null) return null;
        return this.registry.get(id) ?? null;
    });

    selectTool(id: string): void {
        // Re-clicking an already-active tool deactivates it; matches the
        // common UX of "click the icon again to close the panel".
        if (this.state.activeTool() === id) {
            this.state.setActiveTool(null);
            return;
        }
        this.state.setActiveTool(id);
    }

    deactivateTool(): void {
        this.state.setActiveTool(null);
    }

    isActive(id: string): boolean {
        return this.state.activeTool() === id;
    }
}
