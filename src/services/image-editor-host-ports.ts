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
