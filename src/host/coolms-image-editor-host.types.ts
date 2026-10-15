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
        /** Source URL the engine loads via `loadImage(url)` when no `sourceUrl` is given. */
        readonly originalUrl: string;
        /**
         * Where the asset's own bytes are read with their version (the response's ETag), as for a file: the version a
         * replace names as If-Match is the version of the pixels opened, from that one read (2026-10-15). Without it
         * the image is shown from `originalUrl`, which names no version, and Save is off: the edits go to a new image.
         */
        readonly sourceUrl?:  string;
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
        /** The file's node id: the host's file watch follows it to say when it changes or goes elsewhere. */
        readonly id?:         string;
        /** Caller's effective write permission on the file (mirrors `VfsNodeDto.permissions.write`). */
        readonly canWrite:    boolean;
        /**
         * Offered when `canWrite` is false: what Save does INSTEAD of being
         * dead (the elevation client requirement, point 2). The caller asks
         * the server for elevation and resolves true when the session has
         * it; the host then treats the file as writable and saves. Absent,
         * Save is disabled as before. The host decides nothing itself.
         */
        readonly requestWrite?: () => Promise<boolean>;
        /**
         * Where the file's own bytes are read, and with them their version (the response's ETag): the version an
         * overwrite names as If-Match is the version of the pixels the editor opened, from that one read -- a file
         * changed after it was listed is edited as it is now, and a copy served from a cache carries its own older
         * version, so its save is refused (412), never written over the newer file (2026-10-15). A read that names no
         * version leaves Save off: the edits can go to a new image only.
         */
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
