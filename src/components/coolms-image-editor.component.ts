import {
    AfterViewInit, ChangeDetectionStrategy, Component, OnDestroy, ViewChild,
    inject, input, output,
} from '@angular/core';
import { TopToolbarComponent }    from './top-toolbar/top-toolbar.component';
import { CanvasMountComponent }   from './canvas-mount/canvas-mount.component';
import { RightSidebarComponent }  from './right-sidebar/right-sidebar.component';
import { ImageEditorStateService } from '../services/image-editor-state.service';
import { ToolRegistryService }    from '../tools/tool-registry.service';
import { CropToolComponent }      from '../tools/crop/crop-tool.component';
import { RotateToolComponent }    from '../tools/rotate/rotate-tool.component';
import { FlipToolComponent }      from '../tools/flip/flip-tool.component';
import { ResizeToolComponent }    from '../tools/resize/resize-tool.component';
import { MaskToolComponent }      from '../tools/mask/mask-tool.component';
import { SliderFilterComponent }  from '../tools/filter/slider-filter.component';
import { ToggleFilterComponent }  from '../tools/filter/toggle-filter.component';
import { ShapeToolComponent }     from '../tools/shape/shape-tool.component';
import { TextToolComponent }      from '../tools/text/text-tool.component';
import { LayersPanelComponent }   from '../tools/layers/layers-panel.component';
import type {
    SliderFilterConfig, ToggleFilterConfig,
} from '../tools/filter/filter.types';
import type { ImageEditorEngine }  from '../engine/image-editor-engine.interface';

/**
 * Three-pane shell for the CoolMS image editor.
 *
 * Composition: top toolbar (action commands + size badge), canvas
 * mount (centre / left, fills remaining space), right sidebar (tool
 * picker placeholder, 320 px). The footer (Save / Save as / Cancel)
 * lives in the host component so the shell can later be embedded in
 * non-dialog contexts (inline editing, side panels) where the save
 * flow looks different.
 *
 * The shell owns engine lifecycle through `ImageEditorStateService`,
 * which is provided locally so each shell instance has its own state.
 * `engineReady` fires once the image is loaded so the host can wire up
 * its save action against a known-good engine handle.
 *
 * Ordering note on `ngAfterViewInit`: the canvas-mount child uses
 * `static: true` for its container ViewChild, so by the time this
 * component's `ngAfterViewInit` runs the inner `<div #container>`
 * exists. The engine adapter is created against that element and the
 * image is loaded before `engineReady` emits — consumers never see
 * an unloaded engine.
 */
@Component({
    selector: 'coolms-image-editor',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TopToolbarComponent, CanvasMountComponent, RightSidebarComponent],
    providers: [ImageEditorStateService],
    templateUrl: './coolms-image-editor.component.html',
    styleUrls: ['./coolms-image-editor.component.scss'],
})
export class CoolmsImageEditorComponent implements AfterViewInit, OnDestroy {
    sourceUrl      = input.required<string>();
    sourceFilename = input.required<string>();

    /** Fires after the engine is created and the initial image has loaded. */
    readonly engineReady = output<ImageEditorEngine>();
    /**
     * Fires if engine creation or initial load throws.
     *
     * `failed`, not `error`: an output named after a native DOM event is
     * ambiguous in a template -- `(error)` could bind either, and which one
     * wins is not visible to whoever reads the template.
     */
    readonly failed      = output<Error>();

    protected readonly state = inject(ImageEditorStateService);

    @ViewChild(CanvasMountComponent, { static: true })
    private readonly canvasMount!: CanvasMountComponent;

    /**
     * Tracks teardown so an engine that finishes loading after the host
     * dialog has already been dismissed gets cleaned up promptly. Without
     * this guard a slow `loadImage` could leave an orphan canvas in the
     * DOM after `ngOnDestroy`.
     */
    private destroyed = false;

