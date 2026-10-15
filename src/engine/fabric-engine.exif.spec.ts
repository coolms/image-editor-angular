import { FabricEngineAdapter } from './fabric-engine.adapter';

/**
 * A photo's EXIF orientation is baked into the pixels the editor saves, and its export carries no EXIF of its own
 * (on a JPEG overwrite the server puts the replaced photo's back). Measured on a JPEG
 * stored 40x20 (left half red) whose EXIF says "rotate 90 degrees clockwise to show" and names a camera make.
 */

/** A 40x20 JPEG, its left half red, the right half white. */
async function aWideJpeg(): Promise<Uint8Array<ArrayBuffer>> {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 40, 20);
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no blob'))), 'image/jpeg', 0.95));
    return new Uint8Array(await blob.arrayBuffer());
}

/** The JPEG with an EXIF segment saying Orientation = `orientation` and Make = "TestCam", right after its SOI. */
function withExif(jpeg: Uint8Array<ArrayBuffer>, orientation: number): Uint8Array<ArrayBuffer> {
    const tiff = new Uint8Array(46);
    const view = new DataView(tiff.buffer);
    tiff.set([0x49, 0x49, 0x2a, 0x00]);           // little-endian TIFF
    view.setUint32(4, 8, true);                     // IFD0 at 8
    view.setUint16(8, 2, true);                     // two entries, by tag order:
    view.setUint16(10, 0x010f, true);               //   Make, ASCII, 8 bytes, at 38
    view.setUint16(12, 2, true);
    view.setUint32(14, 8, true);
    view.setUint32(18, 38, true);
    view.setUint16(22, 0x0112, true);               //   Orientation, SHORT, 1
    view.setUint16(24, 3, true);
    view.setUint32(26, 1, true);
    view.setUint16(30, orientation, true);
    view.setUint32(34, 0, true);                    // no next IFD
    tiff.set(new TextEncoder().encode('TestCam\0'), 38);
    const header = new TextEncoder().encode('Exif\0\0');
    const length = 2 + header.length + tiff.length;
    const app1 = new Uint8Array(4 + header.length + tiff.length);
    app1.set([0xff, 0xe1, length >> 8, length & 0xff]);
    app1.set(header, 4);
    app1.set(tiff, 4 + header.length);
    const out = new Uint8Array(jpeg.length + app1.length);
    out.set(jpeg.subarray(0, 2));                   // SOI
    out.set(app1, 2);
    out.set(jpeg.subarray(2), 2 + app1.length);
    return out;
}

/** Whether `bytes` hold `text` as UTF-16 big-endian (an ICC v4 profile's description). */
function contains16(bytes: Uint8Array, text: string): boolean {
    return contains(bytes, Array.from(text).map(c => '\0' + c).join(''));
}

function contains(bytes: Uint8Array, text: string): boolean {
    const needle = new TextEncoder().encode(text);
    outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (bytes[i + j] !== needle[j]) continue outer;
        }
        return true;
    }
    return false;
}

/**
 * The width and height a JPEG STORES, read from its frame header (SOF0/SOF2): what any decoder starts from, before an
 * orientation is applied. (This Chrome applies the EXIF orientation even to `createImageBitmap(..., { imageOrientation:
 * 'none' })`, so a decoded size cannot tell stored from shown.)
 */
function storedSize(jpeg: Uint8Array): [number, number] | null {
    let at = 2;
    while (at + 9 < jpeg.length && jpeg[at] === 0xff) {
        const marker = jpeg[at + 1];
        const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
        if (marker === 0xc0 || marker === 0xc2) {
            return [(jpeg[at + 7] << 8) | jpeg[at + 8], (jpeg[at + 5] << 8) | jpeg[at + 6]];
        }
        at += 2 + length;
    }
    return null;
}

