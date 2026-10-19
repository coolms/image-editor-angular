import { DEFAULT_RAIL_MODE, groupTools, railModeFrom, toolForKey, type ToolDefinition } from './tools';
import { baseTranslator, catalogueTranslator, fill, IMAGE_EDITOR_MESSAGES } from './messages';

/**
 * The editor's tools and text as data: the rail's groups and order, the stored rail mode read back, which key selects
 * which tool, and the text a key answers.
 */
describe('image editor core -- the tools and their text as data', () => {
    const tool = (id: string, group: ToolDefinition['group'], order: number, shortcut?: string): ToolDefinition =>
        ({ id, labelKey: 'imageEditor.tool.' + id, icon: 'bi-x', group, order, shortcut });

    it('groups the tools in rail order, each group by order then id, and leaves empty groups out', () => {
        const groups = groupTools([
            tool('text', 'insert', 20), tool('crop', 'transform', 10), tool('shape', 'insert', 10),
            tool('b', 'transform', 20), tool('a', 'transform', 20),
        ]);

        expect(groups.map(g => g.group)).toEqual(['transform', 'insert']);
        expect(groups[0].tools.map(t => t.id)).toEqual(['crop', 'a', 'b']);
        expect(groups[1].tools.map(t => t.id)).toEqual(['shape', 'text']);
        expect(groups[0].labelKey).toBe('imageEditor.group.transform');
    });

    it('reads a stored rail mode back, and anything else as the default', () => {
        expect(railModeFrom('icons')).toBe('icons');
        expect(railModeFrom('labels')).toBe('labels');
        for (const stored of [null, undefined, '', 'Icons', 3, {}]) {
            expect(railModeFrom(stored)).withContext(String(stored)).toBe(DEFAULT_RAIL_MODE);
        }
    });

    it('a key selects the tool whose shortcut it is, case ignored; with Ctrl, Alt or Meta, or a named key, none', () => {
        const tools = [tool('crop', 'transform', 10, 'c'), tool('text', 'insert', 20, 't'), tool('layers', 'layers', 10)];
        const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
            ({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...mods });

        expect(toolForKey(tools, key('c'))?.id).toBe('crop');
        expect(toolForKey(tools, key('C'))?.id).toBe('crop');
        expect(toolForKey(tools, key('t'))?.id).toBe('text');
        expect(toolForKey(tools, key('x'))).toBeNull();
        expect(toolForKey(tools, key('c', { ctrlKey: true }))).toBeNull();
        expect(toolForKey(tools, key('c', { altKey: true }))).toBeNull();
        expect(toolForKey(tools, key('c', { metaKey: true }))).toBeNull();
        expect(toolForKey(tools, key('Delete'))).toBeNull();
    });

    it('a key\'s text: placeholders filled; a host\'s catalogue in front of the base one, never the key', () => {
        expect(fill('%width% x %height% px', { width: 800, height: 600 })).toBe('800 x 600 px');
        expect(fill('%name% (%missing%)', { name: 'Crop' })).toBe('Crop (%missing%)');
        expect(baseTranslator('imageEditor.tool.crop')).toBe('Crop');
        expect(baseTranslator('imageEditor.no.such.key')).withContext('a gap shows in development').toBe('imageEditor.no.such.key');

        const t = catalogueTranslator({ 'imageEditor.tool.crop': 'Rogner', 'imageEditor.tool.rotate': '' });
        expect(t('imageEditor.tool.crop')).toBe('Rogner');
        expect(t('imageEditor.tool.text')).withContext('the host lacks it: the base English').toBe(IMAGE_EDITOR_MESSAGES['imageEditor.tool.text']);
        expect(t('imageEditor.tool.rotate')).withContext('the host holds it blank: the base English, not an empty label')
            .toBe(IMAGE_EDITOR_MESSAGES['imageEditor.tool.rotate']);
    });
});
