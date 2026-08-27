import {
    ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal,
} from '@angular/core';

import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { ImageEditorTool } from '../tool.types';

interface AspectPreset {
    readonly id:    string;
    readonly label: string;
    /** width / height. `null` means free-form (user drags any rectangle). */
    readonly ratio: number | null;
}

/**
 * Properties panel for the Crop tool. Toast UI's interactive cropper
 * does the actual cropzone rendering and drag handling on the canvas;
 * this panel only:
 *
 *   - Enters / exits crop mode through the engine adapter (lifecycle
 *     hooks). NgComponentOutlet's create / destroy maps to those.
 *   - Lets the user pick an aspect-ratio preset. Picking one calls
 *     `setCropAspectRatio(ratio)` on the engine, which programmatically
 *     replaces the current cropzone with a centred one at the chosen
 *     ratio and locks subsequent user resizes to that ratio.
 *   - Reads the user's final cropzone via `getCropRect()` on Apply
 *     and feeds it into `engine.crop(rect)`.
 *
 * Live dimension display is intentionally absent: Toast UI does not
 * fire `objectModified` for the cropzone (the source skips it
 * explicitly), so there's no public event to drive a reactive label.
 * The user sees the cropzone size visually on the canvas while
 * dragging, which is the expected feedback channel.
 */
@Component({
    selector: 'coolms-image-editor-crop-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './crop-tool.component.html',
    styleUrls: ['./crop-tool.component.scss'],
})
export class CropToolComponent implements OnInit, OnDestroy, ImageEditorTool {
    private readonly state = inject(ImageEditorStateService);

    /** Aspect-ratio presets surfaced as buttons in the panel. */
    protected readonly presets: readonly AspectPreset[] = [
        { id: 'free',  label: 'Free',  ratio: null    },
        { id: '1-1',   label: '1 : 1', ratio: 1       },
        { id: '4-3',   label: '4 : 3', ratio: 4 / 3   },
        { id: '16-9',  label: '16 : 9', ratio: 16 / 9 },
        { id: '3-2',   label: '3 : 2', ratio: 3 / 2   },
    ];

    readonly activePresetId = signal<string>('free');

    /** Live message shown above the action row for context cues. */
    readonly statusMessage  = signal<string>('Drag inside the canvas to draw a crop area, or pick an aspect ratio.');

    ngOnInit():    void { void this.onActivate(); }
    ngOnDestroy(): void { void this.onDeactivate(); }

    async onActivate(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;
        await engine.enterCropMode();
    }

    async onDeactivate(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;
        await engine.exitCropMode();
    }

    selectPreset(preset: AspectPreset): void {
        const engine = this.state.engine();
        if (engine === null) return;
        engine.setCropAspectRatio(preset.ratio);
        this.activePresetId.set(preset.id);
        this.statusMessage.set(
            preset.ratio === null
                ? 'Cropzone reset. Drag the canvas to draw freely.'
                : `Locked to ${preset.label}. Drag the cropzone to reposition.`,
        );
    }

    async applyCrop(): Promise<void> {
        const engine = this.state.engine();
        if (engine === null) return;

        const rect = engine.getCropRect();
        if (rect === null || rect.width <= 0 || rect.height <= 0) {
            // The user opened crop and clicked Apply without ever
            // drawing a cropzone. Nudge them rather than no-op silently.
            this.statusMessage.set('Draw a cropzone on the canvas first.');
            return;
        }

        await engine.crop(rect);
        // Deactivating clears `activeTool` which destroys this
        // component; `ngOnDestroy` then calls `exitCropMode()`.
        this.state.setActiveTool(null);
    }

    cancelCrop(): void {
        this.state.setActiveTool(null);
    }
}
