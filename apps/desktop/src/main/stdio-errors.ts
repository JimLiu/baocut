import type { EventEmitter } from 'node:events';

/** The launching terminal may close while the desktop app is still running. */
export function installStdioErrorGuards(streams: readonly EventEmitter[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') throw error;
    });
  }
}
