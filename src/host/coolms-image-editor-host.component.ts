import {
    ChangeDetectionStrategy, Component, DestroyRef, HostBinding, HostListener,
    OnDestroy, OnInit, ViewChild,
    computed, effect, inject, signal,
} from '@angular/core';

import { HttpClient } from '@angular/common/http';
import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';

import { CoolmsImageEditorComponent } from '../components/coolms-image-editor.component';
import { OverwriteConfirmDialogComponent } from './overwrite-confirm-dialog.component';
import {
    SaveAsDialogComponent, type CoolmsSaveAsDialogResult,
} from './save-as-dialog.component';
import {
    CoolmsImageEditorHostData, CoolmsImageEditorHostResult,
} from './coolms-image-editor-host.types';
import type { ImageEditorEngine } from '../engine/image-editor-engine.interface';

import { ConfirmDialogService, EscCoordinatorService, ToastService, UnsavedChangesService } from '@coolms/ui-angular';
import { ImageEditorHttpService } from '../services/image-editor-http.service';

type HostState = 'preparing' | 'editing' | 'saving' | 'error';

/**
 * CDK Dialog host wrapping `CoolmsImageEditorComponent`.
 *
 * Save flow (discriminated context):
 *
 *   Media context:
 *     Save  -> OverwriteConfirm -> POST /api/v1/media/{id}/replace
 *     SaveAs -> SaveAs prompt   -> POST /api/v1/vfs/files/binary (new file under
 *                               the source collection; auto-promoted to an asset)
 *
 *   VFS context:
 *     Save  -> OverwriteConfirm -> POST /api/v1/vfs/files/binary (overwrite=true)
 *     SaveAs -> SaveAs prompt   -> POST /api/v1/vfs/files/binary (overwrite=false)
 *
 *   Cancel -> close with `{ kind: 'cancelled' }` in either context.
 *
 * Save button gating: in the VFS context, `canWrite=false` disables
 * Save (overwriting a read-only file would 403 anyway) but Save as
 * stays enabled -- the user can always save a copy if they have
 * write permission on the parent directory.
 *
 * Failures stay non-fatal: the dialog stays open with state set back
 * to `editing` so the author can retry, and a toast carries a
 * descriptive message (status code -> friendly label, or `.message`
 * fallback). The engine remains live throughout.
 */
@Component({
    selector: 'coolms-image-editor-host',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CoolmsImageEditorComponent],
    templateUrl: './coolms-image-editor-host.component.html',
    styleUrls: ['./coolms-image-editor-host.component.scss'],
})
export class CoolmsImageEditorHostComponent implements OnInit, OnDestroy {
    private readonly cdkDialog   = inject(Dialog);
    private readonly dialogRef   = inject<DialogRef<CoolmsImageEditorHostResult>>(DialogRef);
    private readonly editService = inject(ImageEditorHttpService);
    private readonly toast       = inject(ToastService);
    private readonly http        = inject(HttpClient);
    private readonly esc         = inject(EscCoordinatorService);
    private readonly confirm     = inject(ConfirmDialogService);
    private readonly unsaved     = inject(UnsavedChangesService);
    private readonly destroyRef  = inject(DestroyRef);

    protected readonly data = inject<CoolmsImageEditorHostData>(DIALOG_DATA);

    readonly state        = signal<HostState>('preparing');
    readonly errorMessage = signal<string | null>(null);

    /**
     * Object URL fed into the embedded shell. Resolved asynchronously in
     * `ngOnInit`: VFS sources go through HttpClient (so the auth interceptor
     * attaches the Bearer token) and become a `blob:` URL the engine can
     * load via a regular `<img>` element. Media sources are public, so the
     * original URL passes through unchanged.
     */
    readonly resolvedSourceUrl = signal<string | null>(null);

    /** Tracks the blob: URL we own so `ngOnDestroy` can revoke it. */
    private ownedObjectUrl: string | null = null;

    /**
     * Captured the moment the shell finishes loading the image. Save
     * actions check this through the `engineReadyOk` signal so the
     * Save buttons only enable once an engine handle is available.
     */
    private engine: ImageEditorEngine | null = null;

