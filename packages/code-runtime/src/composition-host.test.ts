import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeBundleError, inspectBundle, type InspectedBundle } from './bundle-inspect.ts';
import { CompositionHost, frameTicketAt, hostSpawnArgs, resolveElectronBinary } from './composition-host.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const repo = path.resolve(here, '../../..');
const electron = resolveElectronBinary();

const tmpDirs: string[] = [];
const inspect = async (name: string, options: Parameters<typeof inspectBundle>[1] = {}) => {
  const bundle = await inspectBundle(path.join(fixtures, name), options);
  if (bundle.synthesized) tmpDirs.push(bundle.root);
  return bundle;
};

describe('resolveElectronBinary', () => {
  it('BAOCUT_ELECTRON 优先', () => {
    expect(resolveElectronBinary({ BAOCUT_ELECTRON: '/opt/electron' })).toBe('/opt/electron');
  });

  it('宿主以 `--composition-host <脚本>` 两个独立参数拉起（打包后的主进程入口靠它认出宿主）', () => {
    expect(hostSpawnArgs('/c/baocut-composition-host/host-0.cjs')).toEqual(['--composition-host', '/c/baocut-composition-host/host-0.cjs']);
  });

  it('没有 Electron 时 start 抛 COMPOSITION_HOST_UNAVAILABLE', async () => {
    const error = await CompositionHost.start({ electron: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodeBundleError);
    expect((error as CodeBundleError).code).toBe('COMPOSITION_HOST_UNAVAILABLE');
  });
});

describe.skipIf(!electron)('CompositionHost（Electron 离屏）', { timeout: 120_000 }, () => {
  let host: CompositionHost;
  const logs: string[] = [];

  beforeAll(async () => {
    host = await CompositionHost.start({ log: (line) => logs.push(line) });
  }, 60_000);

  afterAll(async () => {
    await host?.close();
    expect(host?.alive).toBe(false);
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const at = (bundle: InspectedBundle, seconds: number) => frameTicketAt(bundle, { seconds });

  it('hyperframes/1：同一时刻两次取帧相同，不同时刻不同，越界被夹到末尾', async () => {
    const bundle = await inspect('hyperframes-basic', { manifest: { alpha: true } });
    const session = await host.open(bundle);
    try {
      expect(session.page).toEqual({ width: 1280, height: 720, fps: { num: 30, den: 1 }, durationSeconds: 2, compositionId: 'main' });
      const a = await session.frame(at(bundle, 0.5));
      const zero = await session.frame(at(bundle, 0));
      const b = await session.frame(at(bundle, 0.5));
      expect(a.receipt.sha256).toBe(b.receipt.sha256);
      expect(zero.receipt.sha256).not.toBe(a.receipt.sha256);
      expect(a.receipt).toMatchObject({ width: 1280, height: 720, pixelFormat: 'png', alphaMode: 'straight', clampedToDuration: false });
      expect(a.receipt.sampledSeconds).toBeCloseTo(0.5, 6);
      expect(a.png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(a.captureMode).toBe('capturePage');
      // 透明窗口：盒子之外是透明的。
      expect(a.transparentPixels).toBeGreaterThan(1280 * 720 * 0.9);
      const past = await session.frame(at(bundle, 2.5));
      expect(past.receipt.clampedToDuration).toBe(true);
      expect(past.receipt.sampledSeconds).toBeCloseTo(2, 6);
      expect(session.blockedRequests).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('精确的帧序号票据：localTime = k × den / num', async () => {
    const bundle = await inspect('hyperframes-basic');
    const session = await host.open(bundle);
    try {
      const ticket = frameTicketAt(bundle, { frameIndex: 15, fps: { num: 30000, den: 1001 } });
      expect(ticket.localTime).toEqual({ ticks: String(15 * 1001), timescale: 30000 });
      const frame = await session.frame(ticket);
      expect(frame.receipt.requestedSeconds).toBeCloseTo((15 * 1001) / 30000, 9);
      // 不透明窗口不统计透明像素。
      expect(frame.receipt.alphaMode).toBe('opaque');
      expect(frame.transparentPixels).toBe(0);
    } finally {
      await session.dispose();
    }
  });

  it('没有根元素 → COMPOSITION_ROOT_MISSING', async () => {
    const bundle = await inspect('root-missing', { manifest: { width: 1280, height: 720, fps: 30, durationFrames: 60 } });
    const error = await host.open(bundle).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodeBundleError);
    expect((error as CodeBundleError).code).toBe('COMPOSITION_ROOT_MISSING');
  });

  it('清单与页面不一致 → COMPOSITION_INTRINSIC_MISMATCH', async () => {
    const bundle = await inspect('hyperframes-basic', { manifest: { width: 640, height: 360 } });
    const error = await host.open(bundle).catch((e: unknown) => e);
    expect((error as CodeBundleError).code).toBe('COMPOSITION_INTRINSIC_MISMATCH');
    expect((error as CodeBundleError).details).toEqual([
      { field: 'width', manifest: 640, page: 1280 },
      { field: 'height', manifest: 360, page: 720 },
    ]);
  });

  it('baocut/1：原生合同可以取帧', async () => {
    const bundle = await inspect('baocut-native', { manifest: { alpha: true } });
    expect(bundle.manifest.runtime).toMatchObject({ contract: 'baocut/1' });
    const session = await host.open(bundle);
    try {
      const a = await session.frame(at(bundle, 1));
      const b = await session.frame(at(bundle, 1));
      const c = await session.frame(at(bundle, 0.25));
      expect(a.receipt.sha256).toBe(b.receipt.sha256);
      expect(c.receipt.sha256).not.toBe(a.receipt.sha256);
      expect(a.receipt.sampledSeconds).toBeCloseTo(1, 6);
    } finally {
      await session.dispose();
    }
  });

  it('运行期网络请求被拦截并记录', async () => {
    const bundle = await inspect('network-runtime');
    const session = await host.open(bundle);
    try {
      await session.frame(at(bundle, 0));
      expect(session.blockedRequests).toEqual(['https://example.invalid/x']);
    } finally {
      await session.dispose();
    }
  });

  it('打开 motion-graphics 的 build-bundle.mjs 产出的包并取帧', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-mg-host-'));
    tmpDirs.push(out);
    const html = path.join(repo, 'skills/motion-graphics/exemplars/lower-third/16x9.html');
    const run = spawnSync(
      process.execPath,
      [path.join(repo, 'skills/motion-graphics/scripts/build-bundle.mjs'), '--html', html, '--out', out],
      {
        encoding: 'utf8',
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const bundle = await inspectBundle(path.join(out, '1'));
    const session = await host.open(bundle);
    try {
      expect(session.page).toMatchObject({ width: 1920, height: 1080, durationSeconds: 4 });
      const frame = await session.frame(at(bundle, 2));
      expect(frame.receipt).toMatchObject({ width: 1920, height: 1080, alphaMode: 'straight' });
      expect(frame.transparentPixels).toBeGreaterThan(0);
      expect(frame.transparentPixels).toBeLessThan(1920 * 1080);
    } finally {
      await session.dispose();
    }
  });
});
