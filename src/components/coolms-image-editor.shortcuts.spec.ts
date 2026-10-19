import { Component, ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { CoolmsImageEditorComponent } from './coolms-image-editor.component';
import { ImageEditorStateService } from '../services/image-editor-state.service';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';

@Component({ standalone: true, template: '<button type="button">over the editor</button>' })
class OverTheEditorComponent {}

/**
 * A tool's shortcut selects it, and closes it when it is the active one. The keys reach the editor through the keyboard
 * scope, so they are the editor's only while it is the topmost surface and never from a field. Built directly over a
 * stub engine and state, as the Delete spec is.
 */
describe('CoolmsImageEditorComponent -- a tool\'s shortcut selects it, on the editor\'s layer only', () => {
    let host: HTMLElement;
    let active: ReturnType<typeof signal<string | null>>;

    afterEach(() => host?.remove());

    function build(ready = true): void {
        active = signal<string | null>(null);
        const engine = { getActiveLayerId: () => null, removeLayer: () => undefined } as unknown as ImageEditorEngine;
        host = document.createElement('div');
        host.tabIndex = 0;
        document.body.appendChild(host);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: ElementRef, useValue: new ElementRef(host) },
                {
                    provide: ImageEditorStateService,
                    useValue: {
                        engine: signal(engine), layers: signal([]), isReady: signal(ready),
                        activeTool: active, setActiveTool: (id: string | null) => active.set(id),
                    },
                },
            ],
        });
        TestBed.runInInjectionContext(() => new CoolmsImageEditorComponent());
    }

    function press(key: string, from: Element = host, mods: KeyboardEventInit = {}): void {
        from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
    }

    it('a shortcut selects its tool, and the same key again closes it', () => {
        build();
        press('c');
        expect(active()).toBe('crop');
        press('t');
        expect(active()).withContext('another tool\'s key switches to it').toBe('text');
        press('t');
        expect(active()).toBeNull();
    });

    it('Shift does not matter; Ctrl, Alt or Meta make it not a tool\'s key', () => {
        build();
        press('C', host, { shiftKey: true });
        expect(active()).toBe('crop');
        active.set(null);
        press('c', host, { ctrlKey: true });
        press('c', host, { altKey: true });
        press('c', host, { metaKey: true });
        expect(active()).toBeNull();
    });

    it('not from a field: a letter typed there stays the field\'s', () => {
        build();
        const input = document.createElement('input');
        host.appendChild(input);
        press('t', input);
        expect(active()).toBeNull();
    });

    it('not while a dialog is open over the editor; again once it has closed', () => {
        build();
        const over = TestBed.inject(Dialog).open(OverTheEditorComponent, { disableClose: true });
        press('c', over.overlayRef.hostElement.querySelector('button')!);
        press('c');
        expect(active()).withContext('a dialog is over the editor').toBeNull();
        over.close();
        press('c');
        expect(active()).toBe('crop');
    });

    it('not before the image has loaded', () => {
        build(false);
        press('c');
        expect(active()).toBeNull();
    });
});
