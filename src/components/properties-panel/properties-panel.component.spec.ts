import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PropertiesPanelComponent } from './properties-panel.component';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';

@Component({ standalone: true, template: '<p class="crop-properties">the crop tool\'s properties</p>' })
class CropPropertiesComponent {}

/**
 * The properties panel: the active tool's properties under its name, with a close button; with no tool, the image's
 * own -- its size, its format and how many layers it has.
 */
describe('PropertiesPanelComponent -- the active tool\'s properties, or the image\'s own', () => {
    let fixture: ComponentFixture<PropertiesPanelComponent>;
    let active: ReturnType<typeof signal<string | null>>;

    function build(filename: string): HTMLElement {
        active = signal<string | null>(null);
        TestBed.configureTestingModule({
            imports: [PropertiesPanelComponent],
            providers: [{
                provide: ImageEditorStateService,
                useValue: {
                    activeTool: active,
                    setActiveTool: (id: string | null) => active.set(id),
                    canvasSize: signal({ width: 1200, height: 800 }),
                    layers: signal([{ id: 'base' }, { id: 'shape-1' }]),
                },
            }],
        });
        TestBed.inject(ToolRegistryService).register({
            id: 'crop', labelKey: 'imageEditor.tool.crop', icon: 'bi-crop', group: 'transform', order: 10,
            component: CropPropertiesComponent,
        });
        fixture = TestBed.createComponent(PropertiesPanelComponent);
        fixture.componentRef.setInput('filename', filename);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('with no tool: the image\'s size, format and layers', () => {
        const el = build('holiday.photo.jpeg');
        const facts = el.querySelector('[data-test="image-properties"]') as HTMLElement;

        expect(el.querySelector('[data-test="panel-title"]')?.textContent?.trim()).toBe('Image');
        expect(Array.from(facts.querySelectorAll('dt')).map(d => d.textContent?.trim())).toEqual(['Size', 'Format', 'Layers']);
        expect(Array.from(facts.querySelectorAll('dd')).map(d => d.textContent?.trim())).toEqual(['1200 x 800 px', 'JPEG', '2']);
    });

    it('a name without an extension shows no format', () => {
        const el = build('scan');

        expect(Array.from(el.querySelectorAll('[data-test="image-properties"] dt')).map(d => d.textContent?.trim()))
            .toEqual(['Size', 'Layers']);
    });

    it('with a tool: its properties under its name, and Close returns to the image\'s', () => {
        const el = build('a.png');

        active.set('crop');
        fixture.detectChanges();
        expect(el.querySelector('[data-test="panel-title"]')?.textContent?.trim()).toBe('Crop');
        expect(el.querySelector('.crop-properties')).not.toBeNull();
        expect(el.querySelector('[data-test="image-properties"]')).toBeNull();

        (el.querySelector('.properties-panel__close') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(active()).toBeNull();
        expect(el.querySelector('[data-test="image-properties"]')).not.toBeNull();
    });
});
