import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateInfo, AppUpdateNotice, AppUpdateSnapshot } from '@baocut/ui';
import { CHECK_INTERVAL_S, FIRST_CHECK_DELAY_S, QUIT_INSTALL_DEADLINE_MS, TICK_S } from './app-update-rules.ts';
import {
  cachedDownload,
  createAppUpdateService,
  discardStaleDownloads,
  downloadTo,
  installationBucket,
  type AppUpdateDeps,
  type AppUpdateService,
  type ByteSource,
  type InstallOutcome,
  type Prepared,
} from './app-update-service.ts';

/*
 * 只用临时目录与 file:// 清单、安装包；网络、时钟、定时器、换包都是注入的假货。从不连 baocut.app。
 */

const TARGET = 'aarch64-apple-darwin';
const PAYLOAD = Buffer.from('BaoCut 2.3.0 build 57 — 假安装包\n'.repeat(400));
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

let root: string;
let cacheDir: string;
let payloadPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-update-'));
  cacheDir = path.join(root, 'cache');
  payloadPath = path.join(root, 'BaoCut-2.3.0.zip');
  await fs.writeFile(payloadPath, PAYLOAD);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function infoFor(overrides: Partial<AppUpdateInfo> = {}): AppUpdateInfo {
  return {
    version: '2.3.0',
    build: 57,
    date: '2026-10-01',
    minimumSystemVersion: '14.0',
    notes: '改进',
    notesLocalized: {},
    format: 'zip',
    url: pathToFileURL(payloadPath).href,
    size: PAYLOAD.length,
    sha256: SHA,
    ...overrides,
  };
}

function manifestText(app: { url: string; size?: number; sha256?: string }, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    target: TARGET,
    version: '2.3.0',
    build: 57,
    date: '2026-10-01',
    minimumSystemVersion: '14.0',
    notes: 'Improvements',
    notesLocalized: { 'zh-Hans': '改进' },
    app: { size: PAYLOAD.length, sha256: SHA, format: 'zip', ...app },
    ...extra,
  });
}

async function writeFeed(text: string): Promise<string> {
  const feed = path.join(root, 'appcast.json');
  await fs.writeFile(feed, text);
  return pathToFileURL(feed).href;
}

const noRemote = async (): Promise<ByteSource> => {
  throw new Error('不该连网');
};

/** 一点点吐字节的远端；`gate` 放行前卡在第一块之后。 */
function gatedRemote(gate: Promise<void>): (url: string, signal: AbortSignal) => Promise<ByteSource> {
  return async () =>
    (async function* () {
      yield PAYLOAD.subarray(0, 100);
      await gate;
      yield PAYLOAD.subarray(100);
    })();
}

