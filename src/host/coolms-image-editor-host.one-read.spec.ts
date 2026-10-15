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
import { CoolmsImageEditorHostComponent, versionOf } from './coolms-image-editor-host.component';
import { CoolmsImageEditorHostData } from './coolms-image-editor-host.types';
import { ImageEditorHttpService } from '../services/image-editor-http.service';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';

/**
 * The pixels and the version come from one read (Dmitry, 2026-10-15). The editor opens a file from its own read of
 * the bytes and names THAT read's version (its ETag) when it saves over the file. The listing's version is a separate,
 * earlier read: a file changed between the listing and the open would otherwise be edited as it is now and saved with
 * the old version -- or, from a cached preview, edited as it was and saved over the newer file.
 */
describe('CoolmsImageEditorHost -- the version it saves with is the version of the pixels it opened', () => {
    const SOURCE = '/api/v1/vfs/files/preview?path=%2Fhome%2Fp%2Fpicture.png';
    let http: HttpTestingController | undefined;
    let writes: jasmine.Spy;
    let replaces: jasmine.Spy;

    /**
     * A host for a file whose LISTING said version h1. The listing's version reaches the host only on an untyped
     * object, the way a caller holding it could still pass it: the host must not read it.
     */
    function aHostListedAt(listingVersion: string): CoolmsImageEditorHostComponent {
        const listed = {
            path: '/home/p/picture.png',
            id: 'n1',
            version: listingVersion,
            canWrite: true,
            sourceUrl: SOURCE,
            filename: 'picture.png',
            mimeType: 'image/png',
            parentPath: '/home/p',
            dimensions: null,
        };
        return aHost({ context: 'vfs', node: listed } as CoolmsImageEditorHostData);
    }

    /** A host for a media asset whose bytes and version are read from $sourceUrl (or from its public URL alone). */
    function aHostForAnAsset(sourceUrl: string | undefined): CoolmsImageEditorHostComponent {
        return aHost({
            context: 'media',
            asset: {
                uuid: 'a1',
                originalUrl: '/media/library/photo.png',
                sourceUrl,
                filename: 'photo.png',
                mimeType: 'image/png',
                path: '/media/library/photo.png',
                dimensions: null,
            },
        });
    }

    function aHost(data: CoolmsImageEditorHostData): CoolmsImageEditorHostComponent {
        writes = jasmine.createSpy('writeVfsFile').and.resolveTo({});
        replaces = jasmine.createSpy('replaceMediaAsset').and.resolveTo({ id: 'a1' });
        TestBed.configureTestingModule({
            imports: [CoolmsImageEditorHostComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: Dialog, useValue: { open: () => ({ closed: of(true) }) } },
                { provide: ImageEditorHttpService, useValue: { writeVfsFile: writes, replaceMediaAsset: replaces } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined, info: () => undefined } },
                { provide: EscCoordinatorService, useValue: { register: () => () => undefined } },
                { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
                { provide: UnsavedChangesService, useValue: { watch: () => () => undefined } },
            ],
        });
        TestBed.overrideComponent(CoolmsImageEditorHostComponent, {
            set: { template: '', styleUrls: [], imports: [] },
        });
        http = TestBed.inject(HttpTestingController);

        return TestBed.createComponent(CoolmsImageEditorHostComponent).componentInstance;
    }

    /** Opens the editor: its read of the bytes is answered with $etag; then an engine is ready. */
    async function open(host: CoolmsImageEditorHostComponent, etag: string | null): Promise<void> {
        const opening = host.ngOnInit();
        const headers: Record<string, string> = etag === null ? {} : { ETag: etag };
        TestBed.inject(HttpTestingController).expectOne(SOURCE).flush(new Blob(['the bytes as they are now']), { headers });
        await opening;
        const engine = {
            export: async () => new Blob(['edited']),
            hasAlpha: () => false,
        } as unknown as ImageEditorEngine;
        host.onEngineReady(engine);
    }

    // Only a case that stood a host up has requests to verify (Jasmine runs the cases in any order).
    beforeEach(() => (http = undefined));
    afterEach(() => http?.verify());

    it('a file changed after it was listed: the overwrite names the version of the bytes it opened', async () => {
        const host = aHostListedAt('h1');
        await open(host, '"h2"');

        await host.onSave();

        expect(writes).toHaveBeenCalledTimes(1);
        expect(writes.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ overwrite: true, ifMatch: 'h2' }));
    });

    it('bytes served from a cache name their own older version, so the overwrite is refused, not written blind', async () => {
        // The listing is newer (h3) than the cached bytes (h2): the save names h2, and the server answers 412.
        const host = aHostListedAt('h3');
        await open(host, 'W/"h2"');

        await host.onSave();

        expect(writes.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ ifMatch: 'h2' }));
    });

    it('a read that names no version leaves Save off: nothing is written over the file', async () => {
        const host = aHostListedAt('h1');
        await open(host, null);

        expect(host.canSave()).toBeFalse();
        await host.onSave();

        expect(writes).not.toHaveBeenCalled();
        expect(host.canSaveAs()).withContext('the edits can still go to a new image').toBeTrue();
    });

    it('the read revalidates the browser\'s copy: a newer file on the server opens with its newer pixels', async () => {
        // The browser held an older copy (h1); its read asks the server again, which answers the newer bytes (h2).
        const host = aHostListedAt('h1');
        const opening = host.ngOnInit();
        const read = TestBed.inject(HttpTestingController).expectOne(SOURCE);
        expect(read.request.headers.get('Cache-Control')).withContext('revalidated on the XHR backend').toBe('max-age=0');
        expect(read.request.cache).withContext('revalidated on the fetch backend').toBe('no-cache');
        read.flush(new Blob(['the newer bytes']), { headers: { ETag: '"h2"' } });
        await opening;
        host.onEngineReady({ export: async () => new Blob(['edited']), hasAlpha: () => false } as unknown as ImageEditorEngine);

        expect(await (await fetch(host.resolvedSourceUrl() ?? '')).text()).withContext('the pixels opened').toBe('the newer bytes');
        await host.onSave();
        expect(writes.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ ifMatch: 'h2' }));
    });

    it('a media asset: the replace names the version of the pixels its read answered', async () => {
        const host = aHostForAnAsset(SOURCE);
        await open(host, '"m2"');

        await host.onSave();

        expect(replaces).toHaveBeenCalledTimes(1);
        expect(replaces.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ assetUuid: 'a1', ifMatch: 'm2' }));
    });

    it('a media asset shown from its public URL alone names no version, so it is never replaced', async () => {
        const host = aHostForAnAsset(undefined);
        await host.ngOnInit();
        host.onEngineReady({ export: async () => new Blob(['edited']), hasAlpha: () => false } as unknown as ImageEditorEngine);

        expect(host.canSave()).toBeFalse();
        await host.onSave();

        expect(replaces).not.toHaveBeenCalled();
        expect(host.canSaveAs()).withContext('the edits can still go to a new image').toBeTrue();
    });

    it('reads an ETag as its version', () => {
        expect(versionOf('"abc"')).toBe('abc');
        expect(versionOf('W/"abc"')).toBe('abc');
        expect(versionOf('')).toBeNull();
        expect(versionOf(null)).toBeNull();
    });
});
