import { describe, expect, it } from 'vitest';
import { LatestOnly } from './latest-only.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LatestOnly', () => {
  it('passes a result through when nothing changed', async () => {
    const gate = new LatestOnly('channel:a');
    expect(await gate.run(async () => 'x')).toEqual({ ok: true, value: 'x' });
    expect(await gate.run(async () => Promise.reject(new Error('no')))).toMatchObject({ ok: false });
  });

  it('drops a read that comes back after the scope switched', async () => {
    const gate = new LatestOnly('channel:a');
    const read = deferred<string>();
    const pending = gate.run(() => read.promise);
    gate.setKey('user:a');
    read.resolve('channel memory');
    expect(await pending).toBeNull();
  });

  it('drops a failed save from the previous scope too', async () => {
    const gate = new LatestOnly('channel:a');
    const write = deferred<string>();
    const pending = gate.run(() => write.promise);
    gate.setKey('channel:b');
    write.reject(new Error('conflict'));
    expect(await pending).toBeNull();
  });

  it('keeps only the newest request when switching away and back', async () => {
    const gate = new LatestOnly('channel:a');
    const first = deferred<string>();
    const firstRun = gate.run(() => first.promise);
    gate.setKey('user:a');
    gate.setKey('channel:a');
    const second = deferred<string>();
    const secondRun = gate.run(() => second.promise);
    second.resolve('new');
    first.resolve('old');
    expect(await firstRun).toBeNull();
    expect(await secondRun).toEqual({ ok: true, value: 'new' });
  });
});