describe('下载', () => {
  const options = { signal: new AbortController().signal, onProgress: () => {}, openRemote: noRemote };

  it('流式落地、校验后改名，清掉别的安装包与残留的 .part', async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'BaoCut-2.2.0.zip'), 'old');
    await fs.writeFile(path.join(cacheDir, 'stale.dmg.part'), 'old');
    await fs.writeFile(path.join(cacheDir, 'install.log'), 'keep');
    const progress: number[] = [];
    const result = await downloadTo(infoFor(), cacheDir, { ...options, onProgress: (pct) => progress.push(pct) });
    expect(result).toEqual({ ok: true, path: path.join(cacheDir, 'BaoCut-2.3.0.zip') });
    expect(await fs.readFile(path.join(cacheDir, 'BaoCut-2.3.0.zip'))).toEqual(PAYLOAD);
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'install.log']);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
  });

  it('摘要或大小对不上就丢掉并报告校验失败', async () => {
    const bad = await downloadTo(infoFor({ sha256: '0'.repeat(64) }), cacheDir, options);
    expect(bad).toMatchObject({ ok: false, cancelled: false, failure: 'verify' });
    const short = await downloadTo(infoFor({ size: PAYLOAD.length + 10 }), cacheDir, options);
    expect(short).toMatchObject({ ok: false, cancelled: false, failure: 'verify' });
    const long = await downloadTo(infoFor({ size: 10 }), cacheDir, options);
    expect(long).toMatchObject({ ok: false, cancelled: false, failure: 'verify' });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('取消即停，不留 .part', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = downloadTo(infoFor({ url: 'https://example.invalid/BaoCut-2.3.0.zip' }), cacheDir, {
      signal: controller.signal,
      onProgress: () => {},
      openRemote: gatedRemote(gate),
    });
    await vi.waitFor(async () => expect(await fs.readdir(cacheDir)).toContain('BaoCut-2.3.0.zip.part'));
    controller.abort();
    release();
    expect(await pending).toEqual({ ok: false, cancelled: true });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('打不开远端算下载失败', async () => {
    const result = await downloadTo(infoFor({ url: 'https://example.invalid/x.zip' }), cacheDir, options);
    expect(result).toMatchObject({ ok: false, cancelled: false, failure: 'download' });
  });

  it('缓存里的文件被改过就不复用', async () => {
    await downloadTo(infoFor(), cacheDir, options);
    expect(await cachedDownload(infoFor(), cacheDir)).toBe(path.join(cacheDir, 'BaoCut-2.3.0.zip'));
    const tampered = Buffer.from(PAYLOAD);
    tampered[0] = 0;
    await fs.writeFile(path.join(cacheDir, 'BaoCut-2.3.0.zip'), tampered);
    expect(await cachedDownload(infoFor(), cacheDir)).toBeNull();
  });

  it('装完重新打开后只清这次启动之前的安装包', async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    const started = Date.UTC(2026, 9, 5, 8, 0, 0);
    const before = new Date(started - 60_000);
    const after = new Date(started + 60_000);
    for (const [name, time] of [
      ['BaoCut-0.1.0-build.6-win-x64-setup.exe', before],
      ['old.zip.part', before],
      ['install.log', before],
      ['BaoCut-0.1.0-build.8-win-x64-setup.exe', after],
    ] as const) {
      await fs.writeFile(path.join(cacheDir, name), 'x');
      await fs.utimes(path.join(cacheDir, name), time, time);
    }
    await discardStaleDownloads(cacheDir, started);
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-0.1.0-build.8-win-x64-setup.exe', 'install.log']);
    await discardStaleDownloads(path.join(root, 'missing'), started);
  });
});

interface Harness {
  service: AppUpdateService;
  deps: AppUpdateDeps;
  states: AppUpdateSnapshot[];
  notices: AppUpdateNotice[];
  /** 把假时钟往前拨，并触发到点的定时器。 */
  advance(ms: number): void;
  state(): AppUpdateSnapshot['state'];
}

function harness(overrides: Partial<AppUpdateDeps> = {}): Harness {
  let now = Date.UTC(2026, 9, 3, 8, 0, 0);
  let timers: { at: number; run: () => void }[] = [];
  const deps: AppUpdateDeps = {
    unsupported: null,
    target: TARGET,
    variant: null,
    feed: null,
    current: { version: '2.2.0', build: 50 },
    systemVersion: '15.1',
    macos: true,
    cacheDir,
    fetchText: async () => {
      throw new Error('不该连网');
    },
    openRemote: noRemote,
    canAutoInstall: async () => true,
    prepare: vi.fn(async (): Promise<Prepared> => ({ type: 'none' })),
    installPackage: vi.fn(async (): Promise<InstallOutcome> => ({ type: 'launched' })),
    reveal: vi.fn(),
    openDownloadPage: vi.fn(),
    quit: vi.fn(),
    rolloutBucket: vi.fn(async () => 0.5),
    now: () => now,
    schedule: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => void (timers = timers.filter((t) => t !== timer));
    },
    log: () => {},
    ...overrides,
  };
  const service = createAppUpdateService(deps);
  const states: AppUpdateSnapshot[] = [];
  const notices: AppUpdateNotice[] = [];
  service.onState((snapshot) => states.push(snapshot));
  service.onNotice((notice) => notices.push(notice));
  return {
    service,
    deps,
    states,
    notices,
    advance(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now);
        if (due.length === 0) break;
        timers = timers.filter((t) => t.at > now);
        for (const timer of due) timer.run();
      }
    },
    state: () => service.snapshot().state,
  };
}

async function fileFeed(): Promise<AppUpdateDeps['feed']> {
  return { url: await writeFeed(manifestText({ url: pathToFileURL(payloadPath).href })), allowFileUrl: true };
}