    @ViewChild(CoolmsImageEditorComponent)
    private readonly shell?: CoolmsImageEditorComponent;

    readonly engineReadyOk = signal<boolean>(false);
    readonly isSaving      = computed(() => this.state() === 'saving');
    /**
     * Set once the caller's `requestWrite` resolved true: the server elevated
     * the session, so the flag it computed before no longer describes it.
     */
    private readonly writeGranted = signal<boolean>(false);

    /** Whether the VFS file is writable: the flag, or an elevation granted since. */
    private readonly canWrite = computed(() => {
        const data = this.data;
        return data.context !== 'vfs' || data.node.canWrite || this.writeGranted();
    });

    /**
     * Save (overwrite) is gated on engine readiness AND, for VFS context,
     * write permission -- unless the caller offered `requestWrite`, in which
     * case the button stays live and asks for elevation instead of sitting
     * dead (the control stays live and the server decides).
     */
    readonly canSave       = computed(() => {
        if (!this.engineReadyOk() || this.state() !== 'editing') return false;
        return this.canWrite() || this.canRequestWrite();
    });
    private readonly canRequestWrite = computed(() => {
        const data = this.data;
        return data.context === 'vfs' && !!data.node.requestWrite;
    });
    /** Save as is gated only on engine readiness -- even read-only sources can be saved as new. */
    readonly canSaveAs     = computed(
        () => this.engineReadyOk() && this.state() === 'editing',
    );
    readonly canClose      = computed(() => this.state() !== 'saving');

    /** Filename header label and default save-as name. */
    readonly filename = computed(
        () => this.data.context === 'media' ? this.data.asset.filename : this.data.node.filename,
    );
    /** Source MIME, drives export format. */
    readonly mimeType = computed(
        () => this.data.context === 'media' ? this.data.asset.mimeType : this.data.node.mimeType,
    );

    readonly dimensionsLabel = computed(() => {
        const dim = this.data.context === 'media'
            ? this.data.asset.dimensions
            : this.data.node.dimensions ?? null;
        // Defensive: backend may serialise `dimensions` as an object
        // with `null` width/height before processing completes (the
        // shape is non-null but the values are). Treat that as "not
        // available" rather than rendering literal "null x null".
        if (dim == null || dim.width == null || dim.height == null) return '';
        return `${dim.width} × ${dim.height}`;
    });

    /**
     * CSS-only fullscreen mode, mirroring viewer-modal's pattern.
     * Toggle from the header button or by dblclicking a non-interactive
     * area of the host. ESC exits fullscreen via the EscCoordinator
     * stack so it composes cleanly with any future dialog-level ESC
     * handlers; the host opens with CDK `disableClose: true`, so the
     * dialog itself never closes on ESC -- only the X / Cancel buttons
     * exit the editor.
     */
    readonly isFullscreen = signal(false);

    @HostBinding('class.image-editor-host--fullscreen')
    get fullscreenClass(): boolean {
        return this.isFullscreen();
    }

    toggleFullscreen(): void {
        this.isFullscreen.update((v) => !v);
    }

