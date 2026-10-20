import path from 'node:path';
import os from 'node:os';
import { resolveElectronBinary } from '@baocut/code-runtime';
import { describe, expect, it } from 'vitest';
import { probeCompositionHost, probeNativeCommand } from './self-check.ts';

describe('probeNativeCommand', () => {
  it('uses the per-worker startup budget while retaining a bounded timeout', async () => {
    const spec = {
      args: ['-e', 'process.stdin.resume(); setTimeout(() => console.log(JSON.stringify({result: true})), 300)'],
      request: { id: 1 },
      accept: (reply: unknown) => (reply as { result?: boolean }).result === true,
    };
    const short = await probeNativeCommand(process.execPath, { ...spec, timeoutMs: 50 });
    expect(short.ok).toBe(false);
    expect(short.detail).toContain('timed out (50 ms)');
    const long = await probeNativeCommand(process.execPath, { ...spec, timeoutMs: 5_000 });
    expect(long.ok).toBe(true);
  });
});

describe('probeCompositionHost', () => {
  it.skipIf(!resolveElectronBinary())('有 Electron 时离屏宿主起得来、等到 ready', { timeout: 60_000 }, async () => {
    const result = await probeCompositionHost();
    expect(result.detail).toMatch(/^ready in \d+ ms$/);
    expect(result.ok).toBe(true);
  });

  it('Electron 不存在时如实报告起不来', async () => {
    const missing = path.join(os.tmpdir(), 'baocut-self-check-no-electron', 'Electron');
    const result = await probeCompositionHost({ ...process.env, BAOCUT_ELECTRON: missing });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/^COMPOSITION_HOST_UNAVAILABLE: /);
  });
});
