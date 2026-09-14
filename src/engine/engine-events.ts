/**
 * Normalised event surface for `ImageEditorEngine`.
 *
 * The adapter translates engine-internal events (Toast UI's
 * `objectActivated`, `undoStackChanged`, etc.) into this stable map
 * so the UI shell never imports vendor types.
 */

import type { LayerKind } from '../types/layer.types';

export interface EngineEvents {
    /** Fires after `loadImage()` resolves. Carries the loaded dimensions. */
    readonly imageLoaded: { readonly width: number; readonly height: number };

    /** Any operation that mutates the canvas (filter, crop, rotate, etc.). */
    readonly imageChanged: void;

    /** History stacks updated. Use `canUndo`/`canRedo` for current depth. */
    readonly historyStateChanged: { readonly canUndo: boolean; readonly canRedo: boolean };

    /**
     * Fires whenever the image's transform state changes, from either
     * direct mouse manipulation (corner / rotation handles) or a
     * sidebar tool action (slider drag, flip button). The `source`
     * field tells consumers which path produced the change so that
     * tool components can decide whether to update bound display
     * values without echoing back into the engine.
     */
    readonly imageTransformed: {
        readonly angle:   number;
        readonly scaleX:  number;
        readonly scaleY:  number;
        readonly flipX:   boolean;
        readonly flipY:   boolean;
        readonly left:    number;
        readonly top:     number;
        readonly source: 'mouse' | 'sidebar';
    };

    /** A canvas object was activated (selected). */
    readonly objectActivated: { readonly objectType: string };

    /** No object is currently selected. */
    readonly objectDeactivated: void;

    /**
     * The layer stack changed -- a shape / text layer was added,
     * removed, reordered, or had its visibility / opacity toggled.
     * Carries no payload: consumers re-pull `getLayers()`. (C.1)
     */
    readonly layersChanged: void;

    /**
     * The active (selected) layer changed -- to another layer, or to
     * none. `id` is the engine's stable layer id; `kind` lets the
     * sidebar decide which style panel is relevant. Distinct from
     * `objectActivated`, which predates the layer model and carries
     * the raw fabric type only. (C.1)
     */
    readonly activeObjectChanged: {
        readonly id:   string | null;
        readonly kind: LayerKind | null;
    };

    /**
     * Raw pointer activity in SCENE coordinates (canvas space with the
     * viewport zoom/pan factored out -- the same space `getImageBounds()`
     * and `getShapeGeometry()` report in). The annotation seam for
     * consumers that implement their own draw-by-drag interactions
     * (e.g. the ImageMap region authoring page): `down`->`move`->`up`
     * drives rubber-band shapes, `dblclick` closes polygon paths.
     * `targetLayerId` is the stamped layer under the pointer, or null
     * on empty canvas / when hit-testing is disabled.
     */
    readonly scenePointer: {
        readonly phase: 'down' | 'move' | 'up' | 'dblclick';
        readonly x: number;
        readonly y: number;
        readonly targetLayerId: string | null;
    };
}

export type EngineEventType = keyof EngineEvents;

export type EngineEventHandler<T extends EngineEventType> =
    (data: EngineEvents[T]) => void;