describe('服务', () => {
  it('手动检查 → 有新版本（不提醒）→ 下载 → 已下载 → 安装后退出', async () => {
    const h = harness({ feed: await fileFeed() });
    await h.service.check('manual');
    expect(h.state()).toMatchObject({ k: 'available', info: { version: '2.3.0', build: 57 } });
    expect(h.service.snapshot().lastCheckAt).toBeTypeOf('number');
    expect(h.notices).toEqual([]);
    h.service.download();
    expect(h.state().k).toBe('downloading');
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    expect(h.notices).toEqual([]);
    await h.service.install();
    expect(h.deps.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ build: 57 }),
      path.join(cacheDir, 'BaoCut-2.3.0.zip'),
      expect.any(AbortSignal),
    );
    expect(h.deps.installPackage).toHaveBeenCalledWith(expect.objectContaining({ build: 57 }), path.join(cacheDir, 'BaoCut-2.3.0.zip'), {
      staged: null,
      relaunch: true,
    });
    expect(h.state().k).toBe('installing');
    expect(h.deps.quit).toHaveBeenCalledOnce();
  });

  it('清单是别的变体的：检查失败，不提供更新', async () => {
    const feed = await writeFeed(manifestText({ url: pathToFileURL(payloadPath).href }, { variant: 'cuda' }));
    const h = harness({ feed: { url: feed, allowFileUrl: true }, variant: 'vulkan' });
    await h.service.check('manual');
    expect(h.state()).toEqual({ k: 'error', failure: 'check', info: null });
    const same = harness({ feed: { url: feed, allowFileUrl: true }, variant: 'cuda' });
    await same.service.check('manual');
    expect(same.state()).toMatchObject({ k: 'available', info: { build: 57 } });
  });

  it('已是最新', async () => {
    const h = harness({ feed: await fileFeed(), current: { version: '2.3.0', build: 57 } });
    await h.service.check('manual');
    expect(h.state()).toEqual({ k: 'upToDate' });
  });

  it('已是最新时清掉缓存里用不上的包（退出时装好后留下的安装器）', async () => {
    await fs.mkdir(path.join(cacheDir, 'unpack-57'), { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'BaoCut-2.3.0-build.57-win-x64-setup.exe'), 'x');
    await fs.writeFile(path.join(cacheDir, 'install.log'), 'keep');
    const h = harness({ feed: await fileFeed(), current: { version: '2.3.0', build: 57 } });
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'upToDate' });
    expect(await fs.readdir(cacheDir)).toEqual(['install.log']);
  });

  it('自动检查且自动下载：后台下好，提醒「已下载」一次', async () => {
    const h = harness({ feed: await fileFeed() });
    h.service.configure({ autoCheck: true, autoDownload: true });
    await h.service.check('auto');
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    expect(h.notices).toEqual([{ kind: 'ready', info: expect.objectContaining({ build: 57 }) }]);
  });

  it('自动下载关着或不能自动换包：停在有新版本，提醒「可以更新了」', async () => {
    const off = harness({ feed: await fileFeed() });
    off.service.configure({ autoCheck: true, autoDownload: false });
    await off.service.check('auto');
    expect(off.state().k).toBe('available');
    expect(off.notices).toEqual([{ kind: 'available', info: expect.objectContaining({ build: 57 }) }]);
    const manual = harness({ feed: await fileFeed(), canAutoInstall: async () => false });
    manual.service.configure({ autoCheck: true, autoDownload: true });
    await manual.service.check('auto');
    expect(manual.state().k).toBe('available');
    expect(manual.notices.map((n) => n.kind)).toEqual(['available']);
  });

  it('缓存里已有同一 build：不重下，过一遍校验段再到已下载，自动检查时提醒', async () => {
    await downloadTo(infoFor(), cacheDir, { signal: new AbortController().signal, onProgress: () => {}, openRemote: noRemote });
    const h = harness({ feed: await fileFeed() });
    h.service.configure({ autoCheck: true, autoDownload: false });
    await h.service.check('auto');
    await vi.waitFor(() => expect(h.state()).toMatchObject({ k: 'ready', path: path.join(cacheDir, 'BaoCut-2.3.0.zip') }));
    expect(h.states.map((s) => s.state.k)).toEqual(['checking', 'downloading', 'ready']);
    expect(h.states[1]?.state).toMatchObject({ k: 'downloading', pct: 100 });
    expect(h.deps.prepare).toHaveBeenCalledOnce();
    expect(h.notices.map((n) => n.kind)).toEqual(['ready']);

    const manual = harness({ feed: await fileFeed() });
    await manual.service.check('manual');
    await vi.waitFor(() => expect(manual.state().k).toBe('ready'));
    expect(manual.notices).toEqual([]);
  });

  it('系统不够：停在有新版本，不下载也不提醒', async () => {
    const h = harness({ feed: await fileFeed(), systemVersion: '13.6' });
    h.service.configure({ autoCheck: true, autoDownload: true });
    await h.service.check('auto');
    expect(h.state()).toMatchObject({ k: 'available', systemUnmet: '14.0' });
    h.service.download();
    expect(h.state().k).toBe('available');
    expect(h.notices).toEqual([]);
  });

  it('检查失败进出错；有新版本时的静默检查失败保持原样', async () => {
    const missing = harness({ feed: { url: pathToFileURL(path.join(root, 'nope.json')).href, allowFileUrl: true } });
    await missing.service.check('manual');
    expect(missing.state()).toEqual({ k: 'error', failure: 'check', info: null });

    const feed = await fileFeed();
    const h = harness({ feed });
    await h.service.check('manual');
    expect(h.state().k).toBe('available');
    await fs.writeFile(path.join(root, 'appcast.json'), '{broken');
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'available', info: expect.objectContaining({ build: 57 }) });
  });

  it('清单里的安装包校验不过：丢掉并报告', async () => {
    const h = harness({ feed: { url: await writeFeed(manifestText({ url: pathToFileURL(payloadPath).href, sha256: 'c'.repeat(64) })), allowFileUrl: true } });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('error'));
    expect(h.state()).toMatchObject({ k: 'error', failure: 'verify', info: { build: 57 } });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('取消后晚到的下载结果被丢弃', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      feed: { url: await writeFeed(manifestText({ url: 'https://example.invalid/BaoCut-2.3.0.zip' })), allowFileUrl: true },
      openRemote: gatedRemote(gate),
    });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(async () => expect(await fs.readdir(cacheDir)).toContain('BaoCut-2.3.0.zip.part'));
    h.service.cancel();
    expect(h.state().k).toBe('available');
    release();
    await vi.waitFor(async () => expect(await fs.readdir(cacheDir)).toEqual([]));
    expect(h.state().k).toBe('available');
  });

  it('安装前重新校验：被改过的包删掉并报告', async () => {
    const h = harness({ feed: await fileFeed() });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    await fs.writeFile(path.join(cacheDir, 'BaoCut-2.3.0.zip'), 'tampered');
    await h.service.install();
    expect(h.state()).toMatchObject({ k: 'error', failure: 'verify', info: { build: 57 } });
    expect(h.deps.installPackage).not.toHaveBeenCalled();
    expect(h.deps.quit).not.toHaveBeenCalled();
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('不能自己换包：在访达里显示安装包、打开下载页，不退出', async () => {
    const h = harness({ feed: await fileFeed(), installPackage: vi.fn(async (): Promise<InstallOutcome> => ({ type: 'fallback' })) });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    await h.service.install();
    expect(h.deps.reveal).toHaveBeenCalledWith(path.join(cacheDir, 'BaoCut-2.3.0.zip'));
    expect(h.deps.openDownloadPage).toHaveBeenCalledOnce();
    expect(h.deps.quit).not.toHaveBeenCalled();
    expect(h.state()).toMatchObject({ k: 'error', failure: 'manual', info: { build: 57 } });
  });

  it('换包失败按类别报告', async () => {
    const h = harness({
      feed: await fileFeed(),
      installPackage: vi.fn(async (): Promise<InstallOutcome> => ({ type: 'failed', failure: 'signature', detail: 'team' })),
    });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    await h.service.install();
    expect(h.state()).toMatchObject({ k: 'error', failure: 'signature' });
    expect(h.deps.quit).not.toHaveBeenCalled();
  });

  it('不检查更新时什么都不做', async () => {
    const h = harness({ unsupported: 'dev', feed: await fileFeed() });
    h.service.start();
    h.advance(FIRST_CHECK_DELAY_S * 1000);
    await h.service.check('manual');
    expect(h.state()).toEqual({ k: 'unsupported', why: 'dev' });
    expect(h.states).toEqual([]);
  });
});