/** Whether the pixel at (x, y) of `bitmap` is red. */
function redAt(bitmap: ImageBitmap, x: number, y: number): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(x, y, 1, 1).data;
    return r > 200 && g < 80 && b < 80;
}

describe('FabricEngineAdapter -- EXIF orientation is baked into the saved pixels; no other EXIF is kept', () => {
    let container: HTMLElement;
    let engine: FabricEngineAdapter | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '200px';
        container.style.height = '150px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        engine?.destroy();
        engine = null;
        container.remove();
    });

    it('fixture: the photo is stored 40x20 and carries its EXIF', async () => {
        const photo = withExif(await aWideJpeg(), 6);

        expect(storedSize(photo)).toEqual([40, 20]);
        expect(contains(photo, 'Exif\0\0')).toBeTrue();
        expect(contains(photo, 'TestCam')).toBeTrue();
    });

    it('opens as shown: turned upright, 20x40', async () => {
        engine = await FabricEngineAdapter.create({ container });

        const size = await engine.loadImage(new Blob([withExif(await aWideJpeg(), 6)], { type: 'image/jpeg' }), 'photo.jpg');

        expect([size.width, size.height]).toEqual([20, 40]);
    });

    it('saves the upright pixels: 20x40 with no orientation to apply, the red half on top', async () => {
        engine = await FabricEngineAdapter.create({ container });
        await engine.loadImage(new Blob([withExif(await aWideJpeg(), 6)], { type: 'image/jpeg' }), 'photo.jpg');

        // Stored upright: the saved file's own frame is 20x40, and it carries no orientation to apply.
        const bytes = new Uint8Array(await (await engine.export('jpeg')).arrayBuffer());
        expect(storedSize(bytes)).toEqual([20, 40]);
        expect(contains(bytes, 'Exif\0\0')).withContext('no orientation tag to turn it again').toBeFalse();
        const saved = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));

        // Turned 90 degrees clockwise, the stored left half is the shown top half.
        expect(redAt(saved, 10, 8)).withContext('top half').toBeTrue();
        expect(redAt(saved, 10, 32)).withContext('bottom half').toBeFalse();
    });

    // The export itself carries no EXIF: on a JPEG overwrite the server puts the replaced photo's back (orientation
    // normal, thumbnail gone, the make, the dates and the location kept) -- measured there, on the bytes it stores.
    for (const format of ['jpeg', 'png'] as const) {
        it(`the editor's export carries no EXIF of its own: no EXIF segment, no camera make (${format})`, async () => {
            engine = await FabricEngineAdapter.create({ container });
            await engine.loadImage(new Blob([withExif(await aWideJpeg(), 6)], { type: 'image/jpeg' }), 'photo.jpg');

            const saved = new Uint8Array(await (await engine.export(format)).arrayBuffer());

            expect(contains(saved, 'Exif\0\0')).withContext('an EXIF segment').toBeFalse();
            expect(contains(saved, 'TestCam')).withContext('the camera make').toBeFalse();
        });
    }

    // MEASURED, reported before any fix: whether a colour profile survives the export. A JPEG
    // names its profile in an "ICC_PROFILE" APP2 segment, a PNG in an iCCP chunk; and the canvas the editor draws on
    // has a colour space, which decides what a Display P3 photo's colours become on the way through.
    it('MEASURED: a JPEG export embeds a colour profile, and it is sRGB', async () => {
        engine = await FabricEngineAdapter.create({ container });
        await engine.loadImage(new Blob([await aWideJpeg()], { type: 'image/jpeg' }), 'photo.jpg');

        const saved = new Uint8Array(await (await engine.export('jpeg')).arrayBuffer());

        expect(contains(saved, 'ICC_PROFILE')).withContext('an ICC profile segment').toBeTrue();
        // The profile names itself in its description tag: ASCII (ICC v2) or UTF-16 (v4).
        expect(contains(saved, 'sRGB') || contains16(saved, 'sRGB')).withContext('the profile is sRGB').toBeTrue();
    });

    it('MEASURED: a PNG export embeds no colour profile', async () => {
        engine = await FabricEngineAdapter.create({ container });
        await engine.loadImage(new Blob([await aWideJpeg()], { type: 'image/jpeg' }), 'photo.jpg');

        const saved = new Uint8Array(await (await engine.export('png')).arrayBuffer());

        expect(contains(saved, 'iCCP')).withContext('an iCCP chunk').toBeFalse();
    });

    it('MEASURED: the canvas the editor draws on is sRGB', async () => {
        engine = await FabricEngineAdapter.create({ container });
        await engine.loadImage(new Blob([await aWideJpeg()], { type: 'image/jpeg' }), 'photo.jpg');

        const spaces = Array.from(container.querySelectorAll('canvas'))
            .map(c => c.getContext('2d')?.getContextAttributes().colorSpace ?? 'none');

        expect(spaces.length).withContext('the editor drew on a canvas').toBeGreaterThan(0);
        expect(new Set(spaces)).toEqual(new Set(['srgb']));
    });

    // A Display P3 photo, as a phone takes one: its own profile, and a red beyond what sRGB can show. P3's own red,
    // read on a P3 canvas, is (255, 0, 0); sRGB's red read there is about (234, 51, 35).
    it('fixture: the P3 photo carries a Display P3 profile and a red beyond sRGB', async () => {
        const photo = await aP3Jpeg();

        expect(contains(photo, 'ICC_PROFILE')).withContext('an ICC profile segment').toBeTrue();
        expect(contains(photo, 'Display P3') || contains16(photo, 'Display P3')).withContext('the profile is Display P3').toBeTrue();
        const [r, g, b] = await p3PixelAt(photo, 10, 10);
        expect(r).withContext('red').toBeGreaterThan(245);
        expect(g).withContext('green').toBeLessThan(20);
        expect(b).withContext('blue').toBeLessThan(20);
    });

    it('MEASURED: a Display P3 photo saved as JPEG loses its profile, and its colours beyond sRGB are clipped', async () => {
        engine = await FabricEngineAdapter.create({ container });
        await engine.loadImage(new Blob([await aP3Jpeg()], { type: 'image/jpeg' }), 'photo.jpg');

        const saved = new Uint8Array(await (await engine.export('jpeg')).arrayBuffer());

        expect(contains(saved, 'Display P3') || contains16(saved, 'Display P3')).withContext('the P3 profile').toBeFalse();
        expect(contains(saved, 'sRGB') || contains16(saved, 'sRGB')).withContext('an sRGB profile instead').toBeTrue();
        // The red is sRGB's own now: read on a P3 canvas it is no longer P3's red, but sRGB's.
        const [r, g, b] = await p3PixelAt(saved, 10, 10);
        expect(r).withContext('red').toBeLessThan(245);
        expect(g).withContext('green').toBeGreaterThan(30);
        expect(b).withContext('blue').toBeGreaterThan(15);
    });
});

/** A 40x20 JPEG drawn on a Display P3 canvas: its left half P3's own red, beyond sRGB; the right half white. */
async function aP3Jpeg(): Promise<Uint8Array<ArrayBuffer>> {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext('2d', { colorSpace: 'display-p3' });
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 40, 20);
    context.fillStyle = 'color(display-p3 1 0 0)';
    context.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no blob'))), 'image/jpeg', 0.95));
    return new Uint8Array(await blob.arrayBuffer());
}

/** The pixel at (x, y) of a JPEG, decoded with its profile and read on a Display P3 canvas: 0-255 per channel. */
async function p3PixelAt(jpeg: Uint8Array<ArrayBuffer>, x: number, y: number): Promise<[number, number, number]> {
    const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { colorSpace: 'display-p3' });
    if (context === null) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(x, y, 1, 1, { colorSpace: 'display-p3' }).data;
    return [r, g, b];
}
