/**
 * The image editor's tools as data, with no framework: what a tool is called, where it sits on the rail, and which key
 * selects it. An Angular or React host maps a tool's id to its own properties component; nothing here names one.
 *
 * Imports nothing outside `src/core/` (the lint rule for this directory refuses it).
 */

/** The rail's groups, in the order they are drawn. */
export type ToolGroup = 'transform' | 'insert' | 'filter' | 'layers';

export const TOOL_GROUPS: readonly { readonly id: ToolGroup; readonly labelKey: string }[] = [
    { id: 'transform', labelKey: 'imageEditor.group.transform' },
    { id: 'insert', labelKey: 'imageEditor.group.insert' },
    { id: 'filter', labelKey: 'imageEditor.group.filter' },
    { id: 'layers', labelKey: 'imageEditor.group.layers' },
];

export interface ToolDefinition {
    readonly id: string;
    /** The tool's name, as a message key (`imageEditor.tool.<id>`). */
    readonly labelKey: string;
    /** A Bootstrap Icons class. */
    readonly icon: string;
    readonly group: ToolGroup;
    /** Its place within the group, smallest first. */
    readonly order: number;
    /** One printable key that selects the tool while the editor has the keyboard, e.g. `c`. */
    readonly shortcut?: string;
}

/** How the rail draws its tools: with their names, or as icons whose names show as tooltips. */
export type RailMode = 'labels' | 'icons';

export const DEFAULT_RAIL_MODE: RailMode = 'labels';

/** A stored preference read back: anything but a known mode is the default. */
export function railModeFrom(stored: unknown): RailMode {
    return stored === 'labels' || stored === 'icons' ? stored : DEFAULT_RAIL_MODE;
}

/** The tools of each group, groups in rail order and tools by `order` then id; empty groups left out. */
export function groupTools<T extends ToolDefinition>(tools: readonly T[]): { group: ToolGroup; labelKey: string; tools: T[] }[] {
    return TOOL_GROUPS
        .map(g => ({
            group: g.id,
            labelKey: g.labelKey,
            tools: tools
                .filter(t => t.group === g.id)
                .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
        }))
        .filter(g => g.tools.length > 0);
}

/**
 * The tool a key selects: an unmodified printable key equal to a tool's shortcut (case ignored), or null. A key with
 * Ctrl, Alt or Meta is never a tool's: those belong to the editor's commands and the browser.
 */
export function toolForKey<T extends ToolDefinition>(
    tools: readonly T[],
    event: { readonly key: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean },
): T | null {
    if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) {
        return null;
    }
    const key = event.key.toLowerCase();
    return tools.find(t => t.shortcut !== undefined && t.shortcut.toLowerCase() === key) ?? null;
}