describe('分批推送', () => {
  const HOUR = 3600 * 1000;
  /** 已放开 10%（harness 的时钟在发布后 1 小时，分 10 小时推完）。 */
  async function rolloutFeed(offsetHours = -1): Promise<AppUpdateDeps['feed']> {
    const releasedAt = new Date(Date.UTC(2026, 9, 3, 8, 0, 0) + offsetHours * HOUR).toISOString();
    const text = manifestText({ url: pathToFileURL(payloadPath).href }, { rolloutHours: 10, releasedAt });
    return { url: await writeFeed(text), allowFileUrl: true };
  }

  it('自动检查没轮到本机：当作已是最新，不提醒，记一行日志', async () => {
    const log = vi.fn();
    const h = harness({ feed: await rolloutFeed(), log });
    h.service.configure({ autoCheck: true, autoDownload: true });
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'upToDate' });
    expect(h.notices).toEqual([]);
    expect(h.service.snapshot().lastCheckAt).toBeTypeOf('number');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^分批推送：build 57 .*10\.0%.*50\.0%/));
  });

  it('轮到本机的照常推；发布时刻之前谁都不推', async () => {
    const early = harness({ feed: await rolloutFeed(), rolloutBucket: async () => 0.05 });
    early.service.configure({ autoCheck: true, autoDownload: false });
    await early.service.check('auto');
    expect(early.state()).toMatchObject({ k: 'available', info: { build: 57 } });
    expect(early.notices.map((n) => n.kind)).toEqual(['available']);

    const future = harness({ feed: await rolloutFeed(2), rolloutBucket: async () => 0 });
    future.service.configure({ autoCheck: true, autoDownload: false });
    await future.service.check('auto');
    expect(future.state()).toEqual({ k: 'upToDate' });
  });

  it('手动检查不受分批限制，也不读本机位置', async () => {
    const h = harness({ feed: await rolloutFeed() });
    await h.service.check('manual');
    expect(h.state()).toMatchObject({ k: 'available', info: { build: 57 } });
    expect(h.deps.rolloutBucket).not.toHaveBeenCalled();
  });

  it('手动检查找到过的同一 build，之后的自动检查不收回', async () => {
    const h = harness({ feed: await rolloutFeed() });
    h.service.configure({ autoCheck: true, autoDownload: false });
    await h.service.check('manual');
    expect(h.state()).toMatchObject({ k: 'available', info: { build: 57 } });
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'available', info: expect.objectContaining({ build: 57 }) });
    expect(h.deps.rolloutBucket).not.toHaveBeenCalled();
  });

  it('下载失败（出错带着版本）后的自动检查也不收回', async () => {
    const text = manifestText(
      { url: pathToFileURL(payloadPath).href, sha256: 'c'.repeat(64) },
      { rolloutHours: 10, releasedAt: new Date(Date.UTC(2026, 9, 3, 7, 0, 0)).toISOString() },
    );
    const h = harness({ feed: { url: await writeFeed(text), allowFileUrl: true } });
    h.service.configure({ autoCheck: true, autoDownload: false });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('error'));
    await h.service.check('auto');
    expect(h.state()).toMatchObject({ k: 'available', info: { build: 57 } });
  });

  it('本机位置存在用户数据目录里，读不懂就重新生成，写不进去也照用', async () => {
    const file = path.join(root, 'userData', 'update-installation-id');
    const first = await installationBucket(file);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    const id = (await fs.readFile(file, 'utf8')).trim();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await installationBucket(file)).toBe(first);

    await fs.writeFile(file, 'garbage');
    const regenerated = await installationBucket(file);
    expect((await fs.readFile(file, 'utf8')).trim()).not.toBe('garbage');
    expect(await installationBucket(file)).toBe(regenerated);

    const blocked = path.join(root, 'not-a-dir');
    await fs.writeFile(blocked, 'x');
    const unwritable = await installationBucket(path.join(blocked, 'update-installation-id'));
    expect(unwritable).toBeGreaterThanOrEqual(0);
    expect(unwritable).toBeLessThan(1);
  });
});

