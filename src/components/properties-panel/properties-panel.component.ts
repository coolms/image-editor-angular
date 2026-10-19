import {
    ChangeDetectionStrategy, Component, computed, inject, input,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { IMAGE_EDITOR_TRANSLATOR } from '../../services/image-editor-host-ports';
import type { ToolMetadata } from '../../tools/tool.types';

/**
 * The properties panel, on the editor's right. With a tool active it shows that tool's properties (its component,
 * mounted through `NgComponentOutlet`, so the component's lifecycle drives the tool's activation) under the tool's
 * name and a close button. With none, it shows the image's own: its size, its format and how many layers it has.
 */
@Component({
    selector: 'coolms-image-editor-properties-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgComponentOutlet],
    templateUrl: './properties-panel.component.html',
    styleUrls: ['./properties-panel.component.scss'],
})
export class PropertiesPanelComponent {
    /** The file being edited, for the image's format. */
    readonly filename = input<string>('');

    protected readonly state    = inject(ImageEditorStateService);
    protected readonly registry = inject(ToolRegistryService);
    protected readonly t        = inject(IMAGE_EDITOR_TRANSLATOR);

    /** The active tool, or null when none is. */
    protected readonly activeTool = computed<ToolMetadata | null>(() => {
        const id = this.state.activeTool();
        return id === null ? null : this.registry.get(id) ?? null;
    });

    /** The format, from the file's extension, upper case; empty when the name has none. */
    protected readonly format = computed(() => {
        const name = this.filename();
        const dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : '';
    });

    close(): void {
        this.state.setActiveTool(null);
    }
}
