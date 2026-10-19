import { Component, signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, type ComponentFixture } from '@angular/core/testing';
import { ToolRailComponent } from './tool-rail.component';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { IMAGE_EDITOR_RAIL_MODE, type RailModeStore } from '../../services/image-editor-host-ports';
import type { RailMode } from '../../core/tools';

@Component({ standalone: true, template: '' })
class NoPropertiesComponent {}

/**
 * The tool rail: the tools in their groups, with their names or as icons whose names and shortcuts are tooltips. The
 * mode is switched at the rail's foot and handed to the host to remember. A click opens a tool, a second click closes
 * it, and the active tool is scrolled into view.
 */
describe('ToolRailComponent -- the tools in their groups, with names or as icons', () => {
    let fixture: ComponentFixture<ToolRailComponent>;
    let active: ReturnType<typeof signal<string | null>>;
    let written: RailMode[];

    function build(stored: RailMode | null): HTMLElement {
        active = signal<string | null>(null);
        written = [];
        const store: RailModeStore = { read: () => stored, write: mode => { written.push(mode); } };
        TestBed.configureTestingModule({
            imports: [ToolRailComponent],
            providers: [
                {
                    provide: ImageEditorStateService,
                    useValue: { activeTool: active, isReady: signal(true), setActiveTool: (id: string | null) => active.set(id) },
                },
                { provide: IMAGE_EDITOR_RAIL_MODE, useValue: store },
            ],
        });
        const registry = TestBed.inject(ToolRegistryService);
        registry.register({ id: 'crop', labelKey: 'imageEditor.tool.crop', icon: 'bi-crop', group: 'transform', order: 10, shortcut: 'c', component: NoPropertiesComponent });
        registry.register({ id: 'text', labelKey: 'imageEditor.tool.text', icon: 'bi-fonts', group: 'insert', order: 20, shortcut: 't', component: NoPropertiesComponent });
        registry.register({ id: 'filter-blur', labelKey: 'imageEditor.tool.filter-blur', icon: 'bi-cloud', group: 'filter', order: 10, component: NoPropertiesComponent });
        fixture = TestBed.createComponent(ToolRailComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const tool = (el: HTMLElement, id: string) => el.querySelector(`[data-tool="${id}"]`) as HTMLButtonElement;

    it('with names: each group under its heading, each tool with its icon and its name', () => {
        const el = build(null);

        expect(Array.from(el.querySelectorAll('.tool-rail__group-label')).map(h => h.textContent?.trim()))
            .toEqual(['Transform', 'Insert', 'Filters']);
        expect(tool(el, 'crop').textContent?.trim()).toBe('Crop');
        expect(tool(el, 'crop').querySelector('.bi-crop')).not.toBeNull();
        expect(tool(el, 'crop').title).toBe('Crop (C)');
        expect(tool(el, 'filter-blur').title).withContext('no shortcut: the name alone').toBe('Blur');
    });

    it('as icons: no names drawn; each tool says its name and shortcut as its tooltip and its accessible name', () => {
        const el = build('icons');

        expect(el.querySelector('.tool-rail--icons')).not.toBeNull();
        expect(el.querySelectorAll('.tool-rail__group-label').length).toBe(0);
        expect(tool(el, 'text').textContent?.trim()).toBe('');
        expect(tool(el, 'text').title).toBe('Text (T)');
        expect(tool(el, 'text').getAttribute('aria-label')).toBe('Text');
    });

    it('the mode switches at the rail\'s foot and is handed to the host to remember', () => {
        const el = build(null);
        const mode = el.querySelector('[data-test="rail-mode"]') as HTMLButtonElement;

        mode.click();
        fixture.detectChanges();
        expect(el.querySelector('.tool-rail--icons')).not.toBeNull();
        expect(written).toEqual(['icons']);

        mode.click();
        fixture.detectChanges();
        expect(el.querySelector('.tool-rail--icons')).toBeNull();
        expect(written).toEqual(['icons', 'labels']);
    });

    it('a click opens a tool, a second click closes it, and the active one is marked', () => {
        const el = build(null);

        tool(el, 'crop').click();
        fixture.detectChanges();
        expect(active()).toBe('crop');
        expect(tool(el, 'crop').classList).toContain('tool-rail__tool--active');
        expect(tool(el, 'crop').getAttribute('aria-pressed')).toBe('true');

        tool(el, 'crop').click();
        expect(active()).toBeNull();
    });

    it('the active tool is scrolled into view, however it was chosen', fakeAsync(() => {
        const el = build('icons');
        const scrolled = spyOn(tool(el, 'filter-blur'), 'scrollIntoView');

        active.set('filter-blur');
        fixture.detectChanges();
        flushMicrotasks();

        expect(scrolled).toHaveBeenCalledOnceWith({ block: 'nearest' });
    }));
});