/** 像 macOS 那样把新包解开到 `unpack-<build>` 的假校验段。 */
function stagingPrepare(): AppUpdateDeps['prepare'] {
  return vi.fn(async (info: AppUpdateInfo, archive: string): Promise<Prepared> => {
    const dir = path.join(path.dirname(archive), `unpack-${info.build}`);
    await fs.mkdir(path.join(dir, 'BaoCut.app'), { recursive: true });
    return { type: 'staged', staged: { app: path.join(dir, 'BaoCut.app'), dir } };
  });
}

/** 新一版 build 58 的清单（安装包内容与 57 相同，换个文件名）。 */
async function feed58(extra: Record<string, unknown> = {}): Promise<void> {
  const next = path.join(root, 'BaoCut-2.4.0.zip');
  await fs.writeFile(next, PAYLOAD);
  await writeFeed(manifestText({ url: pathToFileURL(next).href }, { version: '2.4.0', build: 58, ...extra }));
}

/** 手动检查并下载到「已下载」。 */
async function toReady(h: Harness): Promise<void> {
  await h.service.check('manual');
  h.service.download();
  await vi.waitFor(() => expect(h.state().k).toBe('ready'));
}

const ARCHIVE_57 = () => path.join(cacheDir, 'BaoCut-2.3.0.zip');

