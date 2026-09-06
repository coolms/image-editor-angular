import {
    ChangeDetectionStrategy, Component, ElementRef, HostBinding, HostListener,
    NgZone, OnDestroy, OnInit, ViewChild, effect, inject,
} from '@angular/core';
import { ImageEditorStateService } from '../../services/image-editor-state.service';

/**
 * Canvas container. The shell mounts the engine into the inner
 * `<div #container>` element via `getContainerElement()`; that
 * element is then owned by Toast UI's fabric.Canvas instance for the
 * lifetime of the editor.
 *
 * Three responsibilities live here:
 *
 * 1. **Loading / error overlays** -- surface the lifecycle states
 *    the state service publishes through `state.state()`.
 *
 * 2. **Fit-to-viewport zoom** -- once the engine emits `imageLoaded`
 *    (visible through `state.isReady()`), measure the container and
 *    apply the engine's calculated fit zoom. A `ResizeObserver`
 *    keeps the cached fit value fresh on container resize without
 *    yanking the user out of a manually-set zoom; the next Reset /
 *    "%" click picks up the updated value.
 *
 * 3. **Hand-tool pan** -- when `state.handToolActive()` is true,
 *    mouse-down + drag on the host element pans the engine viewport
 *    via `engine.pan(dx, dy)`. mousemove / mouseup are bound to
 *    `document` so a drag that escapes the host's bounds still
 *    completes cleanly.
 */
@Component({
    selector: 'coolms-image-editor-canvas-mount',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './canvas-mount.component.html',
    styleUrls: ['./canvas-mount.component.scss'],
})
export class CanvasMountComponent implements OnInit, OnDestroy {
    protected readonly state = inject(ImageEditorStateService);
    private readonly ngZone  = inject(NgZone);

    @ViewChild('container', { static: true })
    private readonly containerRef!: ElementRef<HTMLDivElement>;

    /** Class-binding hooks for the cursor-state SCSS. */
    @HostBinding('class.canvas-mount-host--hand')
    protected get handCursor(): boolean { return this.state.handToolActive(); }

    @HostBinding('class.canvas-mount-host--panning')
    protected get panningCursor(): boolean { return this.isPanning; }

    private isPanning  = false;
    private panStartX  = 0;
    private panStartY  = 0;
    private resizeObs?: ResizeObserver;
    /**
     * True after the first fit pass has run. Used to gate the
     * ResizeObserver below so it doesn't try to recompute fit before
     * any image has loaded.
     */
    private fitApplied = false;

    constructor() {
        // Apply fit-to-viewport zoom whenever the loaded image's
        // dimensions change. Fires on:
        //   - initial load (canvasSize transitions from null to size)
        //   - crop / resize replacement (adapter re-emits imageLoaded
        //     and the state service updates canvasSize accordingly)
        // ResizeObserver below does NOT change canvasSize, so a
        // container-only resize uses `recalculateFitZoom` (cache
        // only, doesn't yank the user's manual zoom).
        effect(() => {
            const size = this.state.canvasSize();
            if (this.state.isReady() && size !== null) {
                const el = this.containerRef.nativeElement;
                const viewport = {
                    width:  el.clientWidth,
                    height: el.clientHeight,
                };
                this.state.engine()?.setCanvasDimensions(viewport);
                this.state.applyFitZoom(viewport);
                this.fitApplied = true;
            }
        });

        // Drive fabric's cursor and selection state from the Hand
        // tool toggle. fabric owns these properties internally --
        // CSS `cursor: grab` on the host element doesn't reach the
        // canvas, and without disabling `selection` a drag on empty
        // canvas draws fabric's group-select rectangle instead of
        // panning. Re-runs whenever handToolActive flips, and also
        // when the engine first becomes available (`engine()` is a
        // tracked dependency).
        effect(() => {
            const engine     = this.state.engine();
            const handActive = this.state.handToolActive();
            if (engine === null) return;
            if (handActive) {
                engine.setCursor('grab');
                engine.setSelectionEnabled(false);
            } else {
                engine.setCursor('default');
                engine.setSelectionEnabled(true);
            }
        });
    }

