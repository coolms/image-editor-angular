import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { ShapeKind, FillType, FillSpec } from '../../types/layer.types';
import { DEFAULT_SHAPE_OPTIONS, DEFAULT_FILL_SPEC } from '../../types/layer.types';

/**
 * Insert + style shapes (C.1). The kind buttons add a centred shape
 * using the current fill / stroke / width as defaults; when a shape
 * layer is selected, the same controls edit it live through the
 * engine's `updateActiveObject`. The controls double as next-insert
 * defaults, so styling one shape pre-styles the next.
 */
@Component({
    selector: 'coolms-image-editor-shape-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="shape-tool">
            <div class="shape-grid">
                @for (s of shapes; track s.kind) {
                    <button type="button" class="shape-btn" [title]="s.label"
                            [disabled]="!state.isReady()" (click)="add(s.kind)">
                        <i class="bi" [class]="s.icon"></i>
                        <span>{{ s.label }}</span>
                    </button>
                }
            </div>

            <div class="prop-group">
                <span class="prop-hint">
                    {{ editingShape() ? 'Editing selected shape' : 'Style for new shapes' }}
                </span>

                <div class="prop-row">
                    <span>Fill</span>
                    <div class="btn-row">
                        @for (m of fillModes; track m.value) {
                            <button type="button" class="seg" [class.seg--on]="fillType() === m.value"
                                    [title]="m.label" (click)="onFillType(m.value)">{{ m.label }}</button>
                        }
                    </div>
                </div>
                <label class="prop-row">
                    <span>{{ fillType() === 'solid' ? 'Colour' : 'Colour 1' }}</span>
                    <input type="color" [value]="fill()" (input)="onFill($any($event.target).value)">
                </label>
                @if (fillType() !== 'solid') {
                    <label class="prop-row">
                        <span>Colour 2</span>
                        <input type="color" [value]="fill2()" (input)="onFill2($any($event.target).value)">
                    </label>
                }
                @if (fillType() === 'linear') {
                    <label class="prop-row">
                        <span>Angle</span>
                        <input type="range" min="0" max="360" step="5" [value]="angle()"
                               (input)="onAngle(+$any($event.target).value)">
                        <output>{{ angle() }}°</output>
                    </label>
                }

                <label class="prop-row">
                    <span>Stroke</span>
                    <input type="color" [value]="stroke()" (input)="onStroke($any($event.target).value)">
                </label>
                <label class="prop-row">
                    <span>Width</span>
                    <input type="range" min="0" max="40" step="1" [value]="strokeWidth()"
                           (input)="onStrokeWidth(+$any($event.target).value)">
                    <output>{{ strokeWidth() }}</output>
                </label>
                <label class="prop-row">
                    <span>Opacity</span>
                    <input type="range" min="0" max="1" step="0.05" [value]="opacity()"
                           (input)="onOpacity(+$any($event.target).value)">
                    <output>{{ (opacity() * 100).toFixed(0) }}%</output>
                </label>
            </div>
        </div>
    `,
    styles: [`
        .shape-tool { display: flex; flex-direction: column; gap: 16px; }
        .shape-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .shape-btn {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            padding: 10px 4px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius);
            color: var(--cms-text-secondary); cursor: pointer;
        }
        .shape-btn > .bi { font-size: 1.125rem; }
        .shape-btn > span { font-size: .6875rem; }
        .shape-btn:hover:not(:disabled) {
            background: var(--cms-btn-hover-bg); border-color: var(--cms-btn-hover-border);
            color: var(--cms-text);
        }
        .shape-btn:disabled { opacity: .4; cursor: not-allowed; }
        .prop-group { display: flex; flex-direction: column; gap: 10px; }
        .prop-hint {
            font-size: .6875rem; font-weight: 700; letter-spacing: .04em;
            text-transform: uppercase; color: var(--cms-text-muted);
        }
        .prop-row {
            display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 10px;
            font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .prop-row input[type=color] { width: 100%; height: 28px; padding: 0; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm); background: none; cursor: pointer; }
        .prop-row input[type=range] { width: 100%; }
        .prop-row output { font-variant-numeric: tabular-nums; color: var(--cms-text-muted); min-width: 36px; text-align: right; }
        .btn-row { display: flex; gap: 6px; }
        .seg {
            flex: 1; padding: 6px 4px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm);
            color: var(--cms-text-secondary); font-size: .75rem; cursor: pointer;
        }
        .seg--on { background: var(--cms-accent-light); border-color: var(--cms-accent); color: var(--cms-accent-text); }
    `],
})
export class ShapeToolComponent {
    protected readonly state = inject(ImageEditorStateService);

    protected readonly shapes: { kind: ShapeKind; icon: string; label: string }[] = [
        { kind: 'rect',     icon: 'bi-square',        label: 'Rect' },
        { kind: 'ellipse',  icon: 'bi-circle',        label: 'Ellipse' },
        { kind: 'triangle', icon: 'bi-triangle',      label: 'Triangle' },
        { kind: 'line',     icon: 'bi-slash-lg',      label: 'Line' },
        { kind: 'arrow',    icon: 'bi-arrow-right',   label: 'Arrow' },
    ];

    protected readonly fillModes: { value: FillType; label: string }[] = [
        { value: 'solid',  label: 'Solid' },
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
    ];

    protected readonly fillType    = signal<FillType>(DEFAULT_FILL_SPEC.type);
    protected readonly fill        = signal(DEFAULT_SHAPE_OPTIONS.fill);
    protected readonly fill2       = signal(DEFAULT_FILL_SPEC.color2);
    protected readonly angle       = signal(DEFAULT_FILL_SPEC.angle);
    protected readonly stroke      = signal(DEFAULT_SHAPE_OPTIONS.stroke);
    protected readonly strokeWidth = signal(DEFAULT_SHAPE_OPTIONS.strokeWidth);
    protected readonly opacity     = signal(1);

    /** True while a shape layer is the active object. */
    protected readonly editingShape = computed(() => this.state.activeLayerKind() === 'shape');

    constructor() {
        // When the selected shape changes, pull its current style into
        // the controls so they edit (not reset) it. Depends on the
        // active-layer signals only, never the layer list, so a live
        // style edit doesn't feed back into the inputs.
        effect(() => {
            const kind = this.state.activeLayerKind();
            const id   = this.state.activeLayerId();
            if (kind !== 'shape' || id === null) return;
            const engine = this.state.engine();
            const props = engine?.getActiveObjectProps();
            if (props == null) return;
            if (props['stroke'] !== undefined && props['stroke'] !== '') this.stroke.set(String(props['stroke']));
            if (props['strokeWidth'] !== undefined) this.strokeWidth.set(Number(props['strokeWidth']));
            if (props['opacity'] !== undefined)     this.opacity.set(Number(props['opacity']));
            // Fill comes back as a structured spec so a gradient
            // round-trips (mode + both stops + angle), not just a colour.
            const f = engine?.getActiveObjectFill();
            if (f != null) {
                this.fillType.set(f.type);
                this.fill.set(f.color);
                this.fill2.set(f.color2);
                this.angle.set(f.angle);
            }
        });
    }

    protected add(kind: ShapeKind): void {
        this.state.engine()?.addShape(kind, {
            fill: this.fill(), stroke: this.stroke(), strokeWidth: this.strokeWidth(),
            fillSpec: this.currentFill(),
        });
    }

    protected onFillType(v: FillType):  void { this.fillType.set(v); this.applyFill(); }
    protected onFill(v: string):        void { this.fill.set(v);     this.applyFill(); }
    protected onFill2(v: string):       void { this.fill2.set(v);    this.applyFill(); }
    protected onAngle(v: number):       void { this.angle.set(v);    this.applyFill(); }
    protected onStroke(v: string):      void { this.stroke.set(v);      this.applyIfEditing({ stroke: v }); }
    protected onStrokeWidth(v: number): void { this.strokeWidth.set(v); this.applyIfEditing({ strokeWidth: v }); }
    protected onOpacity(v: number):     void { this.opacity.set(v);     this.applyIfEditing({ opacity: v }); }

    private currentFill(): FillSpec {
        return { type: this.fillType(), color: this.fill(), color2: this.fill2(), angle: this.angle() };
    }

    private applyFill(): void {
        if (this.editingShape()) this.state.engine()?.setActiveObjectFill(this.currentFill());
    }

    private applyIfEditing(props: Record<string, string | number>): void {
        if (this.editingShape()) this.state.engine()?.updateActiveObject(props);
    }
}