describe('校验段', () => {
  it('下完先停在 100% 校验，就位后才到已下载', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const staging = stagingPrepare();
    const h = harness({
      feed: await fileFeed(),
      prepare: vi.fn(async (info: AppUpdateInfo, archive: string, signal: AbortSignal) => {
        await gate;
        return staging(info, archive, signal);
      }),
    });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.deps.prepare).toHaveBeenCalledOnce());
    expect(h.state()).toMatchObject({ k: 'downloading', pct: 100 });
    release();
    await vi.waitFor(() => expect(h.state().k).toBe('ready'));
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'unpack-57']);
  });

  it('校验段里取消：停下在跑的命令，丢掉安装包与解开的目录', async () => {
    const h = harness({
      feed: await fileFeed(),
      prepare: vi.fn(async (info: AppUpdateInfo, archive: string, signal: AbortSignal): Promise<Prepared> => {
        const dir = path.join(path.dirname(archive), `unpack-${info.build}`);
        await fs.mkdir(dir, { recursive: true });
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return { type: 'staged', staged: { app: path.join(dir, 'BaoCut.app'), dir } };
      }),
    });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.deps.prepare).toHaveBeenCalledOnce());
    h.service.cancel();
    expect(h.state().k).toBe('available');
    await vi.waitFor(async () => expect(await fs.readdir(cacheDir)).toEqual([]));
    expect(h.state().k).toBe('available');
  });

  it('校验段不过：删掉安装包，按类别报告', async () => {
    const h = harness({
      feed: await fileFeed(),
      prepare: vi.fn(async (): Promise<Prepared> => ({ type: 'failed', failure: 'signature', detail: 'team' })),
    });
    await h.service.check('manual');
    h.service.download();
    await vi.waitFor(() => expect(h.state().k).toBe('error'));
    expect(h.state()).toMatchObject({ k: 'error', failure: 'signature', info: { build: 57 } });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('就位过的「重启并更新」只做便宜核对，不再重算摘要', async () => {
    const h = harness({ feed: await fileFeed(), prepare: stagingPrepare() });
    await toReady(h);
    await fs.writeFile(ARCHIVE_57(), 'tampered');
    await h.service.install();
    const dir = path.join(cacheDir, 'unpack-57');
    expect(h.deps.installPackage).toHaveBeenCalledWith(expect.objectContaining({ build: 57 }), ARCHIVE_57(), {
      staged: { app: path.join(dir, 'BaoCut.app'), dir },
      relaunch: true,
    });
    expect(h.deps.quit).toHaveBeenCalledOnce();
  });
});

