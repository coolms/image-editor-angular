import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * HTTP client for the image-editor save flows.
 *
 * Three endpoints, one per save scenario. The host component picks
 * which one to call based on its own discriminated context (media
 * vs vfs); the service stays a thin wrapper around `HttpClient`.
 *
 *   `replaceMediaAsset`   -> `POST /api/v1/media/{id}/replace`
 *                           (Phase 1A; Media-owned, multipart, replaces
 *                            asset bytes in place, triggers thumbnail
 *                            regeneration).
 *
 *   `writeVfsFile`        -> `POST /api/v1/vfs/files/binary`
 *                           (Phase 1B; VFS-owned, multipart, write or
 *                            replace at an absolute path; explicit
 *                            `overwrite=true` is required to clobber
 *                            an existing file). Also backs media "Save as"
 *                            — a new file under `/media/{collection}/` is
 *                            auto-promoted to a managed asset (the old
 *                            `/api/v1/media/upload` route was removed, #87).
 *
 * The legacy `/api/v1/image-editor/edit` endpoint is no longer
 * called from the frontend. It remains registered server-side and is
 * scheduled for deprecation in Phase 1D.
 */
@Injectable({ providedIn: 'root' })
export class ImageEditorHttpService {
    private readonly http = inject(HttpClient);

    /**
     * Overwrite an existing media asset's bytes. Same VFS path,
     * same MediaAsset id, fresh content. Backend dispatches
     * thumbnail regeneration after the write lands.
     */
    async replaceMediaAsset(params: {
        readonly blob:      Blob;
        readonly assetUuid: string;
        readonly filename:  string;
    }): Promise<MediaSaveResponse> {
        const form = new FormData();
        form.append('file', params.blob, params.filename);

        return firstValueFrom(
            this.http.post<MediaSaveResponse>(
                `/api/v1/media/${params.assetUuid}/replace`,
                form,
            ),
        );
    }

    /**
     * Write or replace a binary VFS file. `overwrite=true` is
     * required to clobber an existing file (the backend returns
     * 409 Conflict otherwise — Phase 1B safety opt-in).
     */
    async writeVfsFile(params: {
        readonly blob:      Blob;
        readonly path:      string;
        readonly overwrite: boolean;
        readonly filename:  string;
    }): Promise<VfsSaveResponse> {
        const form = new FormData();
        form.append('file', params.blob, params.filename);
        form.append('path', params.path);
        form.append('overwrite', params.overwrite ? '1' : '0');

        return firstValueFrom(
            this.http.post<VfsSaveResponse>('/api/v1/vfs/files/binary', form),
        );
    }
}

/** Subset of `MediaAssetResource` the host needs after a save. */
export interface MediaSaveResponse {
    readonly id?:               string;
    readonly mimeType?:         string;
    readonly originalFilename?: string;
    /** Anything else API Platform returns; the host only reads `id`. */
    readonly [key: string]: unknown;
}

/** Subset of `NodeResource` the host needs after a VFS save. */
export interface VfsSaveResponse {
    readonly id?:   string;
    readonly path?: string;
    readonly [key: string]: unknown;
}