    /**
     * Double-click anywhere on the dialog toggles fullscreen, EXCEPT
     * on interactive controls and the editor canvas. The canvas is
     * the primary work surface and fabric.js may bind its own
     * dblclick semantics (object enter, text edit, etc.); excluding
     * it keeps that path clear.
     */
    @HostListener('dblclick', ['$event'])
    protected onDblClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, select, textarea, canvas')) return;
        this.toggleFullscreen();
    }

    constructor() {
        // beforeunload half: a tab close cannot be intercepted by
        // the Cancel button. Disposed with the component so a closed editor
        // stops voting.
        this.destroyRef.onDestroy(this.unsaved.watch(this, () => this.hasEdits()));

        // ESC while fullscreen exits fullscreen. No-op outside
        // fullscreen -- the dialog stays open until Close X / Cancel
        // (per Decision 1: editor had no ESC handler before, and
        // adding a dialog-close shortcut could trigger unsaved-work
        // surprises without a confirm flow in place).
        effect((onCleanup) => {
            if (!this.isFullscreen()) return;
            const unregister = this.esc.register(() => {
                this.isFullscreen.set(false);
                return true;
            });
            onCleanup(unregister);
        });

        // Refit the fabric canvas after every fullscreen toggle. The
        // canvas-mount ResizeObserver also fires on the size change
        // but stays conservative (preserves manual zoom); fullscreen
        // is an intentional viewport switch where re-centering and
        // re-fitting beat any prior manual zoom.
        let firstRun = true;
        effect(() => {
            this.isFullscreen();
            if (firstRun) {
                firstRun = false;
                return;
            }
            // Wait one frame for the CSS class swap (and the
            // ResizeObserver) to land before measuring + refitting.
            setTimeout(() => this.shell?.refit(), 50);
        });
    }

    async ngOnInit(): Promise<void> {
        try {
            // VFS preview is gated by the stateless API firewall, which only
            // accepts a Bearer token on the Authorization header. Plain
            // <img src> requests don't carry one, so Toast UI's
            // loadImageFromURL -> 401 -> "Invalid image loaded.". Fetching
            // through HttpClient runs the auth interceptor, then we hand
            // the engine a same-origin blob: URL it can render normally.
            // Media URLs are public, so we pass them through unchanged.
            if (this.data.context === 'vfs') {
                const blob = await firstValueFrom(
                    this.http.get(this.data.node.sourceUrl, { responseType: 'blob' }),
                );
                this.ownedObjectUrl = URL.createObjectURL(blob);
                this.resolvedSourceUrl.set(this.ownedObjectUrl);
            } else {
                this.resolvedSourceUrl.set(this.data.asset.originalUrl);
            }
            this.state.set('editing');
        } catch (err) {
            this.state.set('error');
            this.errorMessage.set('Failed to load image: ' + this.describeError(err));
        }
    }

    ngOnDestroy(): void {
        if (this.ownedObjectUrl !== null) {
            URL.revokeObjectURL(this.ownedObjectUrl);
            this.ownedObjectUrl = null;
        }
    }

    onEngineReady(engine: ImageEditorEngine): void {
        this.engine = engine;
        this.engineReadyOk.set(true);
    }

    onShellError(err: Error): void {
        this.state.set('error');
        this.errorMessage.set(err.message);
    }

    async onSave(): Promise<void> {
        if (!this.canSave()) return;

        // The flag said read-only and the caller offered a way out: ask.
        // A decline leaves everything as it was, dialog included.
        if (!this.canWrite()) {
            const data = this.data;
            const request = data.context === 'vfs' ? data.node.requestWrite : undefined;
            if (!request || !(await request())) return;
            this.writeGranted.set(true);
        }

        // Warn when transparency forces a JPEG -> PNG format change on
        // an in-place overwrite (C.1d) so it isn't a silent surprise.
        const willConvertToPng =
            this.contentWantsPng() && this.deriveFormat(this.mimeType(), false) !== 'png';

        const confirmRef = this.cdkDialog.open<boolean>(OverwriteConfirmDialogComponent, {
            data: {
                filename: this.filename(),
                formatNote: willConvertToPng
                    ? 'This edit has transparent areas, so it will be saved as PNG — the original format can’t store transparency.'
                    : undefined,
            },
            backdropClass: 'cdk-overlay-dark-backdrop',
        });
        const confirmed = await firstValueFrom(confirmRef.closed);
        if (confirmed !== true) return;

        await this.executeSave('overwrite');
    }

    async onSaveAs(): Promise<void> {
        if (!this.canSaveAs()) return;

        // Pre-fill the save-as name with a .png extension (and explain why)
        // when transparency forces PNG over a non-PNG source (C.1d).
        const forcePng =
            this.contentWantsPng() && this.deriveFormat(this.mimeType(), false) !== 'png';

        const dialogRef = this.cdkDialog.open<CoolmsSaveAsDialogResult | undefined>(
            SaveAsDialogComponent,
            {
                data: { sourceFilename: this.filename(), forcePng },
                backdropClass: 'cdk-overlay-dark-backdrop',
            },
        );
        const result = await firstValueFrom(dialogRef.closed);
        if (result === undefined) return;

        await this.executeSave('save_as_new', result.filename);
    }

    /**
     *  `canClose()` only ever meant "not mid-save" -- there was no dirty
     * concept here at all, so a crop, a rotate and three filters were
     * thrown away by Cancel without a word.
     *
     * `engine.canUndo()` is the dirty flag we would otherwise have had to
     * invent: it is true exactly when the user has done something undoable,
     * and it goes back to false if they undo their way to the start.
     */
    onCancel(): void {
        if (!this.canClose()) return;

        if (!this.hasEdits()) {
            this.dialogRef.close({ kind: 'cancelled' });

            return;
        }

        this.confirm.confirmDiscard(this.filename()).subscribe((discard) => {
            if (discard) this.dialogRef.close({ kind: 'cancelled' });
        });
    }

    /** The engine's undo depth IS "has anything been edited". */
    private hasEdits(): boolean {
        return this.engine?.canUndo() ?? false;
    }

    private async executeSave(
        mode: 'overwrite' | 'save_as_new',
        filename?: string,
    ): Promise<void> {
        const engine = this.engine;
        if (engine === null) return;

        this.state.set('saving');

        try {
            // Drain any in-flight tool so a mid-edit cropper overlay
            // doesn't get baked into the exported pixels (same safety
            // net as beta.4a).
            this.shell?.deactivateActiveTool();

            const format = this.deriveFormat(this.mimeType(), engine.hasAlpha());
            const blob   = await engine.export(format, 0.92);

            const result = this.data.context === 'media'
                ? await this.saveMedia(this.data, mode, blob, filename, format)
                : await this.saveVfs(this.data, mode, blob, filename, format);

            this.toast.success(mode === 'overwrite' ? 'Image saved' : 'New image created');
            this.dialogRef.close(result);
        } catch (error) {
            this.state.set('editing');
            this.toast.error('Save failed: ' + this.describeError(error));
            console.error('CoolmsImageEditorHost save failed:', error);
        }
    }

    private async saveMedia(
        data: Extract<CoolmsImageEditorHostData, { context: 'media' }>,
        mode: 'overwrite' | 'save_as_new',
        blob: Blob,
        newFilename: string | undefined,
        format: 'png' | 'jpeg',
    ): Promise<CoolmsImageEditorHostResult> {
        if (mode === 'overwrite') {
            // A transparency-forced PNG of a JPEG source changes the
            // bytes' format; the replace endpoint allows same-major-type
            // (image/jpeg -> image/png) and re-derives the MIME from the
            // content, so a matching .png name keeps the asset coherent.
            const response = await this.editService.replaceMediaAsset({
                blob,
                assetUuid: data.asset.uuid,
                filename:  this.ensureExtension(data.asset.filename, format),
            });
            return {
                kind:      'saved',
                mode:      'overwrite',
                assetUuid: typeof response.id === 'string' && response.id !== '' ? response.id : data.asset.uuid,
            };
        }

        // "Save as" writes a fresh file via the live VFS binary endpoint.
        // The old `POST /api/v1/media/upload` route was removed (#87), so a
        // new image is created the current way: write it under the source
        // collection's `/media/{collection}/` directory and let the VFS-change
        // listeners auto-promote it to a managed media asset with thumbnails
        //. It then appears in the grid via the realtime refresh.
        const finalName = this.ensureExtension(newFilename ?? this.deriveSaveAsName(data.asset.filename), format);
        const targetDir = this.parentDir(data.asset.path ?? null) ?? '/media/uploads';
        const newPath   = this.joinPath(targetDir, finalName);
        const response  = await this.editService.writeVfsFile({
            blob,
            path:      newPath,
            overwrite: false,
            filename:  finalName,
        });
        return {
            kind:      'saved',
            mode:      'save_as_new',
            assetUuid: typeof response.id === 'string' && response.id !== '' ? response.id : undefined,
        };
    }

    private async saveVfs(
        data: Extract<CoolmsImageEditorHostData, { context: 'vfs' }>,
        mode: 'overwrite' | 'save_as_new',
        blob: Blob,
        newFilename: string | undefined,
        format: 'png' | 'jpeg',
    ): Promise<CoolmsImageEditorHostResult> {
        if (mode === 'overwrite') {
            // Overwrite is pinned to the existing path, so the extension
            // can't change here; the bytes carry the (possibly PNG)
            // format and the VFS write re-derives the MIME from content.
            await this.editService.writeVfsFile({
                blob,
                path:      data.node.path,
                overwrite: true,
                filename:  data.node.filename,
            });
            return { kind: 'saved', mode: 'overwrite', vfsPath: data.node.path };
        }

        const finalName = this.ensureExtension(newFilename ?? this.deriveSaveAsName(data.node.filename), format);
        const newPath   = this.joinPath(data.node.parentPath, finalName);
        await this.editService.writeVfsFile({
            blob,
            path:      newPath,
            overwrite: false,
            filename:  finalName,
        });
        return { kind: 'saved', mode: 'save_as_new', vfsPath: newPath };
    }

    /**
     * Pull a user-readable message out of whatever the HTTP layer
     * threw at us. Angular's `HttpErrorResponse` implements the
     * `Error` interface but doesn't extend the class, so a plain
     * `instanceof Error` check misses it and we'd fall through to
     * "unknown error".
     */
    private describeError(error: unknown): string {
        if (error !== null && typeof error === 'object') {
            const status = (error as { status?: unknown }).status;
            if (typeof status === 'number') {
                if (status === 403) return 'permission denied (403)';
                if (status === 404) return 'asset not found (404)';
                if (status === 409) return 'a file already exists at that name (409)';
                if (status === 0)   return 'network error';
                return `HTTP ${status}`;
            }
            const message = (error as { message?: unknown }).message;
            if (typeof message === 'string' && message !== '') return message;
        }
        if (error instanceof Error && error.message !== '') return error.message;
        return 'unknown error';
    }

    /**
     * Export format. Content wins over source: when the flattened image
     * has any transparency (a mask / clipPath cut-out, or a transparent
     * source) we force PNG, because flattening it onto an opaque JPEG
     * loses the cut-away region to opaque black (the C.1d fix -- masked
     * Save-as previously baked black corners). Otherwise it follows the
     * source MIME (PNG stays PNG, everything else -> JPEG, the two formats
     * the underlying canvas reliably encodes).
     */
    private deriveFormat(mimeType: string, hasAlpha: boolean): 'png' | 'jpeg' {
        if (hasAlpha) return 'png';
        return mimeType === 'image/png' ? 'png' : 'jpeg';
    }

    /** Whether the current edit has transparency the export must preserve. */
    private contentWantsPng(): boolean {
        return this.engine?.hasAlpha() ?? false;
    }

    /**
     * Normalise a filename's extension to match the export format, so a
     * forced-PNG save (transparency preserved) doesn't keep a `.jpg`
     * name. `jpg`/`jpeg` both satisfy the JPEG format.
     */
    private ensureExtension(name: string, format: 'png' | 'jpeg'): string {
        const dot = name.lastIndexOf('.');
        const cur = dot > 0 ? name.slice(dot).toLowerCase() : '';
        if (format === 'png'  && cur === '.png') return name;
        if (format === 'jpeg' && (cur === '.jpg' || cur === '.jpeg')) return name;
        const stem = dot > 0 ? name.slice(0, dot) : name;
        return stem + (format === 'png' ? '.png' : '.jpg');
    }

    private deriveSaveAsName(source: string): string {
        const dotIdx = source.lastIndexOf('.');
        if (dotIdx <= 0) return source + '-edited';
        return source.slice(0, dotIdx) + '-edited' + source.slice(dotIdx);
    }

    private parentDir(path: string | null): string | null {
        if (path === null || path === '') return null;
        const trimmed = path.replace(/\/+$/, '');
        const idx = trimmed.lastIndexOf('/');
        if (idx <= 0) return '/';
        return trimmed.slice(0, idx);
    }

    private joinPath(parent: string, name: string): string {
        const left  = parent.replace(/\/+$/, '');
        const right = name.replace(/^\/+/, '');
        return `${left}/${right}`;
    }
}
