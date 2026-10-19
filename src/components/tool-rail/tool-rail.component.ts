import {
    ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { IMAGE_EDITOR_RAIL_MODE, IMAGE_EDITOR_TRANSLATOR } from '../../services/image-editor-host-ports';
import { railModeFrom, type RailMode, type ToolDefinition } from '../../core/tools';

/**
 * The tool rail, on the editor's left: the tools in their groups, top to bottom. Two modes, which the person switches
 * at the rail's foot and the host remembers for them -- each tool with its name, or as an icon whose name (and
 * shortcut) is its tooltip. Clicking a tool opens its properties on the right; clicking it again closes them. The
 * active tool is always in view: when it changes, the rail scrolls to it.
 */
@Component({
    selector: 'coolms-image-editor-tool-rail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './tool-rail.component.html',
    styleUrls: ['./tool-rail.component.scss'],
})
export class ToolRailComponent {
    protected readonly state    = inject(ImageEditorStateService);
    protected readonly registry = inject(ToolRegistryService);
    protected readonly t        = inject(IMAGE_EDITOR_TRANSLATOR);
    private readonly modeStore  = inject(IMAGE_EDITOR_RAIL_MODE);
    private readonly host       = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly mode = signal<RailMode>(railModeFrom(this.modeStore.read()));

    constructor() {
        // The active tool is always visible: a tool chosen by its shortcut, or a long rail, scrolls to it.
        effect(() => {
            const id = this.state.activeTool();
            if (id === null) return;
            queueMicrotask(() => {
                const button = this.host.nativeElement.querySelector<HTMLElement>(`[data-tool="${CSS.escape(id)}"]`);
                button?.scrollIntoView?.({ block: 'nearest' });
            });
        });
    }

    select(id: string): void {
        // Clicking the active tool again closes it.
        this.state.setActiveTool(this.state.activeTool() === id ? null : id);
    }

    isActive(id: string): boolean {
        return this.state.activeTool() === id;
    }

    toggleMode(): void {
        const next: RailMode = this.mode() === 'labels' ? 'icons' : 'labels';
        this.mode.set(next);
        this.modeStore.write(next);
    }

    /** A tool's tooltip: its name, and its shortcut when it has one. */
    tooltip(tool: ToolDefinition): string {
        const name = this.t(tool.labelKey);
        return tool.shortcut === undefined
            ? name
            : this.t('imageEditor.rail.shortcut', { name, key: tool.shortcut.toUpperCase() });
    }
}
