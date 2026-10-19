import type { Type } from '@angular/core';
import type { ToolDefinition, ToolGroup } from '../core/tools';

/**
 * Where a tool sits on the rail. The groups and their order are data in `core/tools.ts`, so a React host draws the
 * same rail.
 */
export type ToolCategory = ToolGroup;

/**
 * A tool as the Angular editor registers it: its definition (`core/tools.ts`: id, name key, icon, group, order,
 * shortcut) and the component that shows its properties in the right panel through `NgComponentOutlet`.
 *
 * Component is typed as `Type<unknown>` so tools that don't need the
 * `ImageEditorTool` lifecycle hooks (e.g., the stateless Flip tool)
 * can register without dragging in an unused implements clause.
 *
 * `inputs` lets one component class serve many tool entries by
 * differing only in data -- used by the filter tools, where one
 * `SliderFilterComponent` (and one `ToggleFilterComponent`) backs
 * every entry in the Filters group via its `config` input. The
 * properties panel pipes this map straight into `NgComponentOutlet`'s
 * `inputs` binding, which Angular forwards to the rendered
 * component's `input.required<T>()` declarations.
 */
export interface ToolMetadata extends ToolDefinition {
    readonly component: Type<unknown>;
    readonly inputs?:   Readonly<Record<string, unknown>>;
}

/**
 * Optional lifecycle interface for tools that need to set up engine
 * state on activation (e.g., entering crop mode) and clean it up on
 * deactivation.
 *
 * The properties panel wires a tool's lifecycle to its component
 * lifecycle: `ngOnInit` -> `onActivate`, `ngOnDestroy` ->
 * `onDeactivate`. NgComponentOutlet creates and destroys the
 * properties component when the active tool changes, so this
 * mapping happens for free.
 */
export interface ImageEditorTool {
    onActivate(): void | Promise<void>;
    onDeactivate(): void | Promise<void>;
}
