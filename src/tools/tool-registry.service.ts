import { Injectable, computed, signal } from '@angular/core';
import type { ToolMetadata, ToolCategory } from './tool.types';

/**
 * Registry of image-editor tools.
 *
 * Tools register themselves via the shell's constructor (beta.4a) so the
 * service can stay agnostic of which tools ship in any given build --
 * the same registry plays host to beta.4a's transform tools, beta.4b's
 * filter sliders, and beta.4c's resize / zoom without further changes.
 *
 * Provided in `root` so the registry is shared across any future
 * shell instances (e.g., two editors open in different dialogs). The
 * `ImageEditorStateService` it complements is component-scoped -- that
 * one tracks per-editor active tool, this one tracks the global
 * catalogue of available tools.
 *
 * Re-registering an id replaces the existing entry: this lets a host
 * swap a tool's component for testing without unwiring the rest.
 */
@Injectable({ providedIn: 'root' })
export class ToolRegistryService {
    private readonly toolsMap = signal<ReadonlyMap<string, ToolMetadata>>(new Map());

    readonly tools = computed(() => Array.from(this.toolsMap().values()));

    register(tool: ToolMetadata): void {
        this.toolsMap.update(map => {
            const next = new Map(map);
            next.set(tool.id, tool);
            return next;
        });
    }

    get(id: string): ToolMetadata | undefined {
        return this.toolsMap().get(id);
    }

    byCategory(category: ToolCategory): ToolMetadata[] {
        return this.tools().filter(t => t.category === category);
    }
}
