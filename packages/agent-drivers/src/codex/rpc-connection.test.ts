import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { CodexRpcConnection } from './rpc-connection.ts';

// Real pipe lifecycle with synthetic Node children; no Codex, account or network.
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
});

function start(script: string) {
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const conn = new CodexRpcConnection(child, silentLogger);
  const ready = new Promise<void>((resolve) => conn.onNotification((method) => { if (method === 'ready') resolve(); }));
  return { child, conn, ready };
}

const readyFrame = "process.stdout.write(JSON.stringify({ method: 'ready' }) + '\\n');";

describe('CodexRpcConnection pipe failures', () => {
  it('rejects every pending request on a broken pipe and reaps a child that stays alive', async () => {
    const { child, conn, ready } = start(`
      require('node:fs').closeSync(0);
      ${readyFrame}
      setInterval(() => {}, 1000);
    `);
    // Observe the OS error so the unfixed baseline fails by assertion, not an
    // uncaught event. The connection must independently settle its requests.
    const errors: Error[] = [];
    child.stdin.on('error', (error) => errors.push(error));
    const exits: Array<Error | null> = [];
    conn.onExit((error) => exits.push(error));
    await ready;
    const requests = [
      conn.request('first', {}, 1000).catch((error: unknown) => error),
      conn.request('second', {}, 1000).catch((error: unknown) => error),
    ];
    const results = await Promise.all(requests);
    expect(results).toEqual([expect.objectContaining({ code: 'EPIPE' }), expect.objectContaining({ code: 'EPIPE' })]);
    expect(errors).toHaveLength(1);
    expect(exits).toEqual([errors[0]]);
    const closing = conn.close();
    expect(conn.close()).toBe(closing);
    await closing;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(exits).toHaveLength(1);
    await expect(conn.request('after-close', {})).rejects.toThrow();
  });

  it('still exchanges replies and closes a healthy child with a pending request', async () => {
    const { child, conn, ready } = start(`
      const lines = require('node:readline').createInterface({ input: process.stdin });
      lines.on('line', (line) => {
        const msg = JSON.parse(line);
        if (msg.method === 'echo') process.stdout.write(JSON.stringify({ id: msg.id, result: msg.params }) + '\\n');
      });
      lines.on('close', () => process.exit(0));
      ${readyFrame}
    `);
    await ready;
    await expect(conn.request('echo', { value: 'hello' })).resolves.toEqual({ value: 'hello' });
    const pending = conn.request('hang', {}, null).catch((error: unknown) => error);
    await conn.close();
    expect(await pending).toBeInstanceOf(Error);
    expect(child.exitCode).toBe(0);
  });
});
