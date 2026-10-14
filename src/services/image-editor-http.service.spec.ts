import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ImageEditorHttpService } from './image-editor-http.service';

/**
 * The image editor's Save writes the file with the version it opened (2026-10-14: "Save sends the version it opened
 * (If-Match)"): a file saved meanwhile then answers 412 and one deleted 404, and the host offers "Save as" instead.
 * "Save as" itself names no version -- it never replaces a file (overwrite off).
 */
describe('ImageEditorHttpService -- the Save names its version', () => {
    let http: HttpTestingController;
    let svc: ImageEditorHttpService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), ImageEditorHttpService] });
        http = TestBed.inject(HttpTestingController);
        svc = TestBed.inject(ImageEditorHttpService);
    });

    afterEach(() => http.verify());

    it('sends the opened version as If-Match on an overwrite', async () => {
        const done = svc.writeVfsFile({ blob: new Blob(['x']), path: '/docs/a.png', overwrite: true, filename: 'a.png', ifMatch: 'h1' });
        const req = http.expectOne('/api/v1/vfs/files/binary');
        expect(req.request.headers.get('If-Match')).toBe('"h1"');
        expect((req.request.body as FormData).get('overwrite')).toBe('1');
        req.flush({});
        await done;
    });

    it('sends no If-Match when no version is known, as before', async () => {
        const done = svc.writeVfsFile({ blob: new Blob(['x']), path: '/docs/b.png', overwrite: false, filename: 'b.png' });
        const req = http.expectOne('/api/v1/vfs/files/binary');
        expect(req.request.headers.has('If-Match')).toBeFalse();
        req.flush({});
        await done;
    });
});
