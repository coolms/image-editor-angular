import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

interface OverwriteConfirmData {
    readonly filename: string;
    /**
     * Optional note shown above the actions -- e.g. a transparency ->
     * PNG format-change warning on overwrite (C.1d).
     */
    readonly formatNote?: string;
}

/**
 * Confirmation dialog before an overwrite save commits.
 *
 * Closes with `true` on Replace, `false` on Cancel. Lives inside the
 * package so the host has no dependency on the legacy
 * `features/image-editor/` directory; the wording is a near-copy of
 * the legacy version because the user-facing message hasn't changed.
 */
@Component({
    selector: 'coolms-image-editor-overwrite-confirm-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="confirm-dialog">
            <header class="confirm-dialog__header">
                <h3 class="confirm-dialog__title">Replace original?</h3>
            </header>
            <p class="confirm-dialog__message">
                This will replace
                <strong>{{ data.filename }}</strong>
                with the edited image. Existing references on pages will
                show the new bytes after thumbnail regeneration completes.
            </p>
            @if (data.formatNote) {
                <p class="confirm-dialog__note">{{ data.formatNote }}</p>
            }
            <footer class="confirm-dialog__footer">
                <button type="button" class="cms-btn" (click)="onCancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-danger" (click)="onConfirm()">Replace</button>
            </footer>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: min(90vw, 420px);
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg);
        }
        .confirm-dialog__header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--cms-border);
        }
        .confirm-dialog__title { margin: 0; font-size: 1rem; }
        .confirm-dialog__message {
            padding: 16px;
            margin: 0;
            color: var(--cms-text);
            line-height: 1.5;
        }
        .confirm-dialog__note {
            margin: 0;
            padding: 0 16px 16px;
            color: var(--cms-text-secondary);
            font-size: .8125rem;
            line-height: 1.5;
        }
        .confirm-dialog__footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--cms-border);
        }
    `],
})
export class OverwriteConfirmDialogComponent {
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    protected readonly data    = inject<OverwriteConfirmData>(DIALOG_DATA);

    onConfirm(): void { this.dialogRef.close(true); }
    onCancel():  void { this.dialogRef.close(false); }
}