    ngOnInit(): void {
        if (typeof ResizeObserver === 'undefined') return;
        // Run outside Angular's zone so a continuous drag-resize
        // doesn't fire a change-detection cycle on every frame; we
        // explicitly re-enter the zone when calling the state
        // service so the fitZoom signal updates downstream consumers.
        this.ngZone.runOutsideAngular(() => {
            this.resizeObs = new ResizeObserver(() => {
                if (!this.fitApplied) return;
                const el = this.containerRef.nativeElement;
                const viewport = {
                    width:  el.clientWidth,
                    height: el.clientHeight,
                };
                // Fabric adapter owns canvas dimensions; resize the
                // backstore so viewport zoom stays the only scale knob.
                // Toast UI adapter's setCanvasDimensions is a no-op,
                // so this call is safe to make unconditionally.
                this.state.engine()?.setCanvasDimensions(viewport);
                this.ngZone.run(() => {
                    this.state.recalculateFitZoom(viewport);
                });
            });
            this.resizeObs.observe(this.containerRef.nativeElement);
        });
    }

    ngOnDestroy(): void {
        this.resizeObs?.disconnect();
    }

    getContainerElement(): HTMLElement {
        return this.containerRef.nativeElement;
    }

    /**
     * Force a re-fit pass after an intentional container-size change
     * (e.g. dialog host's fullscreen toggle). Different from the
     * ResizeObserver path which preserves the user's manual zoom on
     * casual resizes -- refit() unconditionally re-syncs canvas
     * dimensions and resets the viewport so the image stays centred
     * in the new viewport.
     *
     * Order matters: setCanvasDimensions resizes the backstore and
     * re-centers the image OBJECT to (canvas.w/2, canvas.h/2);
     * resetZoom collapses the viewport transform to identity (no
     * leftover pan from before the size change); then setZoom uses
     * `zoomToPoint(canvas_center, fit)` which keeps the (now
     * canvas-centred) image at the visible centre.
     */
    refit(): void {
        const el = this.containerRef.nativeElement;
        const viewport = { width: el.clientWidth, height: el.clientHeight };
        if (viewport.width === 0 || viewport.height === 0) return;
        const engine = this.state.engine();
        if (engine === null) return;
        engine.setCanvasDimensions(viewport);
        engine.resetZoom();
        this.state.applyFitZoom(viewport);
    }

    @HostListener('mousedown', ['$event'])
    onMouseDown(event: MouseEvent): void {
        if (!this.state.handToolActive()) return;
        const engine = this.state.engine();
        if (engine === null) return;
        // Swap to the closed-hand "active drag" cursor for the
        // duration of the gesture; reverts to grab on mouseup
        // (still in Hand mode) or default (Hand deactivated).
        engine.setCursor('grabbing');
        this.isPanning = true;
        this.panStartX = event.clientX;
        this.panStartY = event.clientY;
        // Suppress text-selection drag and the engine's own
        // mouse-down handlers; we own this gesture.
        event.preventDefault();
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove(event: MouseEvent): void {
        if (!this.isPanning) return;
        const engine = this.state.engine();
        if (engine === null) return;

        const dx = event.clientX - this.panStartX;
        const dy = event.clientY - this.panStartY;
        // relativePan accumulates from the previous viewport
        // transform, so we feed it the per-frame delta and reset
        // the start position for the next frame.
        engine.pan(dx, dy);
        this.panStartX = event.clientX;
        this.panStartY = event.clientY;
    }

    @HostListener('document:mouseup')
    onMouseUp(): void {
        if (!this.isPanning) return;
        this.isPanning = false;
        const engine = this.state.engine();
        if (engine === null) return;
        // Back to grab cursor while Hand is still active. The
        // separate handToolActive effect covers the case where the
        // user toggles Hand off mid-gesture (rare but possible via
        // keyboard) -- it'll reset to default on the next tick.
        if (this.state.handToolActive()) {
            engine.setCursor('grab');
        }
    }

    /**
     * Ctrl/Cmd + wheel zooms the viewport, matching the convention
     * used by Photoshop, Affinity, Figma, and every other desktop
     * image editor. Plain wheel without the modifier still scrolls
     * the page (the parent dialog isn't scrollable today, but the
     * editor may live inline elsewhere later, and stealing the wheel
     * unconditionally would surprise users in those embeddings).
     *
     * Mac trackpad pinch arrives as a wheel event with `ctrlKey:
     * true` set by the browser, so the same handler covers both
     * gestures with no extra code.
     *
     * Step factor of 1.1 per tick gives a smooth ~10% step that
     * matches what most editors use. The state service clamps to
     * [0.05, 10] so we don't need to clamp here. Anchor stays at
     * canvas centre (engine.setZoom centres on the backstore
     * midpoint); zoom-to-cursor is a known follow-up.
     */
    @HostListener('wheel', ['$event'])
    onWheel(event: WheelEvent): void {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const factor  = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        const target  = this.state.currentZoom() * factor;
        this.state.setZoom(target);
    }
}
