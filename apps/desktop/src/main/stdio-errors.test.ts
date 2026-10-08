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

  it.each(['EPIPE', 'EIO'])('handles both inherited output streams after the terminal goes away (%s)', (code) => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    installStdioErrorGuards([stdout, stderr]);
    for (const stream of [stdout, stderr]) {
      expect(() => stream.emit('error', Object.assign(new Error('closed'), { code }))).not.toThrow();
    }
  });

  it('keeps diagnostics from crashing the app after the terminal closes (EIO)', async () => {
    // Like a tty stdout/stderr after the terminal is closed: every write fails, and the stream is not destroyed by it.
    let writes = 0;
    const stderr = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, callback) {
        writes += 1;
        callback(Object.assign(new Error('write EIO'), { code: 'EIO' }));
      },
    });
    installStdioErrorGuards([stderr]);
    const emitted = once(stderr, 'error');
    const console = new Console({ stdout: new PassThrough(), stderr, ignoreErrors: false });
    console.error('[renderer] gone');
    expect((await emitted)[0].code).toBe('EIO');
    expect(writes).toBe(1);
  });

  it('does not hide unrelated stream failures', () => {
    const stream = new EventEmitter();
    installStdioErrorGuards([stream]);
    const error = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    expect(() => stream.emit('error', error)).toThrow(error);
  });
});
