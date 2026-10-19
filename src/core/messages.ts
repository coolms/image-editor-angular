/**
 * The image editor's own text: keys, and the base catalogue that holds their English. A host translates by handing the
 * editor a `Translator`; one that does not hear a key answers what the base catalogue holds, never the key.
 *
 * Imports nothing outside `src/core/` (the lint rule for this directory refuses it).
 */

/** Answers a key's text, `%name%` placeholders filled from `params`. */
export type Translator = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export const IMAGE_EDITOR_MESSAGES: Readonly<Record<string, string>> = {
    'imageEditor.group.transform': 'Transform',
    'imageEditor.group.insert': 'Insert',
    'imageEditor.group.filter': 'Filters',
    'imageEditor.group.layers': 'Layers',
    'imageEditor.tool.crop': 'Crop',
    'imageEditor.tool.rotate': 'Rotate',
    'imageEditor.tool.flip': 'Flip',
    'imageEditor.tool.resize': 'Resize',
    'imageEditor.tool.mask': 'Mask',
    'imageEditor.tool.shape': 'Shapes',
    'imageEditor.tool.text': 'Text',
    'imageEditor.tool.layers': 'Layers',
    'imageEditor.tool.filter-brightness': 'Brightness',
    'imageEditor.tool.filter-contrast': 'Contrast',
    'imageEditor.tool.filter-saturation': 'Saturation',
    'imageEditor.tool.filter-blur': 'Blur',
    'imageEditor.tool.filter-sepia': 'Sepia',
    'imageEditor.tool.filter-grayscale': 'Grayscale',
    'imageEditor.tool.filter-sharpen': 'Sharpen',
    'imageEditor.rail.title': 'Tools',
    'imageEditor.rail.showLabels': 'Show tool names',
    'imageEditor.rail.showIcons': 'Show icons only',
    'imageEditor.rail.shortcut': '%name% (%key%)',
    'imageEditor.panel.closeTool': 'Close the tool',
    'imageEditor.panel.image': 'Image',
    'imageEditor.panel.size': 'Size',
    'imageEditor.panel.sizeValue': '%width% x %height% px',
    'imageEditor.panel.format': 'Format',
    'imageEditor.panel.layers': 'Layers',
    'imageEditor.panel.noTool': 'Pick a tool on the left to change the image.',
};

/** Fills `%name%` placeholders; a placeholder with no value is left as it is. */
export function fill(text: string, params?: Readonly<Record<string, string | number>>): string {
    if (params === undefined) {
        return text;
    }
    return text.replace(/%([a-zA-Z]+)%/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The base catalogue's translator: a key it does not hold answers the key itself, so a gap shows in development. */
export const baseTranslator: Translator = (key, params) => fill(IMAGE_EDITOR_MESSAGES[key] ?? key, params);

/**
 * A host's catalogue in front of the base one: a key the host does not hold answers the base catalogue's English.
 * A partial translation degrades one message at a time, never to a key.
 */
export function catalogueTranslator(messages: Readonly<Record<string, string>>): Translator {
    return (key, params) => fill(messages[key] ?? IMAGE_EDITOR_MESSAGES[key] ?? key, params);
}
