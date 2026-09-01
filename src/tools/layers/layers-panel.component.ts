import {
    ChangeDetectionStrategy, Component, computed, inject,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';
import type { LayerInfo } from '../../types/layer.types';

/**
 * Layers panel (C.1). Lists the stack top-most first: select, show /
 * hide, reorder, delete, and adjust the selected layer's opacity. The
 * base image is the locked floor — it can't be deleted or restacked.
 */
@Component({
    selector: 'coolms-image-editor-layers-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="layers">
            @if (selected(); as sel) {
                @if (!sel.locked) {
                    <label class="opacity-row">
                        <span>Opacity</span>
                        <input type="range" min="0" max="1" step="0.05" [value]="sel.opacity"
                               (input)="setOpacity(sel.id, +$any($event.target).value)">
                        <output>{{ (sel.opacity * 100).toFixed(0) }}%</output>
                    </label>
                }
            }

            <ul class="layer-list">
                @for (layer of layers(); track layer.id; let i = $index, last = $last) {
                    <li class="layer-item"
                        [class.layer-item--active]="layer.id === activeId()"
                        [class.layer-item--hidden]="!layer.visible">
                        <button type="button" class="icon-btn" [title]="layer.visible ? 'Hide' : 'Show'"
                                (click)="toggleVisible(layer)">
                            <i class="bi" [class]="layer.visible ? 'bi-eye' : 'bi-eye-slash'"></i>
                        </button>
                        <button type="button" class="layer-name" (click)="select(layer.id)">
                            <i class="bi" [class]="kindIcon(layer.kind)"></i>
                            <span>{{ layer.name }}</span>
                            @if (layer.locked) { <i class="bi bi-lock-fill lock"></i> }
                        </button>
                        @if (!layer.locked) {
                            <div class="layer-actions">
                                <button type="button" class="icon-btn" title="Move up"
                                        [disabled]="i === 0" (click)="reorder(layer.id, 'up')">
                                    <i class="bi bi-chevron-up"></i>
                                </button>
                                <button type="button" class="icon-btn" title="Move down"
                                        [disabled]="i >= layers().length - 2" (click)="reorder(layer.id, 'down')">
                                    <i class="bi bi-chevron-down"></i>
                                </button>
                                <button type="button" class="icon-btn icon-btn--danger" title="Delete"
                                        (click)="remove(layer.id)">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        }
                    </li>
                }
            </ul>
        </div>
    `,
    styles: [`
        .layers { display: flex; flex-direction: column; gap: 12px; }
        .opacity-row {
            display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 10px;
            font-size: .8125rem; color: var(--cms-text-secondary);
            padding-bottom: 10px; border-bottom: 1px solid var(--cms-border-light);
        }
        .opacity-row output { font-variant-numeric: tabular-nums; color: var(--cms-text-muted); min-width: 36px; text-align: right; }
        .layer-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .layer-item {
            display: flex; align-items: center; gap: 4px; padding: 4px 6px;
            border: 1px solid transparent; border-radius: var(--cms-radius-sm);
        }
        .layer-item--active { background: var(--cms-accent-light); border-color: var(--cms-accent); }
        .layer-item--hidden .layer-name { opacity: .5; }
        .layer-name {
            flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0;
            background: none; border: none; color: var(--cms-text); cursor: pointer;
            font-size: .8125rem; text-align: left; padding: 4px 2px;
        }
        .layer-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .layer-name .lock { font-size: .6875rem; color: var(--cms-text-muted); margin-left: auto; }
        .layer-actions { display: flex; gap: 2px; }
        .icon-btn {
            border: none; background: transparent; color: var(--cms-text-muted);
            cursor: pointer; padding: 4px 5px; border-radius: var(--cms-radius-sm); line-height: 1;
        }
        .icon-btn:hover:not(:disabled) { background: var(--cms-border-light); color: var(--cms-text); }
        .icon-btn:disabled { opacity: .3; cursor: not-allowed; }
        .icon-btn--danger:hover:not(:disabled) { color: var(--cms-danger, #dc2626); }
    `],
})
export class LayersPanelComponent {
    protected readonly state = inject(ImageEditorStateService);

    protected readonly layers   = this.state.layers;
    protected readonly activeId = this.state.activeLayerId;

    protected readonly selected = computed<LayerInfo | null>(() => {
        const id = this.activeId();
        return id === null ? null : (this.layers().find(l => l.id === id) ?? null);
    });

    protected kindIcon(kind: LayerInfo['kind']): string {
        return kind === 'image' ? 'bi-image' : kind === 'text' ? 'bi-fonts' : 'bi-pentagon';
    }

    protected select(id: string): void { this.state.engine()?.selectLayer(id); }
    protected remove(id: string): void { this.state.engine()?.removeLayer(id); }
    protected reorder(id: string, dir: 'up' | 'down'): void { this.state.engine()?.reorderLayer(id, dir); }
    protected setOpacity(id: string, value: number): void { this.state.engine()?.setLayerOpacity(id, value); }
    protected toggleVisible(layer: LayerInfo): void { this.state.engine()?.setLayerVisibility(layer.id, !layer.visible); }
}
