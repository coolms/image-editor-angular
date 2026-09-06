/**
 * Wire-shape types for the CDK Dialog host.
 *
 * Discriminated union (`context: 'media' | 'vfs'`) so the host's
 * save flow can route to the correct backend endpoint without the
 * caller having to know which one. Each branch carries exactly the
 * fields that branch needs:
 *
 *   - **Media context** -- the asset is a registered `MediaAsset`,
 *     so save flows through Media's APIs (`POST /media/{id}/replace`
 *     for overwrite, `POST /media/upload` for save-as-new). The
 *     asset's `path` carries the VFS location; we derive the parent
 *     directory from it for the save-as-new target.
 *
 *   - **VFS context** -- the file is a plain VFS file with no
 *     MediaAsset record (e.g., a theme asset, a template image).
 *     Save flows through VFS's binary endpoint
 *     (`POST /vfs/files/binary`). `canWrite` gates the Save button:
 *     read-only files allow Save as (creates a new file in the
 *     parent directory) but not Save (would overwrite the source).
 */

export type CoolmsImageEditorHostData =
    | CoolmsImageEditorMediaContext
    | CoolmsImageEditorVfsContext;

export interface CoolmsImageEditorMediaContext {
    readonly context: 'media';
    readonly asset: {
        /** Maps to `MediaAsset.id`; backend resolves the VFS node from it. */
        readonly uuid:        string;
        /** Source URL the engine loads via `loadImage(url)`. */
        readonly originalUrl: string;
        /** Display label in the dialog header and default save-as filename. */
        readonly filename:    string;
        /** Picks the export format (source MIME wins per the existing contract). */
        readonly mimeType:    string;
        /**
         * Materialised VFS path of the asset (e.g., `/media/uploads/photo.jpg`).
         * The save-as-new flow derives the target directory from this -- the
         * new asset lands in the same collection as the source. Optional
         * because `MediaAssetDto.path` can be null for fresh upload responses;
         * callers set this when they have it (the editor falls back to
         * `/media/uploads` when absent).
         */
        readonly path?:       string | null;
        /** Pre-load dimensions surfaced in the header before the engine reports its own. */
        readonly dimensions:  { readonly width: number; readonly height: number } | null;
    };
    /** BCP-47 locale; held for future locale work, beta.X doesn't read it. */
    readonly locale?: string;
}

export interface CoolmsImageEditorVfsContext {
    readonly context: 'vfs';
    readonly node: {
        /** Absolute VFS path of the file. */
        readonly path:        string;
        /** Caller's effective write permission on the file (mirrors `VfsNodeDto.permissions.write`). */
        readonly canWrite:    boolean;
        /** URL the engine loads via `loadImage(url)`. */
        readonly sourceUrl:   string;
        /** Display label in the dialog header and default save-as filename. */
        readonly filename:    string;
        /** Picks the export format. */
        readonly mimeType:    string;
        /** Parent directory; the save-as-new flow joins `${parentPath}/${newName}`. */
        readonly parentPath:  string;
        /** Optional dimensions; null when not available pre-load. */
        readonly dimensions?: { readonly width: number; readonly height: number } | null;
    };
}

export type CoolmsImageEditorHostResult =
    | { readonly kind: 'cancelled' }
    | {
        readonly kind:       'saved';
        readonly mode:       'overwrite' | 'save_as_new';
        /** Set on the Media context. */
        readonly assetUuid?: string;
        /** Set on the VFS context. */
        readonly vfsPath?:   string;
    };