    constructor() {
        // Register the beta.4a transform tools. The registry is
        // `providedIn: 'root'`, so registering here is idempotent across
        // multiple shell instances — re-registering an id replaces the
        // existing entry, and metadata is identical between instances.
        const registry = inject(ToolRegistryService);
        registry.register({
            id:        'crop',
            label:     'Crop',
            icon:      'bi-crop',
            category:  'transform',
            component: CropToolComponent,
        });
        registry.register({
            id:        'rotate',
            label:     'Rotate',
            icon:      'bi-arrow-clockwise',
            category:  'transform',
            component: RotateToolComponent,
        });
        registry.register({
            id:        'flip',
            label:     'Flip',
            icon:      'bi-symmetry-horizontal',
            category:  'transform',
            component: FlipToolComponent,
        });
        // beta.4c: Resize joins the Transform group. Sits last because
        // it changes the canvas baseline, which crop/rotate/flip
        // operations are usually run against rather than after.
        registry.register({
            id:        'resize',
            label:     'Resize',
            icon:      'bi-aspect-ratio',
            category:  'transform',
            component: ResizeToolComponent,
        });
        // C.1c: Mask clips the selected layer (or the base image) to a
        // shape. Sits last in Transform — it's applied over whatever
        // crop / rotate / resize produced.
        registry.register({
            id:        'mask',
            label:     'Mask',
            icon:      'bi-mask',
            category:  'transform',
            component: MaskToolComponent,
        });

        // C.1: Insert group (shapes + text as annotation layers) and a
        // Layers panel for the object stack.
        registry.register({
            id:        'shape',
            label:     'Shapes',
            icon:      'bi-shapes',
            category:  'insert',
            component: ShapeToolComponent,
        });
        registry.register({
            id:        'text',
            label:     'Text',
            icon:      'bi-fonts',
            category:  'insert',
            component: TextToolComponent,
        });
        registry.register({
            id:        'layers',
            label:     'Layers',
            icon:      'bi-stack',
            category:  'layers',
            component: LayersPanelComponent,
        });

        // beta.4b: Filter tools. The shared SliderFilterComponent and
        // ToggleFilterComponent classes back every filter — only the
        // `config` input differs. ToolMetadata's `inputs` map carries
        // the per-filter config, which the right-sidebar pipes
        // through `NgComponentOutlet`'s `inputs` binding.
        const sliderFilters: SliderFilterConfig[] = [
            { type: 'slider', filterName: 'brightness', label: 'Brightness',
              icon: 'bi-sun', min: -1, max: 1, step: 0.05,
              default: 0, paramKey: 'brightness' },
            { type: 'slider', filterName: 'contrast', label: 'Contrast',
              icon: 'bi-circle-half', min: -1, max: 1, step: 0.05,
              default: 0, paramKey: 'contrast' },
            { type: 'slider', filterName: 'saturation', label: 'Saturation',
              icon: 'bi-droplet-half', min: -1, max: 1, step: 0.05,
              default: 0, paramKey: 'saturation' },
            { type: 'slider', filterName: 'blur', label: 'Blur',
              icon: 'bi-cloud', min: 0, max: 1, step: 0.02,
              default: 0, paramKey: 'blur' },
        ];
        for (const config of sliderFilters) {
            registry.register({
                id:        `filter-${config.filterName}`,
                label:     config.label,
                icon:      config.icon,
                category:  'filter',
                component: SliderFilterComponent,
                inputs:    { config },
            });
        }

        const toggleFilters: ToggleFilterConfig[] = [
            { type: 'toggle', filterName: 'sepia',     label: 'Sepia',     icon: 'bi-palette'      },
            { type: 'toggle', filterName: 'grayscale', label: 'Grayscale', icon: 'bi-palette-fill' },
            { type: 'toggle', filterName: 'sharpen',   label: 'Sharpen',   icon: 'bi-stars'        },
        ];
        for (const config of toggleFilters) {
            registry.register({
                id:        `filter-${config.filterName}`,
                label:     config.label,
                icon:      config.icon,
                category:  'filter',
                component: ToggleFilterComponent,
                inputs:    { config },
            });
        }
    }

    /**
     * Public escape hatch the host calls before `engine.export()` to
     * make sure no tool is mid-edit (e.g., user forgot to Apply a
     * crop). Setting `activeTool` to `null` destroys the properties
     * component, whose `ngOnDestroy` runs the tool's deactivation
     * (e.g., `exitCropMode()`) — so the export captures clean canvas
     * pixels with no overlay.
     *
     * The adapter's `exportDataUrl()` also defensively calls
     * `stopDrawingMode()`, but doing it here too makes the
     * higher-level intent obvious in the host's save flow.
     */
    deactivateActiveTool(): void {
        this.state.setActiveTool(null);
    }

    /**
     * Public hook the host calls after an intentional dialog size
     * change (fullscreen toggle). Delegates to the canvas mount which
     * re-syncs the fabric canvas dimensions, recalculates fit zoom,
     * and re-applies it so the image stays centred. The
     * ResizeObserver inside canvas-mount stays conservative for
     * casual window resizes (preserves manual zoom).
     */
    refit(): void {
        this.canvasMount.refit();
    }

    async ngAfterViewInit(): Promise<void> {
        const container = this.canvasMount.getContainerElement();

        try {
            await this.state.initializeEngine(
                container,
                this.sourceUrl(),
                this.sourceFilename(),
            );

            if (this.destroyed) {
                this.state.destroyEngine();
                return;
            }

            const engine = this.state.engine();
            if (engine !== null) {
                this.engineReady.emit(engine);
            }
        } catch (err) {
            this.failed.emit(err instanceof Error ? err : new Error(String(err)));
        }
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.state.destroyEngine();
    }
}
