import { Console } from 'node:console';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { installStdioErrorGuards } from './stdio-errors.ts';

describe('desktop diagnostic streams', () => {
  it('keeps renderer diagnostics from crashing the app after the terminal pipe closes', async () => {
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
      },
    });
    installStdioErrorGuards([stderr]);
    const emitted = once(stderr, 'error');
    const console = new Console({ stdout: new PassThrough(), stderr, ignoreErrors: false });
    console.error('[renderer:warning] test');
    expect((await emitted)[0].code).toBe('EPIPE');
  });

  it('handles both inherited output streams', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    installStdioErrorGuards([stdout, stderr]);
    for (const stream of [stdout, stderr]) {
      expect(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }))).not.toThrow();
    }
  });

  it('does not hide unrelated stream failures', () => {
    const stream = new EventEmitter();
    installStdioErrorGuards([stream]);
    const error = Object.assign(new Error('disk failure'), { code: 'EIO' });
    expect(() => stream.emit('error', error)).toThrow(error);
  });
});
