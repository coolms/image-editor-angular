/**
 * @coolms/image-editor — public surface.
 *
 * Consumers (UI shells, smoke tests, future tools) import from
 * `@coolms/image-editor` only. The barrel keeps the internal file
 * layout reorganisable without breaking downstream imports.
 *
 * Phase β.3 surface: engine + types + shell components + CDK Dialog
 * host. Tools land iteratively in β.4.
 */

// Engine contract + reference adapter
export type { ImageEditorEngine } from './engine/image-editor-engine.interface';
export { FabricEngineAdapter } from './engine/fabric-engine.adapter';

// Event surface
export type {
    EngineEvents,
    EngineEventType,
    EngineEventHandler,
} from './engine/engine-events';

// Geometry primitives
export type { Point, Size, Rect, Bounds } from './types/geometry.types';

// Annotation-authoring seams (geometry over the image, e.g. ImageMap regions)
export type { ShapeGeometry, AnnotationShapeOptions } from './types/layer.types';

// Filter contract
export type { FilterName, FilterParams } from './types/filter.types';

// Engine construction options
export type { EngineOptions } from './types/engine-options.types';

// Shell components (β.3)
export { CoolmsImageEditorComponent } from './components/coolms-image-editor.component';
export { ImageEditorStateService, type EditorState } from './services/image-editor-state.service';

// CDK Dialog host (β.3)
export { CoolmsImageEditorHostComponent } from './host/coolms-image-editor-host.component';
export type {
    CoolmsImageEditorHostData,
    CoolmsImageEditorHostResult,
} from './host/coolms-image-editor-host.types';
