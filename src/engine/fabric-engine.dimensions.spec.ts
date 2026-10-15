import { FabricEngineAdapter } from './fabric-engine.adapter';

/** A plain image of the given size, as a PNG blob. */
async function anImage(width: number, height: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#c33';
    context.fillRect(0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no blob'))), 'image/png'));
}

/**
 * A saved image keeps the original's dimensions (Dmitry, 2026-10-15): the editor shows a large image fitted into a
 * small canvas, zoomed out, and what it saves is the image at its own size, never the size it was shown at -- an
 * overwrite at the shown size would replace the original with a smaller copy, silently.
 */
describe('FabricEngineAdapter -- a saved image keeps the original\'s dimensions', () => {
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

    for (const format of ['png', 'jpeg'] as const) {
        it(`exports a 640x480 image shown at a quarter of its size as 640x480 (${format})`, async () => {
            engine = await FabricEngineAdapter.create({ container });
            await engine.loadImage(await anImage(640, 480), 'large.png');
            engine.setZoom(0.25);

            const saved = await createImageBitmap(await engine.export(format));

            expect([saved.width, saved.height]).toEqual([640, 480]);
        });
    }
});