describe('已下载时的静默检查', () => {
  async function readyHarness(overrides: Partial<AppUpdateDeps> = {}): Promise<Harness> {
    const h = harness({ feed: await fileFeed(), prepare: stagingPrepare(), ...overrides });
    h.service.configure({ autoCheck: true, autoDownload: false });
    await toReady(h);
    h.states.length = 0;
    return h;
  }

  it('还是同一 build：留在已下载，不重算也不重新就位', async () => {
    const h = await readyHarness();
    await h.service.check('auto');
    expect(h.states.map((s) => s.state)).toEqual([
      expect.objectContaining({ k: 'ready', bg: true }),
      expect.objectContaining({ k: 'ready' }),
    ]);
    expect(h.state()).toEqual({ k: 'ready', info: expect.objectContaining({ build: 57 }), path: ARCHIVE_57() });
    expect(h.deps.prepare).toHaveBeenCalledOnce();
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'unpack-57']);
    expect(h.notices).toEqual([]);
  });

  it('有了更新的 build：转到有新版本，旧的下载作废', async () => {
    const h = await readyHarness();
    await feed58();
    await h.service.check('auto');
    expect(h.state()).toMatchObject({ k: 'available', info: { build: 58 } });
    expect(h.notices.map((n) => n.kind)).toEqual(['available']);
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('有了更新的 build 且自动下载：作废旧的、下新的，就位后提醒', async () => {
    const h = await readyHarness();
    h.service.configure({ autoCheck: true, autoDownload: true });
    await feed58();
    await h.service.check('auto');
    await vi.waitFor(() => expect(h.state()).toMatchObject({ k: 'ready', info: { build: 58 } }));
    expect(h.notices).toEqual([{ kind: 'ready', info: expect.objectContaining({ build: 58 }) }]);
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.4.0.zip', 'unpack-58']);
  });

  it('新 build 本机系统不够：留在已下载', async () => {
    const h = await readyHarness();
    await feed58({ minimumSystemVersion: '99.0' });
    await h.service.check('auto');
    expect(h.state()).toMatchObject({ k: 'ready', info: { build: 57 } });
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'unpack-57']);
  });

  it('更新被撤回：转到已是最新，删掉下载的包与解开的目录', async () => {
    const h = await readyHarness();
    await writeFeed(manifestText({ url: pathToFileURL(payloadPath).href }, { version: '2.2.0', build: 50 }));
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'upToDate' });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('检查失败：留在已下载，文件都在', async () => {
    const h = await readyHarness();
    await writeFeed('{broken');
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'ready', info: expect.objectContaining({ build: 57 }), path: ARCHIVE_57() });
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'unpack-57']);
  });

  it('新 build 没轮到本机：已下载与有新版本都原样不动', async () => {
    const rollout = { rolloutHours: 10, releasedAt: new Date(Date.UTC(2026, 9, 3, 7, 0, 0)).toISOString() };
    const h = await readyHarness();
    await feed58(rollout);
    await h.service.check('auto');
    expect(h.state()).toEqual({ k: 'ready', info: expect.objectContaining({ build: 57 }), path: ARCHIVE_57() });
    expect((await fs.readdir(cacheDir)).sort()).toEqual(['BaoCut-2.3.0.zip', 'unpack-57']);

    // 同一个缓存目录里留着 57 的包，清掉免得这一台直接从缓存走到已下载。
    await fs.rm(cacheDir, { recursive: true, force: true });
    const available = harness({ feed: await fileFeed() });
    available.service.configure({ autoCheck: true, autoDownload: false });
    await available.service.check('manual');
    await feed58(rollout);
    await available.service.check('auto');
    expect(available.state()).toEqual({ k: 'available', info: expect.objectContaining({ build: 57 }) });
    expect(available.notices).toEqual([]);
  });
});

