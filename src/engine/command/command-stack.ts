import type { EngineCommand } from './engine-command.types';

/**
 * Two-array undo / redo stack for engine operations. The adapter pushes
 * each command after running its forward op; pushing clears the redo
 * stack, mirroring the convention every desktop editor uses (a fresh
 * branch invalidates the previous redo timeline).
 */
export class CommandStack {
    private undoStack: EngineCommand[] = [];
    private redoStack: EngineCommand[] = [];

    push(cmd: EngineCommand): void {
        this.undoStack.push(cmd);
        this.redoStack = [];
    }

    async undo(): Promise<void> {
        const cmd = this.undoStack.pop();
        if (cmd === undefined) return;
        await cmd.undo();
        this.redoStack.push(cmd);
    }

    async redo(): Promise<void> {
        const cmd = this.redoStack.pop();
        if (cmd === undefined) return;
        await cmd.do();
        this.undoStack.push(cmd);
    }

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }

    clearRedo(): void { this.redoStack = []; }

    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }
}
