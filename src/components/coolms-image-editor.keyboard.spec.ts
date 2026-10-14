import { Component, ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { CoolmsImageEditorComponent } from './coolms-image-editor.component';
import { ImageEditorStateService } from '../services/image-editor-state.service';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';
import type { LayerInfo } from '../types/layer.types';

/**
 * Delete in the image editor acts on the editor's own selection -- the selected shape or text layer -- and does
 * nothing when nothing, or the base image, is selected (2026-10-14: Del in the editor deleted the file under it).
 * The key reaches the editor through the keyboard scope, so it is the editor's only while the editor is the topmost
 * surface. Built directly over a stub engine and state: only what the key reads is stubbed.
 */

@Component({ standalone: true, template: '<button type="button">over the editor</button>' })
class OverTheEditorComponent {}

const BASE: LayerInfo = { id: 'base', kind: 'image', name: 'Background', visible: true, opacity: 1, locked: true };
const SHAPE: LayerInfo = { id: 'shape-1', kind: 'shape', name: 'Rectangle', visible: true, opacity: 1, locked: false };
const TEXT: LayerInfo = { id: 'text-1', kind: 'text', name: 'Text', visible: true, opacity: 1, locked: false };

describe('CoolmsImageEditorComponent -- Delete acts on the editor\'s own selection', () => {
    let host: HTMLElement;

    afterEach(() => host?.remove());

    function build(active: string | null): { removeLayer: jasmine.Spy } {
        const removeLayer = jasmine.createSpy('removeLayer');
        const engine = { getActiveLayerId: () => active, removeLayer } as unknown as ImageEditorEngine;
        host = document.createElement('div');
        host.tabIndex = 0;
        document.body.appendChild(host);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: ElementRef, useValue: new ElementRef(host) },
                { provide: ImageEditorStateService, useValue: { engine: signal(engine), layers: signal([BASE, SHAPE, TEXT]) } },
            ],
        });
        TestBed.runInInjectionContext(() => new CoolmsImageEditorComponent());
        return { removeLayer };
    }

    function press(key: string, from: Element = host): void {
        from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }

    it('removes the selected shape', () => {
        const { removeLayer } = build(SHAPE.id);
        press('Delete');
        expect(removeLayer).toHaveBeenCalledOnceWith(SHAPE.id);
    });

    it('removes the selected text layer', () => {
        const { removeLayer } = build(TEXT.id);
        press('Delete');
        expect(removeLayer).toHaveBeenCalledOnceWith(TEXT.id);
    });

    it('does nothing with nothing selected', () => {
        const { removeLayer } = build(null);
        press('Delete');
        expect(removeLayer).not.toHaveBeenCalled();
    });

    it('does nothing with the base image selected', () => {
        const { removeLayer } = build(BASE.id);
        press('Delete');
        expect(removeLayer).not.toHaveBeenCalled();
    });

    it('takes no other key, Backspace included', () => {
        const { removeLayer } = build(SHAPE.id);
        press('Backspace');
        press('x');
        expect(removeLayer).not.toHaveBeenCalled();
    });

    it('does nothing while text is typed in a field (the canvas edits text through a hidden textarea)', () => {
        const { removeLayer } = build(SHAPE.id);
        const textarea = document.createElement('textarea');
        host.appendChild(textarea);
        press('Delete', textarea);
        expect(removeLayer).not.toHaveBeenCalled();
    });

    it('does nothing while a dialog is open over the editor, and acts again once it has closed', () => {
        const { removeLayer } = build(SHAPE.id);
        const over = TestBed.inject(Dialog).open(OverTheEditorComponent, { disableClose: true });
        press('Delete', over.overlayRef.hostElement.querySelector('button')!);
        press('Delete');
        expect(removeLayer).withContext('a dialog is over the editor').not.toHaveBeenCalled();
        over.close();
        press('Delete');
        expect(removeLayer).toHaveBeenCalledOnceWith(SHAPE.id);
    });
});
