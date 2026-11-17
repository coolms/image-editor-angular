import { InjectionToken } from '@angular/core';
import { baseTranslator, type Translator } from '../core/messages';
import type { RailMode } from '../core/tools';

/**
 * The editor's text. A host provides its own translator (the platform's catalogues, say); without one the editor speaks
 * the base catalogue's English (`core/messages.ts`).
 */
export const IMAGE_EDITOR_TRANSLATOR = new InjectionToken<Translator>('IMAGE_EDITOR_TRANSLATOR', {
    providedIn: 'root',
    factory: () => baseTranslator,
});

/** Where the rail's mode is remembered. The admin keeps it in the person's preferences, so it follows them. */
export interface RailModeStore {
    /** The mode last chosen, or null when none was. */
    read(): RailMode | null;
    write(mode: RailMode): void;
}

/** Remembered for this page load only: what a host without preferences gets. */
export function sessionRailModeStore(): RailModeStore {
    let mode: RailMode | null = null;
    return {
        read: () => mode,
        write: next => { mode = next; },
    };
}

export const IMAGE_EDITOR_RAIL_MODE = new InjectionToken<RailModeStore>('IMAGE_EDITOR_RAIL_MODE', {
    providedIn: 'root',
    factory: sessionRailModeStore,
});

/** What a failed load or save says when the host gives no reading of the server's answer. */
export const IMAGE_EDITOR_GENERIC_PROBLEM = 'Something went wrong. Try again.';

/** The sentence for a failed request, from whatever the request threw: the host's reading of the server's answer. */
export type DescribeProblem = (response: unknown) => string;

/**
 * How the editor says a failed load or save. A host provides its own reading (the platform's declared-problem rule,
 * say); without one the editor says {@link IMAGE_EDITOR_GENERIC_PROBLEM}.
 */
export const IMAGE_EDITOR_DESCRIBE_PROBLEM = new InjectionToken<DescribeProblem>('IMAGE_EDITOR_DESCRIBE_PROBLEM', {
    providedIn: 'root',
    factory: () => () => IMAGE_EDITOR_GENERIC_PROBLEM,
});
