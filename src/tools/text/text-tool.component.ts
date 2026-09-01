import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { FillType, FillSpec } from '../../types/layer.types';
import { DEFAULT_TEXT_OPTIONS, DEFAULT_FILL_SPEC, TEXT_FONT_FAMILIES } from '../../types/layer.types';

/**
 * Insert + style text (C.1). "Add text" drops a centred editable
 * text box; when a text layer is selected, the controls edit it live
 * (content, font, size, colour, weight / style, alignment) through the
 * engine's `updateActiveObject`.
 */
@Component({
    selector: 'coolms-image-editor-text-tool',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="text-tool">
            <button type="button" class="add-btn" [disabled]="!state.isReady()" (click)="add()">
                <i class="bi bi-fonts"></i> Add text
            </button>

            @if (editingText()) {
                <label class="prop-row prop-row--stack">
                    <span>Text</span>
                    <textarea rows="2" [value]="text()"
                              (input)="onText($any($event.target).value)"></textarea>
                </label>
            }

            <div class="prop-group">
                <span class="prop-hint">
                    {{ editingText() ? 'Editing selected text' : 'Style for new text' }}
                </span>

                <label class="prop-row">
                    <span>Font</span>
                    <select [value]="fontFamily()" (change)="onFontFamily($any($event.target).value)">
                        @for (f of fonts; track f) { <option [value]="f">{{ f }}</option> }
                    </select>
                </label>
                <label class="prop-row">
                    <span>Size</span>
                    <input type="number" min="6" max="400" step="1" [value]="fontSize()"
                           (input)="onFontSize(+$any($event.target).value)">
                </label>
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
                    <label class="prop-row prop-row--range">
                        <span>Angle</span>
                        <input type="range" min="0" max="360" step="5" [value]="angle()"
                               (input)="onAngle(+$any($event.target).value)">
                        <output>{{ angle() }}°</output>
                    </label>
                }

                <div class="prop-row">
                    <span>Style</span>
                    <div class="btn-row">
                        <button type="button" class="seg" [class.seg--on]="bold()" title="Bold" (click)="toggleBold()"><i class="bi bi-type-bold"></i></button>
                        <button type="button" class="seg" [class.seg--on]="italic()" title="Italic" (click)="toggleItalic()"><i class="bi bi-type-italic"></i></button>
                    </div>
                </div>
                <div class="prop-row">
                    <span>Align</span>
                    <div class="btn-row">
                        @for (a of aligns; track a.value) {
                            <button type="button" class="seg" [class.seg--on]="textAlign() === a.value"
                                    [title]="a.value" (click)="onAlign(a.value)"><i class="bi" [class]="a.icon"></i></button>
                        }
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        .text-tool { display: flex; flex-direction: column; gap: 14px; }
        .add-btn {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            padding: 9px 12px; background: var(--cms-accent); color: var(--cms-accent-fg, #1a1a1a);
            border: 1px solid var(--cms-accent); border-radius: var(--cms-radius);
            font-size: .8125rem; font-weight: 600; cursor: pointer;
        }
        .add-btn:disabled { opacity: .4; cursor: not-allowed; }
        .prop-group { display: flex; flex-direction: column; gap: 10px; }
        .prop-hint {
            font-size: .6875rem; font-weight: 700; letter-spacing: .04em;
            text-transform: uppercase; color: var(--cms-text-muted);
        }
        .prop-row {
            display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 10px;
            font-size: .8125rem; color: var(--cms-text-secondary);
        }
        .prop-row--stack { grid-template-columns: 1fr; }
        .prop-row--range { grid-template-columns: 64px 1fr auto; }
        .prop-row input[type=range] { width: 100%; }
        .prop-row output { font-variant-numeric: tabular-nums; color: var(--cms-text-muted); min-width: 36px; text-align: right; }
        .prop-row textarea, .prop-row select, .prop-row input[type=number] {
            width: 100%; padding: 6px 8px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm);
            color: var(--cms-text); font: inherit;
        }
        .prop-row input[type=color] { width: 100%; height: 28px; padding: 0; border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm); background: none; cursor: pointer; }
        .btn-row { display: flex; gap: 6px; }
        .seg {
            flex: 1; padding: 6px; background: var(--cms-surface);
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-sm);
            color: var(--cms-text-secondary); cursor: pointer;
        }
        .seg--on { background: var(--cms-accent-light); border-color: var(--cms-accent); color: var(--cms-accent-text); }
    `],
})
export class TextToolComponent {
    protected readonly state = inject(ImageEditorStateService);

    protected readonly fonts  = TEXT_FONT_FAMILIES;
    protected readonly aligns = [
        { value: 'left'   as const, icon: 'bi-text-left' },
        { value: 'center' as const, icon: 'bi-text-center' },
        { value: 'right'  as const, icon: 'bi-text-right' },
    ];

    protected readonly fillModes: { value: FillType; label: string }[] = [
        { value: 'solid',  label: 'Solid' },
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
    ];

    protected readonly text       = signal(DEFAULT_TEXT_OPTIONS.text);
    protected readonly fontFamily = signal<string>(DEFAULT_TEXT_OPTIONS.fontFamily);
    protected readonly fontSize   = signal(DEFAULT_TEXT_OPTIONS.fontSize);
    protected readonly fillType   = signal<FillType>(DEFAULT_FILL_SPEC.type);
    protected readonly fill       = signal(DEFAULT_TEXT_OPTIONS.fill);
    protected readonly fill2      = signal(DEFAULT_FILL_SPEC.color2);
    protected readonly angle      = signal(DEFAULT_FILL_SPEC.angle);
    protected readonly bold       = signal(false);
    protected readonly italic     = signal(false);
    protected readonly textAlign  = signal<'left' | 'center' | 'right'>('left');

    protected readonly editingText = computed(() => this.state.activeLayerKind() === 'text');

    constructor() {
        effect(() => {
            const kind = this.state.activeLayerKind();
            const id   = this.state.activeLayerId();
            if (kind !== 'text' || id === null) return;
            const engine = this.state.engine();
            const props = engine?.getActiveObjectProps();
            if (props == null) return;
            this.text.set(String(props['text'] ?? ''));
            this.fontFamily.set(String(props['fontFamily'] ?? this.fontFamily()));
            this.fontSize.set(Number(props['fontSize'] ?? this.fontSize()));
            this.bold.set(String(props['fontWeight'] ?? 'normal') === 'bold');
            this.italic.set(String(props['fontStyle'] ?? 'normal') === 'italic');
            this.textAlign.set((String(props['textAlign'] ?? 'left') as 'left' | 'center' | 'right'));
            // Fill round-trips as a structured spec so a gradient
            // restores its mode + both stops + angle, not just a colour.
            const f = engine?.getActiveObjectFill();
            if (f != null) {
                this.fillType.set(f.type);
                this.fill.set(f.color);
                this.fill2.set(f.color2);
                this.angle.set(f.angle);
            }
        });
    }

    protected add(): void {
        this.state.engine()?.addText({
            text: this.text() || 'Text',
            fontFamily: this.fontFamily(),
            fontSize: this.fontSize(),
            fill: this.fill(),
            fillSpec: this.currentFill(),
            fontWeight: this.bold() ? 'bold' : 'normal',
            fontStyle: this.italic() ? 'italic' : 'normal',
            textAlign: this.textAlign(),
        });
    }

    protected onText(v: string):       void { this.text.set(v);       this.apply({ text: v }); }
    protected onFontFamily(v: string): void { this.fontFamily.set(v); this.apply({ fontFamily: v }); }
    protected onFontSize(v: number):   void { this.fontSize.set(v);   this.apply({ fontSize: v }); }
    protected onFillType(v: FillType): void { this.fillType.set(v);   this.applyFill(); }
    protected onFill(v: string):       void { this.fill.set(v);       this.applyFill(); }
    protected onFill2(v: string):      void { this.fill2.set(v);      this.applyFill(); }
    protected onAngle(v: number):      void { this.angle.set(v);      this.applyFill(); }
    protected onAlign(v: 'left' | 'center' | 'right'): void { this.textAlign.set(v); this.apply({ textAlign: v }); }

    protected toggleBold(): void {
        this.bold.update(b => !b);
        this.apply({ fontWeight: this.bold() ? 'bold' : 'normal' });
    }
    protected toggleItalic(): void {
        this.italic.update(i => !i);
        this.apply({ fontStyle: this.italic() ? 'italic' : 'normal' });
    }

    private currentFill(): FillSpec {
        return { type: this.fillType(), color: this.fill(), color2: this.fill2(), angle: this.angle() };
    }

    private applyFill(): void {
        if (this.editingText()) this.state.engine()?.setActiveObjectFill(this.currentFill());
    }

    private apply(props: Record<string, string | number>): void {
        if (this.editingText()) this.state.engine()?.updateActiveObject(props);
    }
}
