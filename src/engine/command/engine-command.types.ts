/**
 * Reversible engine operation. Forward op runs once when pushed
 * (the adapter executes it before constructing the command); `undo`
 * runs the reverse, `do` re-runs the forward op for redo.
 */
export interface EngineCommand {
    readonly name: string;
    do(): Promise<void> | void;
    undo(): Promise<void> | void;
}