describe('退出即安装', () => {
  it('已下载且就位：退出时换包，装完不重新打开，也不再调退出', async () => {
    const h = harness({ feed: await fileFeed(), prepare: stagingPrepare() });
    await toReady(h);
    await h.service.installOnQuit();
    const dir = path.join(cacheDir, 'unpack-57');
    expect(h.deps.installPackage).toHaveBeenCalledWith(expect.objectContaining({ build: 57 }), ARCHIVE_57(), {
      staged: { app: path.join(dir, 'BaoCut.app'), dir },
      relaunch: false,
    });
    expect(h.state().k).toBe('installing');
    expect(h.deps.quit).not.toHaveBeenCalled();
    await h.service.installOnQuit();
    expect(h.deps.installPackage).toHaveBeenCalledOnce();
  });

  it('静默检查在飞时退出照样安装', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness({ feed: await fileFeed(), prepare: stagingPrepare() });
    h.service.configure({ autoCheck: true, autoDownload: false });
    await toReady(h);
    h.deps.feed = { url: 'https://example.invalid/appcast.json', allowFileUrl: false };
    h.deps.fetchText = async () => {
      await gate;
      return '{broken';
    };
    const checking = h.service.check('auto');
    expect(h.state()).toMatchObject({ k: 'ready', bg: true });
    await h.service.installOnQuit();
    expect(h.deps.installPackage).toHaveBeenCalledWith(expect.anything(), ARCHIVE_57(), expect.objectContaining({ relaunch: false }));
    release();
    await checking;
    expect(h.state().k).toBe('installing');
  });

  it('不在已下载、不能自己换包、点过「重启并更新」：什么都不做', async () => {
    const available = harness({ feed: await fileFeed() });
    await available.service.check('manual');
    await available.service.installOnQuit();
    expect(available.deps.installPackage).not.toHaveBeenCalled();

    let allowed = true;
    const blocked = harness({ feed: await fileFeed(), prepare: stagingPrepare(), canAutoInstall: async () => allowed });
    await toReady(blocked);
    allowed = false;
    await blocked.service.installOnQuit();
    expect(blocked.deps.installPackage).not.toHaveBeenCalled();
    expect(blocked.state().k).toBe('ready');

    const restarted = harness({ feed: await fileFeed(), prepare: stagingPrepare() });
    await toReady(restarted);
    await restarted.service.install();
    await restarted.service.installOnQuit();
    expect(restarted.deps.installPackage).toHaveBeenCalledOnce();
    expect(restarted.deps.installPackage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ relaunch: true }),
    );
  });

  it('不用就位的（Windows）：只核对文件还在、大小对，不在就不装', async () => {
    const h = harness({ feed: await fileFeed(), macos: false });
    await toReady(h);
    await fs.rm(ARCHIVE_57());
    await h.service.installOnQuit();
    expect(h.deps.installPackage).not.toHaveBeenCalled();

    const ok = harness({ feed: await fileFeed(), macos: false });
    await toReady(ok);
    await ok.service.installOnQuit();
    expect(ok.deps.installPackage).toHaveBeenCalledWith(expect.anything(), ARCHIVE_57(), { staged: null, relaunch: false });
  });

  it('换包程序迟迟不起：到时限照常退出', async () => {
    const h = harness({ feed: await fileFeed(), prepare: stagingPrepare() });
    await toReady(h);
    h.deps.installPackage = vi.fn(() => new Promise<InstallOutcome>(() => {}));
    const quitting = h.service.installOnQuit();
    await vi.waitFor(() => expect(h.deps.installPackage).toHaveBeenCalledOnce());
    h.advance(QUIT_INSTALL_DEADLINE_MS);
    await quitting;
    expect(h.state().k).toBe('ready');
  });
});

describe('节拍器', () => {
  function counting(): { fetchText: AppUpdateDeps['fetchText']; count(): number } {
    let calls = 0;
    return {
      fetchText: async () => {
        calls++;
        return manifestText({ url: 'https://example.invalid/BaoCut-2.3.0.zip' });
      },
      count: () => calls,
    };
  }

  it('偏好没到不查；到了立刻补第一拍；之后满 6 小时才再查', async () => {
    const feed = counting();
    const h = harness({ feed: { url: 'https://example.invalid/appcast.json', allowFileUrl: false }, fetchText: feed.fetchText });
    h.service.start();
    h.advance(FIRST_CHECK_DELAY_S * 1000);
    expect(feed.count()).toBe(0);
    h.service.configure({ autoCheck: true, autoDownload: false });
    await vi.waitFor(() => expect(h.state().k).toBe('available'));
    expect(feed.count()).toBe(1);
    h.advance(TICK_S * 1000);
    await Promise.resolve();
    expect(feed.count()).toBe(1);
    h.advance(CHECK_INTERVAL_S * 1000);
    await vi.waitFor(() => expect(feed.count()).toBe(2));
    // 有新版本时的自动检查是静默的：不进「正在检查」。
    expect(h.states.some((s, i) => i > 0 && s.state.k === 'checking' && h.states[i - 1]?.state.k === 'available')).toBe(false);
  });

  it('自动检查关着：到点也不查，手动照常', async () => {
    const feed = counting();
    const h = harness({ feed: { url: 'https://example.invalid/appcast.json', allowFileUrl: false }, fetchText: feed.fetchText });
    h.service.configure({ autoCheck: false, autoDownload: false });
    h.service.start();
    h.advance(FIRST_CHECK_DELAY_S * 1000 + CHECK_INTERVAL_S * 1000);
    expect(feed.count()).toBe(0);
    await h.service.check('manual');
    expect(feed.count()).toBe(1);
  });

  it('dispose 后停表', async () => {
    const feed = counting();
    const h = harness({ feed: { url: 'https://example.invalid/appcast.json', allowFileUrl: false }, fetchText: feed.fetchText });
    h.service.configure({ autoCheck: true, autoDownload: false });
    h.service.start();
    h.service.dispose();
    h.advance(FIRST_CHECK_DELAY_S * 1000);
    expect(feed.count()).toBe(0);
  });
});
