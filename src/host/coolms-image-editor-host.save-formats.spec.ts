import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import {
    ConfirmDialogService,
    EscCoordinatorService,
    ToastService,
    UnsavedChangesService,
} from '@coolms/ui-angular';
import { CoolmsImageEditorHostComponent, writtenBackAs } from './coolms-image-editor-host.component';
import { CoolmsImageEditorHostData } from './coolms-image-editor-host.types';
import { SaveAsDialogComponent } from './save-as-dialog.component';
import { ImageEditorHttpService } from '../services/image-editor-http.service';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';

/**
 * Save overwrites only a PNG or a JPEG, which the editor writes back in the same format. Every
 * other format has Save as only: overwriting it would put PNG or JPEG bytes under its name -- an SVG's vectors become
 * pixels, a GIF loses its animation, and the file's name and type no longer say what it holds.
 */
describe('CoolmsImageEditorHost -- Save writes back only the formats it writes as themselves', () => {
    const SOURCE = '/api/v1/vfs/files/preview?path=%2Fhome%2Fp%2Fpicture';
    let writes: jasmine.Spy;
    let opened: jasmine.Spy;
    let info: jasmine.Spy;

    function aHost(mimeType: string, filename: string): CoolmsImageEditorHostComponent {
        writes = jasmine.createSpy('writeVfsFile').and.resolveTo({});
        // The overwrite confirmation answers yes; Save as is cancelled (nothing to name).
        opened = jasmine.createSpy('open').and.callFake((component: unknown) =>
            ({ closed: of(component === SaveAsDialogComponent ? undefined : true) }));
        info = jasmine.createSpy('info');
        const data = {
            context: 'vfs',
            node: {
                path: '/home/p/' + filename, id: 'n1', canWrite: true, sourceUrl: SOURCE, filename, mimeType,
                parentPath: '/home/p', dimensions: null,
            },
        } as unknown as CoolmsImageEditorHostData;
        TestBed.configureTestingModule({
            imports: [CoolmsImageEditorHostComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: Dialog, useValue: { open: opened } },
                { provide: ImageEditorHttpService, useValue: { writeVfsFile: writes, replaceMediaAsset: writes } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined, info } },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: EscCoordinatorService, useValue: { register: () => () => undefined } },
                { provide: UnsavedChangesService, useValue: { watch: () => () => undefined } },
            ],
        });
        TestBed.overrideComponent(CoolmsImageEditorHostComponent, { set: { template: '', styleUrls: [], imports: [] } });
        return TestBed.createComponent(CoolmsImageEditorHostComponent).componentInstance;
    }

    /** Opens the editor on bytes read at version "v1"; its edit has transparency or not. */
    async function open(host: CoolmsImageEditorHostComponent, transparent = false): Promise<void> {
        const opening = host.ngOnInit();
        TestBed.inject(HttpTestingController).expectOne(SOURCE).flush(new Blob(['bytes']), { headers: { ETag: '"v1"' } });
        await opening;
        host.onEngineReady({ export: async () => new Blob(['edited']), hasAlpha: () => transparent } as unknown as ImageEditorEngine);
    }

    for (const [mime, name] of [['image/png', 'picture.png'], ['image/jpeg', 'picture.jpg']] as const) {
        it(`a ${mime} is overwritten by Save, in its own format`, async () => {
            const host = aHost(mime, name);
            await open(host);

            expect(host.canSave()).toBeTrue();
            await host.onSave();

            expect(writes).toHaveBeenCalledTimes(1);
            expect(writes.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ overwrite: true, ifMatch: 'v1' }));
        });
    }

    const saveAsOnly: ReadonlyArray<readonly [string, string]> = [
        ['image/gif', 'loop.gif'],
        ['image/svg+xml', 'logo.svg'],
        ['image/webp', 'photo.webp'],
        ['image/tiff', 'scan.tiff'],
        ['image/heic', 'phone.heic'],
        ['image/bmp', 'old.bmp'],
    ];
    for (const [mime, name] of saveAsOnly) {
        it(`a ${mime} has Save as only: Save is off, says why, and writes nothing over it`, async () => {
            const host = aHost(mime, name);
            await open(host);

            expect(host.canSave()).toBeFalse();
            expect(host.saveFormatNote()).toContain('Save as');
            await host.onSave();

            expect(writes).not.toHaveBeenCalled();
            expect(host.canSaveAs()).withContext('the edits can go to a new image').toBeTrue();
        });
    }

    it('a JPEG whose edit gained transparency is not overwritten: Save says so and opens Save as', async () => {
        const host = aHost('image/jpeg', 'picture.jpg');
        await open(host, true);

        await host.onSave();

        expect(writes).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledTimes(1);
        expect(opened).toHaveBeenCalledWith(SaveAsDialogComponent, jasmine.anything());
    });

    it('names the format Save writes back as, by MIME type', () => {
        expect(writtenBackAs('image/png')).toBe('png');
        expect(writtenBackAs('image/jpeg')).toBe('jpeg');
        expect(writtenBackAs('image/jpg')).toBe('jpeg');
        expect(writtenBackAs('IMAGE/PNG')).toBe('png');
        expect(writtenBackAs('image/webp')).toBeNull();
        expect(writtenBackAs('image/gif')).toBeNull();
    });
});
