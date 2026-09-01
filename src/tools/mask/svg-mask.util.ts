/**
 * SVG -> clip-path geometry extraction for custom masks (C.1d).
 *
 * Accepts either a bare SVG path `d` string or a full SVG document
 * (pasted markup or the text of an uploaded `.svg` file) and returns a
 * single combined path `d` string the engine can hand to fabric's
 * `new Path(d)` as a clipPath — or a user-facing error message.
 *
 * Security model: the output is ALWAYS pure path geometry, consumed only
 * by `new Path(d)` and NEVER injected as HTML, so no `<script>`, event
 * handler, or external reference (`<image href>`, `<use href>`) can
 * survive into anything executable — they're simply never read. We also
 * parse with `DOMParser` into a detached `image/svg+xml` document, which
 * neither executes scripts nor fetches external resources. As an
 * explicit up-front signal we still reject markup that carries scripts,
 * `<foreignObject>`, or inline `on*` handlers.
 *
 * Every drawable element (path / rect / circle / ellipse / polygon /
 * polyline) is flattened to path commands and concatenated; everything
 * else is ignored ("paths only"). Per-element `transform` attributes and
 * non-geometry elements are NOT applied — flatten transforms in your
 * source SVG first if a mask looks off. Fabric-free and Angular-free so
 * it stays trivially unit-testable and keeps the engine firewall intact.
 *
 * This file imports nothing — it relies only on browser DOM APIs.
 */

/** ~200 KB — generous for "a small SVG file", a guard against pathological input. */
const MAX_INPUT_LENGTH = 200_000;

/**
 * Characters legal in SVG path `d` data: the command letters, digits,
 * sign / decimal / exponent, and separators. Anything outside this set
 * (notably `<`, `>`, `(`, `)`, quotes) is rejected — a defensive second
 * gate on top of "we only ever feed this to `new Path`".
 */
const PATH_D_CHARS = /^[\sMmLlHhVvCcSsQqTtAaZz0-9eE.,+-]+$/;

/** A usable path must contain at least one move command. */
const HAS_MOVE = /[Mm]/;

export type SvgMaskExtraction =
    | { readonly ok: true;  readonly d: string }
    | { readonly ok: false; readonly error: string };

/** Narrowing guard for the error arm of {@link extractSvgMaskPath}. */
export function isSvgMaskError(r: SvgMaskExtraction): r is { ok: false; error: string } {
    return !r.ok;
}

/**
 * Extract sanitised combined path `d` data from pasted path / SVG input.
 */
export function extractSvgMaskPath(input: string): SvgMaskExtraction {
    const raw = input.trim();
    if (raw === '') {
        return { ok: false, error:'Paste SVG path data or an SVG file, or choose a file.' };
    }
    if (raw.length > MAX_INPUT_LENGTH) {
        return { ok: false, error:'SVG is too large (max ~200 KB).' };
    }

    // Bare path data (no markup) — validate and use directly.
    if (!raw.includes('<')) {
        if (!HAS_MOVE.test(raw) || !PATH_D_CHARS.test(raw)) {
            return { ok: false, error:'Not valid path data (expected something like "M0 0 L10 10 Z").' };
        }
        return { ok: true, d:normalise(raw) };
    }

    // Full SVG markup — reject obviously unsafe content up front for a
    // clear signal (the geometry-only extraction below is already safe).
    if (/<\s*script\b/i.test(raw) || /<\s*foreignObject\b/i.test(raw) || /\son[a-z]+\s*=/i.test(raw)) {
        return { ok: false, error:'SVG contains scripts or event handlers, which are not allowed.' };
    }

    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
    if (doc.querySelector('parsererror') !== null) {
        return { ok: false, error:'The SVG markup is malformed.' };
    }

    const segments: string[] = [];
    doc.querySelectorAll('path, rect, circle, ellipse, polygon, polyline').forEach((el) => {
        const d = elementToPathData(el);
        if (d !== null) segments.push(d);
    });

    if (segments.length === 0) {
        return { ok: false, error:'No drawable shapes found (paths, rects, circles, ellipses or polygons only).' };
    }

    const combined = normalise(segments.join(' '));
    if (!HAS_MOVE.test(combined) || !PATH_D_CHARS.test(combined)) {
        return { ok: false, error:'The SVG shapes could not be converted to path data.' };
    }
    return { ok: true, d:combined };
}

/** Collapse runs of whitespace so the stored `d` round-trips compactly. */
function normalise(d: string): string {
    return d.replace(/\s+/g, ' ').trim();
}

/**
 * Convert a single SVG geometry element to path `d` data. Returns `null`
 * for unsupported / zero-area elements (which are skipped). Only the
 * absolute-coordinate primitives are handled; the bounding box is
 * re-scaled to the clip box in the engine, so the source coordinate
 * space / viewBox is irrelevant.
 */
function elementToPathData(el: Element): string | null {
    const num = (name: string): number => {
        const v = parseFloat(el.getAttribute(name) ?? '');
        return Number.isFinite(v) ? v : 0;
    };

    switch (el.tagName.toLowerCase()) {
        case 'path': {
            const d = (el.getAttribute('d') ?? '').trim();
            return d !== '' && PATH_D_CHARS.test(d) ? d : null;
        }
        case 'rect': {
            const x = num('x'), y = num('y'), w = num('width'), h = num('height');
            if (w <= 0 || h <= 0) return null;
            return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
        }
        case 'circle': {
            const cx = num('cx'), cy = num('cy'), r = num('r');
            if (r <= 0) return null;
            // Two semicircular arcs back to the start (a full circle).
            return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        }
        case 'ellipse': {
            const cx = num('cx'), cy = num('cy'), rx = num('rx'), ry = num('ry');
            if (rx <= 0 || ry <= 0) return null;
            return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
        }
        case 'polygon':
        case 'polyline': {
            const pts = parsePoints(el.getAttribute('points') ?? '');
            if (pts.length < 2) return null;
            // Close both (a polyline used as a mask is treated as filled).
            return `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')} Z`;
        }
        default:
            return null;
    }
}

/** Parse an SVG `points` list into `"x y"` coordinate pairs. */
function parsePoints(raw: string): string[] {
    const nums = raw.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    const pairs: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        pairs.push(`${nums[i]} ${nums[i + 1]}`);
    }
    return pairs;
}
