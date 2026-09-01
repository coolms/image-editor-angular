import type { Type } from '@angular/core';

/**
 * Categories used to group tools in the right-sidebar palette. The
 * union is closed so the sidebar can render named sections in a
 * deterministic order; new categories require an explicit addition
 * here so the styling stays consistent.
 */
export type ToolCategory = 'transform' | 'filter' | 'insert' | 'layers' | 'output';

/**
 * Metadata describing a tool. The shell uses `id` for state lookup,
 * `label` and `icon` for the sidebar button, `category` for grouping,
 * and `component` for rendering the properties panel through
 * `NgComponentOutlet`.
 *
 * Component is typed as `Type<unknown>` so tools that don't need the
 * `ImageEditorTool` lifecycle hooks (e.g., the stateless Flip tool)
 * can register without dragging in an unused implements clause.
 *
 * `inputs` lets one component class serve many tool entries by
 * differing only in data — used by the filter tools, where one
 * `SliderFilterComponent` (and one `ToggleFilterComponent`) backs
 * every entry in the Filters palette via its `config` input. The
 * right-sidebar pipes this map straight into `NgComponentOutlet`'s
 * `inputs` binding, which Angular forwards to the rendered
 * component's `input.required<T>()` declarations.
 */
export interface ToolMetadata {
    readonly id:        string;
    readonly label:     string;
    readonly icon:      string;
    readonly category:  ToolCategory;
    readonly component: Type<unknown>;
    readonly inputs?:   Readonly<Record<string, unknown>>;
}

/**
 * Optional lifecycle interface for tools that need to set up engine
 * state on activation (e.g., entering crop mode) and clean it up on
 * deactivation.
 *
 * The right-sidebar wires a tool's lifecycle to its component
 * lifecycle: `ngOnInit` -> `onActivate`, `ngOnDestroy` ->
 * `onDeactivate`. NgComponentOutlet creates and destroys the
 * properties component when the active tool changes, so this
 * mapping happens for free.
 */
export interface ImageEditorTool {
    onActivate(): void | Promise<void>;
    onDeactivate(): void | Promise<void>;
}
