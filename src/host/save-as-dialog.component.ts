import {
    ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

interface SaveAsData {
    readonly sourceFilename: string;
    /**
     * When true, the edit has transparency that only PNG can store
     * (C.1d): the default name is given a `.png` extension and a hint
     * explains the format choice.
     */
    readonly forcePng?: boolean;
}

export interface CoolmsSaveAsDialogResult {
    readonly filename: string;
}

/**
 * "Save as new" filename prompt.
 *
 * The collection picker stays out of scope: the backend defaults to the
 * source asset's parent directory when no target collection is supplied,
 * which is the intended UX. Closes with `{ filename }` on Save and
 * `undefined` on Cancel.
 */
@Component({
    selector: 'coolms-image-editor-save-as-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="save-as-dialog">
            <header class="save-as-dialog__header">
                <h3 class="save-as-dialog__title">Save as new image</h3>
            </header>
            <div class="save-as-dialog__body">
                <label class="save-as-dialog__field">
                    <span>Filename</span>
                    <input type="text"
                           class="form-control"
                           autofocus
                           [ngModel]="filename()"
                           (ngModelChange)="filename.set($event)"
                           (keydown.enter)="onConfirm()"
                           placeholder="filename.jpg">
                </label>
                @if (data.forcePng) {
                    <p class="save-as-dialog__hint save-as-dialog__hint--png">
                        This edit has transparent areas, so it'll be saved as
                        <strong>PNG</strong> to keep them — the name was given a
                        <code>.png</code> extension.
                    </p>
                }
                <p class="save-as-dialog__hint">
                    Saved to the same collection as the source. You can
                    move the new asset later from the media library.
                </p>
            </div>
            <footer class="save-as-dialog__footer">
                <button type="button" class="cms-btn" (click)="onCancel()">Cancel</button>
                <button type="button"
                        class="cms-btn cms-btn-primary"
                        [disabled]="!canSubmit()"
                        (click)="onConfirm()">Save</button>
            </footer>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: min(90vw, 460px);
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
        }
        .save-as-dialog__header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border);
        }
        .save-as-dialog__title { margin: 0; font-size: 1rem; }
        .save-as-dialog__body { padding: 16px; }
        .save-as-dialog__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: .6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .04em;
            color: var(--cms-text-muted);
        }
        .save-as-dialog__field input {
            font-size: .875rem; font-weight: 400;
            text-transform: none; letter-spacing: 0;
        }
        .save-as-dialog__hint {
            margin: 12px 0 0;
            color: var(--cms-text-muted);
            font-size: .75rem;
            line-height: 1.5;
        }
        .save-as-dialog__hint--png {
            color: var(--cms-text-secondary);
        }
        .save-as-dialog__hint code {
            font-family: var(--cms-font-mono, monospace);
        }
        .save-as-dialog__footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--cms-border);
        }
    `],
})
export class SaveAsDialogComponent implements OnInit {
    private readonly dialogRef = inject<DialogRef<CoolmsSaveAsDialogResult | undefined>>(DialogRef);
    protected readonly data    = inject<SaveAsData>(DIALOG_DATA);

    readonly filename  = signal<string>('');
    readonly canSubmit = computed(() => this.filename().trim() !== '');

    ngOnInit(): void {
        const base = this.deriveDefault(this.data.sourceFilename);
        this.filename.set(this.data.forcePng ? this.withPngExtension(base) : base);
    }

    onConfirm(): void {
        if (!this.canSubmit()) return;
        this.dialogRef.close({ filename: this.filename().trim() });
    }

    onCancel(): void {
        this.dialogRef.close(undefined);
    }

    private deriveDefault(sourceFilename: string): string {
        const dotIdx = sourceFilename.lastIndexOf('.');
        if (dotIdx <= 0) {
            return sourceFilename + '-edited';
        }
        const stem = sourceFilename.slice(0, dotIdx);
        const ext  = sourceFilename.slice(dotIdx);
        return stem + '-edited' + ext;
    }

    /** Swap (or append) a `.png` extension for a transparency-preserving save. */
    private withPngExtension(name: string): string {
        const dotIdx = name.lastIndexOf('.');
        const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
        return stem + '.png';
    }
}
