import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { MaskShape, MaskSpec } from '../../types/layer.types';
import { DEFAULT_MASK_SPEC } from '../../types/layer.types';
import { extractSvgMaskPath } from './svg-mask.util';

/**
 * Mask / clip tool (C.1c / C.1d). Cuts the mask target to a shape --
 * geometric primitives (rect / rounded / ellipse / triangle), the
 * SVG-path presets (star / heart / hexagon), or an arbitrary **custom**
 * SVG the user pastes or uploads (C.1d). The target is the selected
 * shape / text layer when one is active, otherwise the base image -- so
 * selecting a layer masks it, selecting nothing masks the photo.
 *
 * The engine owns the fabric `clipPath`; this panel only round-trips a
 * {@link MaskSpec} through `getMask` / `setMask`, and the export flatten
 * bakes the clip in for free (it's part of the object's render path).
 * Custom SVG input is sanitised to pure path geometry by
 * {@link extractSvgMaskPath} before it reaches the engine.
 */
@Component({
    selector: 'coolms-image-editor-mask-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="mask-tool">
            <span class="prop-hint">Masking: {{ targetName() }}</span>

            <div class="shape-grid">
                @for (s of shapes; track s.value) {
                    <button type="button" class="shape-btn"
                            [class.shape-btn--on]="shape() === s.value"
                            [title]="s.label" [disabled]="!state.isReady()"
                            (click)="onShape(s.value)">
                        <i class="bi" [class]="s.icon"></i>
                        <span>{{ s.label }}</span>
                    </button>
                }
            </div>

            @if (shape() === 'custom') {
                <div class="svg-panel">
                    <textarea class="svg-input" rows="4" spellcheck="false"
                              placeholder="Paste an SVG path (M0 0 …) or a small SVG file"
                              [value]="svgInput()"
                              (input)="svgInput.set($any($event.target).value)"></textarea>
                    <div class="svg-actions">
                        <label class="svg-file-btn" title="Upload an SVG file">
                            <i class="bi bi-upload"></i> Upload SVG
                            <input type="file" accept=".svg,image/svg+xml" hidden
                                   (change)="onFile($event)">
                        </label>
                        <button type="button" class="svg-apply-btn"
                                [disabled]="!state.isReady()" (click)="applySvg()">
                            Use as mask
                        </button>
                    </div>
                    @if (svgError(); as err) {
                        <p class="svg-msg svg-msg--err"><i class="bi bi-exclamation-triangle"></i> {{ err }}</p>
                    } @else if (customPath() !== '') {
                        <p class="svg-msg svg-msg--ok"><i class="bi bi-check-circle"></i> Custom SVG mask applied.</p>
                    }
                </div>
            }

            @if (shape() !== 'none') {
                <label class="prop-row prop-row--range">
                    <span>Inset</span>
                    <input type="range" min="0" max="40" step="1" [value]="inset()"
                           (input)="onInset(+$any($event.target).value)">
                    <output>{{ inset() }}%</output>
                </label>
            }
            @if (shape() === 'rounded') {
                <label class="prop-row prop-row--range">
                    <span>Radius</span>
                    <input type="range" min="0" max="50" step="1" [value]="radius()"
                           (input)="onRadius(+$any($event.target).value)">
                    <output>{{ radius() }}%</output>
                </label>
            }

            @if (shape() !== 'none') {
                <button type="button" class="clear-btn" (click)="onShape('none')">
                    <i class="bi bi-x-circle"></i> Remove mask
                </button>
            }
        </div>
    `,
    styles: [`
        .mask-tool { display: flex; flex-direction: column; gap: 14px; }
        .prop-hint {
            font-size: .6875rem; font-weight: 700; letter-spacing: .04em;
            text-transform: uppercase; color: var(--cms-text-muted);
        }
        .shape-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .shape-btn {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            padding: 10px 4px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            color: var(--cms-text-secondary); cursor: pointer;
        }
        .shape-btn > .bi { font-size: 1.125rem; }
        .shape-btn > span { font-size: .625rem; }
        .shape-btn:hover:not(:disabled) {
            background: var(--cms-btn-hover-bg); border-color: var(--cms-btn-hover-border);
            color: var(--cms-text);
        }
        .shape-btn--on { background: var(--cms-accent-light); border-color: var(--cms-accent); color: var(--cms-accent-text); }
        .shape-btn:disabled { opacity: .4; cursor: not-allowed; }
        .prop-row {
            display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 10px;
            font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .prop-row input[type=range] { width: 100%; }
        .prop-row output { font-variant-numeric: tabular-nums; color: var(--cms-text-muted); min-width: 36px; text-align: right; }
        .clear-btn {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            padding: 8px 12px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            color: var(--cms-text-secondary); font-size: .8125rem; cursor: pointer;
        }
        .clear-btn:hover { background: var(--cms-btn-hover-bg); color: var(--cms-text); }
        .svg-panel { display: flex; flex-direction: column; gap: 8px; }
        .svg-input {
            width: 100%; resize: vertical; min-height: 64px;
            padding: 8px 10px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            color: var(--cms-text); font-family: var(--cms-font-mono, monospace);
            font-size: .75rem; line-height: 1.4;
        }
        .svg-input:focus {
            outline: none;
            border-color: var(--cms-focus-ring, #7c4d00);
            box-shadow: 0 0 0 1px var(--cms-focus-ring, #7c4d00);
        }
        .svg-actions { display: flex; gap: 6px; }
        .svg-file-btn, .svg-apply-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            padding: 7px 12px; border-radius: var(--cms-radius);
            font-size: .8125rem; cursor: pointer; border: 1px solid var(--cms-border);
        }
        .svg-file-btn { background: var(--cms-surface); color: var(--cms-text-secondary); }
        .svg-file-btn:hover { background: var(--cms-btn-hover-bg); color: var(--cms-text); }
        .svg-apply-btn {
            flex: 1; background: var(--cms-accent-light);
            border-color: var(--cms-accent); color: var(--cms-accent-text); font-weight: 600;
        }
        .svg-apply-btn:hover:not(:disabled) { filter: brightness(1.05); }
        .svg-apply-btn:disabled { opacity: .4; cursor: not-allowed; }
        .svg-msg {
            display: flex; align-items: flex-start; gap: 6px;
            margin: 0; font-size: .75rem; line-height: 1.4;
        }
        .svg-msg--err { color: var(--cms-danger, #dc2626); }
        .svg-msg--ok  { color: var(--cms-success, #16a34a); }
    `],
})
export class MaskToolComponent {
    protected readonly state = inject(ImageEditorStateService);

    protected readonly shapes: { value: MaskShape; icon: string; label: string }[] = [
        { value: 'none',     icon: 'bi-slash-circle', label: 'None' },
        { value: 'rect',     icon: 'bi-square',       label: 'Rect' },
        { value: 'rounded',  icon: 'bi-app',          label: 'Rounded' },
        { value: 'ellipse',  icon: 'bi-circle',       label: 'Ellipse' },
        { value: 'triangle', icon: 'bi-triangle',     label: 'Triangle' },
        { value: 'star',     icon: 'bi-star',         label: 'Star' },
        { value: 'heart',    icon: 'bi-heart',        label: 'Heart' },
        { value: 'hexagon',  icon: 'bi-hexagon',      label: 'Hexagon' },
        { value: 'custom',   icon: 'bi-filetype-svg', label: 'SVG' },
    ];

    protected readonly shape  = signal<MaskShape>(DEFAULT_MASK_SPEC.shape);
    protected readonly inset  = signal(DEFAULT_MASK_SPEC.inset);
    protected readonly radius = signal(DEFAULT_MASK_SPEC.radius);

    /** Raw textarea / uploaded-file content for the custom SVG mask (C.1d). */
    protected readonly svgInput   = signal('');
    /** The sanitised combined path `d` currently applied (empty = none). */
    protected readonly customPath = signal('');
    /** Last validation error for the SVG input, or `null` when clean. */
    protected readonly svgError   = signal<string | null>(null);

    /** Name of what's being masked -- the selected layer, else "Background". */
    protected readonly targetName = computed<string>(() => {
        const kind = this.state.activeLayerKind();
        if (kind !== null && kind !== 'image') {
            const id = this.state.activeLayerId();
            return this.state.layers().find(l => l.id === id)?.name ?? 'Layer';
        }
        return 'Background';
    });

    constructor() {
        // Seed the controls from the target's current mask whenever the
        // selection changes (depends on the active-layer signals only,
        // so a live mask edit doesn't feed back into the inputs).
        effect(() => {
            this.state.activeLayerKind();
            this.state.activeLayerId();
            const spec = this.state.engine()?.getMask();
            if (spec == null) return;
            this.shape.set(spec.shape);
            this.inset.set(spec.inset);
            this.radius.set(spec.radius);
            // Restore the custom path + textarea so re-selecting a layer
            // shows the SVG that's actually clipping it (C.1d round-trip).
            if (spec.shape === 'custom' && typeof spec.svgPath === 'string') {
                this.customPath.set(spec.svgPath);
                this.svgInput.set(spec.svgPath);
            } else if (spec.shape !== 'custom') {
                this.customPath.set('');
            }
            this.svgError.set(null);
        });
    }

    protected onShape(value: MaskShape): void { this.shape.set(value); this.apply(); }
    protected onInset(value: number):    void { this.inset.set(value); this.apply(); }
    protected onRadius(value: number):   void { this.radius.set(value); this.apply(); }

    /** Validate + apply the textarea contents as a custom SVG mask (C.1d). */
    protected applySvg(): void {
        const result = extractSvgMaskPath(this.svgInput());
        if (!result.ok) {
            this.svgError.set(result.error);
            return;
        }
        this.svgError.set(null);
        this.customPath.set(result.d);
        this.shape.set('custom');
        this.apply();
    }

    /** Read an uploaded SVG file into the textarea and apply it. */
    protected async onFile(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        // Reset so re-picking the same file fires `change` again.
        input.value = '';
        if (file === null) return;
        try {
            this.svgInput.set(await file.text());
            this.applySvg();
        } catch {
            this.svgError.set('Could not read the file.');
        }
    }

    private apply(): void {
        const shape = this.shape();
        // A custom mask with no geometry yet is a no-op -- wait for the
        // user to paste / upload and hit "Use as mask" rather than
        // stamping (and clearing) an empty clip.
        if (shape === 'custom' && this.customPath().trim() === '') return;

        const spec: MaskSpec = {
            shape,
            inset:   this.inset(),
            radius:  this.radius(),
            svgPath: shape === 'custom' ? this.customPath() : undefined,
        };
        this.state.engine()?.setMask(spec);
    }
}
