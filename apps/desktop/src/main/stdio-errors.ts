import type { EventEmitter } from 'node:events';

/**
 * Write errors that mean the launching terminal is gone: EPIPE when the pipe reader closed, EIO when the terminal itself was
 * closed (macOS / Linux). The desktop app keeps running; its diagnostics just have nowhere to go.
 */
const DETACHED_OUTPUT_CODES = new Set(['EPIPE', 'EIO']);

/**
 * The launching terminal may close while the desktop app is still running. Node reports a failed stdio write as an 'error'
 * event on the stream, and every later write fails again; unhandled, each one is an uncaught exception, which Electron shows
 * as a modal error box that blocks the main process (so the app can no longer quit).
 */
export function installStdioErrorGuards(streams: readonly EventEmitter[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (!DETACHED_OUTPUT_CODES.has(error.code ?? '')) throw error;
    });
  }
}
