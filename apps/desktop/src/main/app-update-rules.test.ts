import { describe, expect, it } from 'vitest';
import type { AppUpdateInfo, AppUpdateState } from '@baocut/ui';
import {
  CHECK_INTERVAL_S,
  appBundleFromExecutable,
  availability,
  bucketFromId,
  cacheDirectory,
  compareVersions,
  exeInAppBundle,
  feedFileName,
  feedTarget,
  feedUrl,
  fileName,
  fileUrlPath,
  followup,
  installerScript,
  isFileUrl,
  isInstallationId,
  isNewer,
  mayAutoCheck,
  mountPath,
  parseManifest,
  percent,
  progressDue,
  reduce,
  releaseManifest,
  rolloutAdmits,
  rolloutFraction,
  shellQuote,
  shouldAutoCheck,
  systemRequirementUnmet,
  teamIdentifier,
  verifying,
  type CheckReport,
  type InstallerPlan,
  type UpdateEnvironment,
} from './app-update-rules.ts';

const TARGET = 'aarch64-apple-darwin';
const SHA = 'AB'.repeat(32);

function manifest(app: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    target: TARGET,
    version: '2.3.0',
    build: 57,
    date: '2026-10-01',
    minimumSystemVersion: '14.0',
    notes: 'Improvements',
    notesLocalized: { 'zh-Hans': '改进' },
    releaseHistory: [{ version: '2.2.0' }],
    app,
    ...extra,
  });
}

const zipApp = { url: 'https://baocut.app/downloads/BaoCut-2.3.0-build.57-aarch64-apple-darwin.zip', size: 1024, sha256: SHA, format: 'zip' };

const info: AppUpdateInfo = {
  version: '2.3.0',
  build: 57,
  date: '2026-10-01',
  minimumSystemVersion: '14.0',
  notes: 'a',
  notesLocalized: {},
  format: 'zip',
  url: zipApp.url,
  size: 1024,
  sha256: SHA.toLowerCase(),
};

describe('更新源', () => {
  it('只有 Apple 芯片的 macOS 与 x64 的 Windows 有发布物', () => {
    expect(feedTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(feedTarget('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(feedTarget('darwin', 'x64')).toBeNull();
    expect(feedTarget('linux', 'x64')).toBeNull();
    expect(feedUrl('aarch64-apple-darwin')).toBe('https://baocut.app/v2/appcast-aarch64-apple-darwin.json');
    expect(feedUrl('x86_64-pc-windows-msvc')).toBe('https://baocut.app/v2/appcast-x86_64-pc-windows-msvc.json');
  });

  it('Windows 的 CUDA、Vulkan 版各读自己的更新源，标准版不带后缀', () => {
    const win = 'x86_64-pc-windows-msvc';
    expect(feedFileName(win, null)).toBe('appcast-x86_64-pc-windows-msvc.json');
    expect(feedFileName(win, 'cpu')).toBe('appcast-x86_64-pc-windows-msvc.json');
    expect(feedFileName(win, 'cuda')).toBe('appcast-x86_64-pc-windows-msvc-cuda.json');
    expect(feedFileName(win, 'vulkan')).toBe('appcast-x86_64-pc-windows-msvc-vulkan.json');
    expect(feedFileName(win, '../x')).toBe('appcast-x86_64-pc-windows-msvc.json');
    expect(feedUrl(win, 'cuda')).toBe('https://baocut.app/v2/appcast-x86_64-pc-windows-msvc-cuda.json');
  });

  it('Windows 的本地路径与 file:// 地址', () => {
    expect(isFileUrl('C:\\feeds\\appcast.json')).toBe(true);
    expect(isFileUrl('d:/feeds/appcast.json')).toBe(true);
    expect(isFileUrl('C:appcast.json')).toBe(false);
    expect(fileUrlPath('C:\\feeds\\appcast.json')).toBe('C:\\feeds\\appcast.json');
    expect(fileUrlPath('file:///C:/My%20Feeds/appcast.json')).toBe('C:/My Feeds/appcast.json');
    expect(fileUrlPath('file:///c:/a.exe')).toBe('c:/a.exe');
  });

  it('本地文件地址解码成路径', () => {
    expect(isFileUrl('file:///tmp/a.json')).toBe(true);
    expect(isFileUrl('/tmp/a.json')).toBe(true);
    expect(isFileUrl('https://baocut.app/a.json')).toBe(false);
    expect(fileUrlPath('file:///tmp/My%20Feed/a.json')).toBe('/tmp/My Feed/a.json');
    expect(fileUrlPath('file:///tmp/%E4%B8%AD.json')).toBe('/tmp/中.json');
    expect(fileUrlPath('file:///tmp/100%')).toBe('/tmp/100%');
    expect(fileUrlPath('/tmp/a.json')).toBe('/tmp/a.json');
    expect(fileUrlPath('https://baocut.app/a.json')).toBeNull();
  });
});

describe('清单', () => {
  it('schema-1 的 ZIP 清单能解析，未知键忽略，摘要转小写', () => {
    const result = parseManifest(manifest(zipApp), TARGET, false);
    expect(result).toEqual({
      ok: true,
      info: { ...info, notes: 'Improvements', notesLocalized: { 'zh-Hans': '改进' } },
      rollout: null,
    });
  });

  it('形态按 target 校验；缺 format 按 dmg 读', () => {
    expect(parseManifest(manifest({ ...zipApp, format: 'dmg' }), TARGET, false)).toMatchObject({ ok: true, info: { format: 'dmg' } });
    expect(parseManifest(manifest({ ...zipApp, format: undefined }), TARGET, false)).toMatchObject({ ok: true, info: { format: 'dmg' } });
    expect(parseManifest(manifest({ ...zipApp, format: ' ZIP ' }), TARGET, false)).toMatchObject({ ok: true, info: { format: 'zip' } });
    expect(parseManifest(manifest({ ...zipApp, format: 'exe' }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    const win = 'x86_64-pc-windows-msvc';
    expect(parseManifest(manifest({ ...zipApp, format: 'exe' }, { target: win }), win, false)).toMatchObject({ ok: true, info: { format: 'exe' } });
    expect(parseManifest(manifest({ ...zipApp, format: 'zip' }, { target: win }), win, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest({ ...zipApp, format: undefined }, { target: win }), win, false)).toMatchObject({ ok: false, error: 'artifact' });
  });

  it('不合格的清单一律拒绝', () => {
    expect(parseManifest('not json', TARGET, false)).toMatchObject({ ok: false, error: 'decode' });
    expect(parseManifest('[]', TARGET, false)).toMatchObject({ ok: false, error: 'decode' });
    expect(parseManifest(manifest(zipApp, { build: '57' }), TARGET, false)).toMatchObject({ ok: false, error: 'decode' });
    expect(parseManifest(manifest(zipApp, { schema: 2 }), TARGET, false)).toMatchObject({ ok: false, error: 'schema' });
    expect(parseManifest(manifest(zipApp, { target: 'x86_64-pc-windows-msvc' }), TARGET, false)).toMatchObject({ ok: false, error: 'target' });
    expect(parseManifest(manifest(zipApp, { version: '  ' }), TARGET, false)).toMatchObject({ ok: false, error: 'release' });
    expect(parseManifest(manifest(zipApp, { build: 0 }), TARGET, false)).toMatchObject({ ok: false, error: 'release' });
    expect(parseManifest(manifest(zipApp, { app: undefined }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest({ ...zipApp, size: 0 }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest({ ...zipApp, sha256: 'abc' }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest({ ...zipApp, sha256: 'g'.repeat(64) }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest({ ...zipApp, url: 'http://baocut.app/a.zip' }), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
  });

  it('清单写了变体时必须是本构建的变体；没写的照读', () => {
    const win = 'x86_64-pc-windows-msvc';
    const exe = { ...zipApp, format: 'exe' };
    const doc = (variant?: string) => manifest(exe, { target: win, minimumSystemVersion: undefined, ...(variant ? { variant } : {}) });
    expect(parseManifest(doc('cuda'), win, false, 'cuda')).toMatchObject({ ok: true });
    expect(parseManifest(doc('cuda'), win, false, 'cpu')).toMatchObject({ ok: false, error: 'target' });
    expect(parseManifest(doc('cuda'), win, false, null)).toMatchObject({ ok: false, error: 'target' });
    expect(parseManifest(doc('cpu'), win, false, null)).toMatchObject({ ok: true });
    expect(parseManifest(doc('cpu'), win, false, 'vulkan')).toMatchObject({ ok: false, error: 'target' });
    expect(parseManifest(doc(), win, false, 'vulkan')).toMatchObject({ ok: true });
    expect(parseManifest(manifest(exe, { target: win, variant: 3 }), win, false, null)).toMatchObject({ ok: false, error: 'decode' });
  });

  it('打包脚本生成的清单能被应用读回', () => {
    const win = 'x86_64-pc-windows-msvc';
    const url = 'https://downloads.example/BaoCut-0.2.0-build.7-win-x64-cuda-setup.exe';
    const doc = releaseManifest({
      target: win,
      variant: 'cuda',
      version: '0.2.0',
      build: 7,
      date: '2026-10-05',
      format: 'exe',
      url,
      size: 168090225,
      sha256: SHA,
    });
    expect(parseManifest(JSON.stringify(doc), win, false, 'cuda')).toEqual({
      ok: true,
      info: {
        version: '0.2.0',
        build: 7,
        date: '2026-10-05',
        minimumSystemVersion: null,
        notes: '',
        notesLocalized: {},
        format: 'exe',
        url,
        size: 168090225,
        sha256: SHA.toLowerCase(),
      },
      rollout: null,
    });
    expect(doc).not.toHaveProperty('rolloutHours');
    expect(doc).not.toHaveProperty('releasedAt');
    expect(parseManifest(JSON.stringify(doc), win, false, null)).toMatchObject({ ok: false, error: 'target' });
    expect(fileName({ url, build: 7, format: 'exe' })).toBe('BaoCut-0.2.0-build.7-win-x64-cuda-setup.exe');
  });

  it('分批推送的两个键都成形才分批；写错了当不分批，清单照读', () => {
    const at = '2026-10-05T08:00:00Z';
    const ms = Date.parse(at);
    const read = (extra: Record<string, unknown>) => parseManifest(manifest(zipApp, extra), TARGET, false);
    expect(read({ rolloutHours: 48, releasedAt: at })).toMatchObject({ ok: true, rollout: { hours: 48, releasedAt: ms } });
    expect(read({ rolloutHours: 1.5, releasedAt: '2026-10-05T16:00:00.250+08:00' })).toMatchObject({
      ok: true,
      rollout: { hours: 1.5, releasedAt: ms + 250 },
    });
    for (const extra of [
      {},
      { rolloutHours: 48 },
      { releasedAt: at },
      { rolloutHours: 0, releasedAt: at },
      { rolloutHours: -1, releasedAt: at },
      { rolloutHours: '48', releasedAt: at },
      { rolloutHours: 48, releasedAt: '2026-10-05' },
      { rolloutHours: 48, releasedAt: '2026-10-05T08:00:00' },
      { rolloutHours: 48, releasedAt: '2026-13-45T08:00:00Z' },
      { rolloutHours: 48, releasedAt: 1759651200000 },
    ]) {
      expect(read(extra), JSON.stringify(extra)).toMatchObject({ ok: true, info: { build: 57 }, rollout: null });
    }
    // JSON 写不出 Infinity / NaN（变成 null），也当不分批。
    expect(read({ rolloutHours: Infinity, releasedAt: at })).toMatchObject({ ok: true, rollout: null });
  });

  it('打包脚本写的分批字段能被读回', () => {
    const win = 'x86_64-pc-windows-msvc';
    const releasedAt = '2026-10-05T08:00:00.000Z';
    const doc = releaseManifest({
      target: win,
      variant: 'cpu',
      version: '0.2.0',
      build: 7,
      date: '2026-10-05',
      format: 'exe',
      url: 'https://downloads.example/BaoCut-0.2.0-build.7-win-x64-setup.exe',
      size: 1024,
      sha256: SHA,
      rolloutHours: 72,
      releasedAt,
    });
    expect(doc).toMatchObject({ rolloutHours: 72, releasedAt });
    expect(parseManifest(JSON.stringify(doc), win, false, null)).toMatchObject({
      ok: true,
      info: { build: 7 },
      rollout: { hours: 72, releasedAt: Date.parse(releasedAt) },
    });
  });

  it('本地安装包地址只在更新源被覆盖时允许', () => {
    const local = { ...zipApp, url: 'file:///tmp/BaoCut.zip' };
    expect(parseManifest(manifest(local), TARGET, false)).toMatchObject({ ok: false, error: 'artifact' });
    expect(parseManifest(manifest(local), TARGET, true)).toMatchObject({ ok: true, info: { url: 'file:///tmp/BaoCut.zip' } });
  });

  it('不安全的文件名改用 BaoCut-<build>.<ext>', () => {
    expect(fileName(info)).toBe('BaoCut-2.3.0-build.57-aarch64-apple-darwin.zip');
    expect(fileName({ ...info, url: 'https://x/a/BaoCut%202.zip?sig=1#x' })).toBe('BaoCut 2.zip');
    for (const url of [
      'https://x/',
      'https://x/..',
      'https://x/.hidden',
      'https://x/a%2Fb.zip',
      'https://x/a%5Cb.zip',
      'https://x/c%3A.zip',
      'https://x/a%0Ab',
    ]) {
      expect(fileName({ ...info, url }), url).toBe('BaoCut-57.zip');
    }
  });
});

describe('版本', () => {
  it('点分版本号按段比较，缺的段当 0', () => {
    expect(compareVersions('14.0', '14.2.1')).toBe(-1);
    expect(compareVersions('14.2', '14.2.0')).toBe(0);
    expect(compareVersions('15', '14.9')).toBe(1);
    expect(compareVersions('14.x', '14.0')).toBe(0);
  });

  it('最低系统版本只在 macOS 上拦', () => {
    expect(systemRequirementUnmet({ minimumSystemVersion: '15.0' }, '14.5.0', true)).toBe('15.0');
    expect(systemRequirementUnmet({ minimumSystemVersion: '14.0' }, '14.5.0', true)).toBeNull();
    expect(systemRequirementUnmet({ minimumSystemVersion: '15.0' }, '14.5.0', false)).toBeNull();
    expect(systemRequirementUnmet({ minimumSystemVersion: null }, '14.5.0', true)).toBeNull();
    expect(systemRequirementUnmet({ minimumSystemVersion: '15.0' }, null, true)).toBeNull();
  });

  it('只比 build', () => {
    expect(isNewer({ build: 57 }, 56)).toBe(true);
    expect(isNewer({ build: 56 }, 56)).toBe(false);
  });
});

describe('何时启用', () => {
  const packagedMac: UpdateEnvironment = {
    appStore: false,
    build: 57,
    feedOverride: false,
    hasFeedTarget: true,
    packaged: true,
    windows: false,
    bundleId: 'com.jimliu.baocut',
    exeInAppBundle: true,
  };

  it('照契约判断', () => {
    expect(availability(packagedMac)).toBeNull();
    expect(availability({ ...packagedMac, appStore: true })).toBe('appStore');
    expect(availability({ ...packagedMac, packaged: false })).toBe('dev');
    expect(availability({ ...packagedMac, packaged: false, feedOverride: true })).toBeNull();
    expect(availability({ ...packagedMac, hasFeedTarget: false })).toBe('dev');
    expect(availability({ ...packagedMac, bundleId: 'com.github.Electron' })).toBe('dev');
    expect(availability({ ...packagedMac, exeInAppBundle: false })).toBe('dev');
    expect(availability({ ...packagedMac, windows: true, bundleId: null, exeInAppBundle: false })).toBeNull();
  });

  it('没写 build 号的包不检查更新，除非覆盖了更新源', () => {
    const packagedWindows = { ...packagedMac, windows: true, bundleId: null, exeInAppBundle: false };
    expect(availability({ ...packagedWindows, build: 0 })).toBe('dev');
    expect(availability({ ...packagedMac, build: 0 })).toBe('dev');
    expect(availability({ ...packagedWindows, build: 0, feedOverride: true })).toBeNull();
  });

  it('认得 .app 里的可执行文件', () => {
    expect(exeInAppBundle('/Applications/BaoCut.app/Contents/MacOS/BaoCut')).toBe(true);
    expect(exeInAppBundle('/Applications/BaoCut.APP/Contents/MacOS/BaoCut')).toBe(true);
    expect(exeInAppBundle('/usr/local/bin/electron')).toBe(false);
    expect(appBundleFromExecutable('/Applications/BaoCut.app/Contents/Frameworks/X.app/Contents/MacOS/X')).toBe(
      '/Applications/BaoCut.app/Contents/Frameworks/X.app',
    );
    expect(appBundleFromExecutable('/usr/local/bin/electron')).toBeNull();
  });

  it('缓存目录按平台', () => {
    expect(cacheDirectory('darwin', '/Users/a', {})).toBe('/Users/a/Library/Caches/BaoCut/Updates');
    expect(cacheDirectory('linux', '/home/a', {})).toBe('/home/a/.cache/BaoCut/Updates');
    expect(cacheDirectory('linux', '/home/a', { XDG_CACHE_HOME: '/c' })).toBe('/c/BaoCut/Updates');
    expect(cacheDirectory('darwin', '', {})).toBeNull();
  });
});

describe('节奏', () => {
  it('启动后第一拍总是查，之后满 6 小时再查，时钟回拨当到期', () => {
    const now = 1_000_000;
    expect(shouldAutoCheck(true, now - 10, now)).toBe(true);
    expect(shouldAutoCheck(false, null, now)).toBe(true);
    expect(shouldAutoCheck(false, now - 10, now)).toBe(false);
    expect(shouldAutoCheck(false, now - CHECK_INTERVAL_S, now)).toBe(true);
    expect(shouldAutoCheck(false, now + 100, now)).toBe(true);
  });
});

describe('分批推送', () => {
  const releasedAt = Date.UTC(2026, 9, 5, 8, 0, 0);
  const hour = 3600 * 1000;
  const rollout = { hours: 10, releasedAt };

  it('放开的比例从发布时刻起线性涨到 1；发布之前是 0；不分批是 1', () => {
    expect(rolloutFraction(null, releasedAt - hour)).toBe(1);
    expect(rolloutFraction(rollout, releasedAt - hour)).toBe(0);
    expect(rolloutFraction(rollout, releasedAt)).toBe(0);
    expect(rolloutFraction(rollout, releasedAt + 2.5 * hour)).toBe(0.25);
    expect(rolloutFraction(rollout, releasedAt + 10 * hour)).toBe(1);
    expect(rolloutFraction(rollout, releasedAt + 100 * hour)).toBe(1);
  });

  it('位置落在已放开的部分里才推；边界上不推，放满了都推', () => {
    expect(rolloutAdmits(0, 0)).toBe(false);
    expect(rolloutAdmits(0.25, 0.2499)).toBe(true);
    expect(rolloutAdmits(0.25, 0.25)).toBe(false);
    expect(rolloutAdmits(1, 0.999999)).toBe(true);
    expect(rolloutAdmits(rolloutFraction(null, 0), bucketFromId('ffffffff-ffff-4fff-bfff-ffffffffffff'))).toBe(true);
  });

  it('安装标识 → [0, 1) 的位置', () => {
    expect(isInstallationId('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).toBe(true);
    expect(isInstallationId('not-an-id')).toBe(false);
    expect(isInstallationId('')).toBe(false);
    expect(bucketFromId('00000000-0000-4000-8000-000000000000')).toBe(0);
    expect(bucketFromId('80000000-0000-4000-8000-000000000000')).toBe(0.5);
    expect(bucketFromId('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeLessThan(1);
  });
});

describe('状态机', () => {
  const info2: AppUpdateInfo = { ...info, version: '2.3.1', build: 58 };

  it('检查 → 有新版本 → 下载 → 已下载 → 安装', () => {
    let s: AppUpdateState = { k: 'idle' };
    s = reduce(s, { type: 'check' });
    expect(s).toEqual({ k: 'checking' });
    expect(reduce(s, { type: 'none' })).toEqual({ k: 'upToDate' });
    s = reduce(s, { type: 'found', info });
    expect(s).toEqual({ k: 'available', info });
    s = reduce(s, { type: 'download' });
    expect(s).toEqual({ k: 'downloading', info, pct: 0 });
    s = reduce(s, { type: 'progress', pct: 41.6 });
    expect(s).toMatchObject({ pct: 42 });
    expect(reduce(s, { type: 'progress', pct: 140 })).toMatchObject({ pct: 100 });
    expect(reduce(s, { type: 'cancel' })).toEqual({ k: 'available', info });
    expect(reduce(s, { type: 'check' })).toBe(s);
    s = reduce(s, { type: 'downloaded', path: '/tmp/x.zip' });
    expect(s).toEqual({ k: 'ready', info, path: '/tmp/x.zip' });
    s = reduce(s, { type: 'install' });
    expect(s).toEqual({ k: 'installing', info });
    expect(reduce(s, { type: 'fail', failure: 'signature' })).toEqual({ k: 'error', failure: 'signature', info });
  });

  it('缓存里有同一 build 时直接进校验段；系统不够时停在有新版本、点了也不下', () => {
    const verifyingCached = reduce({ k: 'checking' }, { type: 'found', info, cached: '/c/x.zip' });
    expect(verifyingCached).toEqual({ k: 'downloading', info, pct: 100 });
    expect(verifying(verifyingCached)).toBe(true);
    expect(verifying({ k: 'downloading', info, pct: 99 })).toBe(false);
    expect(reduce(verifyingCached, { type: 'progress', pct: 100 })).toBe(verifyingCached);
    expect(reduce(verifyingCached, { type: 'downloaded', path: '/c/x.zip' })).toEqual({ k: 'ready', info, path: '/c/x.zip' });
    expect(reduce(verifyingCached, { type: 'cancel' })).toEqual({ k: 'available', info });
    const unmet = reduce({ k: 'checking' }, { type: 'found', info, systemUnmet: '27.0', cached: '/c/x.zip' });
    expect(unmet).toEqual({ k: 'available', info, systemUnmet: '27.0' });
    expect(reduce(unmet, { type: 'download' })).toBe(unmet);
  });

  it('两种失败：检查失败不带版本，下载失败带着版本可以重下', () => {
    expect(reduce({ k: 'checking' }, { type: 'fail', failure: 'check' })).toEqual({ k: 'error', failure: 'check', info: null });
    const verify = reduce({ k: 'downloading', info, pct: 90 }, { type: 'fail', failure: 'verify' });
    expect(verify).toEqual({ k: 'error', failure: 'verify', info });
    expect(reduce(verify, { type: 'download' })).toEqual({ k: 'downloading', info, pct: 0 });
    expect(reduce({ k: 'error', failure: 'check', info: null }, { type: 'check' })).toEqual({ k: 'checking' });
  });

  it('自动检查：有新版本、已下载静默，手动检查照旧', () => {
    const available: AppUpdateState = { k: 'available', info };
    const unmet: AppUpdateState = { k: 'available', info, systemUnmet: '27.0' };
    const ready: AppUpdateState = { k: 'ready', info, path: '/tmp/x.zip' };
    expect(reduce(ready, { type: 'check' })).toEqual({ k: 'checking' });
    const blocked: AppUpdateState[] = [
      { k: 'unsupported', why: 'dev' },
      { k: 'checking' },
      { k: 'downloading', info, pct: 10 },
      { k: 'installing', info },
      { ...available, bg: true },
      { ...ready, bg: true },
    ];
    for (const s of blocked) expect(mayAutoCheck(s), s.k).toBe(false);
    const allowed: AppUpdateState[] = [
      { k: 'idle' },
      { k: 'upToDate' },
      { k: 'error', failure: 'check', info: null },
      available,
      unmet,
      ready,
    ];
    for (const s of allowed) expect(mayAutoCheck(s), s.k).toBe(true);

    for (const start of [available, unmet]) {
      const bg = reduce(start, { type: 'check', auto: true });
      expect(bg).toEqual({ ...start, bg: true });
      expect(reduce(bg, { type: 'fail', failure: 'check' })).toEqual(start);
      expect(reduce(bg, { type: 'none' })).toEqual({ k: 'upToDate' });
      expect(reduce(bg, { type: 'found', info: info2 })).toEqual({ k: 'available', info: info2 });
      expect(reduce(start, { type: 'check' })).toEqual({ k: 'checking' });
    }
    expect(reduce({ ...available, bg: true }, { type: 'download' })).toEqual({ k: 'downloading', info, pct: 0 });
    // 静默检查在途时用户开了下载：晚到的结果不把下载冲回有新版本
    const downloading = reduce({ ...available, bg: true }, { type: 'download' });
    expect(reduce(downloading, { type: 'found', info: info2 })).toBe(downloading);
    expect(reduce(downloading, { type: 'none' })).toBe(downloading);
  });

  it('已下载时的静默检查：结果逐条落地（设计稿 2026-10-05）', () => {
    const ready: AppUpdateState = { k: 'ready', info, path: '/c/57.zip' };
    const bg = reduce(ready, { type: 'check', auto: true });
    expect(bg).toEqual({ ...ready, bg: true });
    expect(reduce(bg, { type: 'check', auto: true })).toBe(bg);
    expect(reduce(bg, { type: 'found', info }), '同一个 build：留在已下载').toEqual(ready);
    expect(reduce(bg, { type: 'found', info: info2 }), '更新的 build：旧下载作废').toEqual({ k: 'available', info: info2 });
    expect(reduce(bg, { type: 'found', info: info2, systemUnmet: '28.0' }), '更新的 build 本机装不了：留着这版').toEqual(ready);
    expect(reduce(bg, { type: 'found', info: info2, cached: '/c/58.zip' }), '更新的 build 已在缓存里：进校验段').toEqual({
      k: 'downloading',
      info: info2,
      pct: 100,
    });
    const bg58: AppUpdateState = { k: 'ready', info: info2, path: '/c/58.zip', bg: true };
    expect(reduce(bg58, { type: 'found', info }), '已下载的 58 被撤、更新源退回 57：以更新源为准').toEqual({ k: 'available', info });
    expect(reduce(bg, { type: 'none' }), '更新源里没有更新的了：不装已撤回的版本').toEqual({ k: 'upToDate' });
    expect(reduce(bg, { type: 'fail', failure: 'check' }), '网络抖动不丢下载好的更新').toEqual(ready);
    // 在途时点「重启并更新」照常安装，标记不带进安装态；之后晚到的结果作废
    const installing = reduce(bg, { type: 'install' });
    expect(installing).toEqual({ k: 'installing', info });
    expect(reduce(installing, { type: 'none' })).toBe(installing);
    // 不是静默检查在途的已下载，不吃检查结果
    for (const ev of [{ type: 'found', info: info2 }, { type: 'none' }] as const) expect(reduce(ready, ev), ev.type).toBe(ready);
  });

  it('分批推送没轮到本机：手里已有新版本的保持原态，别的起点到已是最新', () => {
    const available: AppUpdateState = { k: 'available', info };
    const ready: AppUpdateState = { k: 'ready', info, path: '/c/57.zip' };
    for (const start of [available, ready]) {
      expect(reduce({ ...start, bg: true }, { type: 'none', heldBack: true }), start.k).toEqual(start);
    }
    expect(reduce({ k: 'checking' }, { type: 'none', heldBack: true })).toEqual({ k: 'upToDate' });
    expect(reduce(ready, { type: 'none', heldBack: true })).toBe(ready);
  });

  it('不检查更新时不吃任何事件', () => {
    const dev: AppUpdateState = { k: 'unsupported', why: 'dev' };
    for (const ev of [{ type: 'check' }, { type: 'found', info }, { type: 'fail', failure: 'check' }, { type: 'download' }] as const) {
      expect(reduce(dev, ev)).toBe(dev);
    }
  });
});

describe('检查之后', () => {
  const report: CheckReport = { info, heldBack: false, cached: null, canAutoInstall: true, systemUnmet: null };
  const available: AppUpdateState = { k: 'available', info };

  it('按发起方、落地的状态、自动下载与能否自动换包决定', () => {
    expect(followup('auto', true, { ...report, info: null }, { k: 'upToDate' })).toBe('none');
    expect(followup('auto', true, report, available)).toBe('download');
    expect(followup('auto', false, report, available)).toBe('toastAvailable');
    expect(followup('auto', true, { ...report, canAutoInstall: false }, available)).toBe('toastAvailable');
    expect(followup('manual', true, report, available)).toBe('none');
    const cached = { ...report, cached: '/c/x.zip' };
    expect(followup('auto', true, cached, { k: 'downloading', info, pct: 100 })).toBe('verify');
    expect(followup('manual', true, cached, { k: 'downloading', info, pct: 100 }), '缓存里的也要校验完才到已下载').toBe('verify');
    const unmet = { ...report, systemUnmet: '27.0' };
    expect(followup('auto', true, unmet, { k: 'available', info, systemUnmet: '27.0' })).toBe('none');
    // 已下载时的静默检查留在已下载（同一个 build、更新的但系统不够）：不跟进
    expect(followup('auto', true, report, { k: 'ready', info, path: '/c/x.zip' })).toBe('none');
    expect(followup('auto', true, unmet, { k: 'ready', info, path: '/c/x.zip' })).toBe('none');
  });

  it('进度节流：变了且隔 250 ms 才推，100 不跳过', () => {
    expect(progressDue(null, 0, 0)).toBe(true);
    expect(progressDue(10, 10, 1000)).toBe(false);
    expect(progressDue(10, 11, 100)).toBe(false);
    expect(progressDue(10, 11, 250)).toBe(true);
    expect(progressDue(99, 100, 1)).toBe(true);
    expect(percent(0, 0)).toBe(0);
    expect(percent(512, 1024)).toBe(50);
    expect(percent(2048, 1024)).toBe(100);
    expect(percent(1023, 1024)).toBe(99);
  });
});

describe('命令输出与换包脚本', () => {
  it('从 codesign 的输出读 Team ID', () => {
    expect(teamIdentifier('Executable=/A\nTeamIdentifier=ABCDE12345\n')).toBe('ABCDE12345');
    expect(teamIdentifier('TeamIdentifier=not set')).toBeNull();
    expect(teamIdentifier('Identifier=x')).toBeNull();
  });

  it('从 hdiutil 的输出读挂载点', () => {
    const output = 'warning: deprecated\n/dev/disk4\tGUID_partition_scheme\t\n/dev/disk4s1\tApple_HFS\t/Volumes/BaoCut 2.3.0\n';
    expect(mountPath(output)).toBe('/Volumes/BaoCut 2.3.0');
    expect(mountPath('nothing')).toBeNull();
  });

  const plan: InstallerPlan = {
    pid: 4242,
    newApp: "/Users/a/Library/Caches/BaoCut/Updates/unpack-57/BaoCut's.app",
    target: '/Applications/BaoCut.app',
    mount: null,
    archive: '/Users/a/Library/Caches/BaoCut/Updates/BaoCut.zip',
    unpacked: '/Users/a/Library/Caches/BaoCut/Updates/unpack-57',
    script: '/Users/a/Library/Caches/BaoCut/Updates/install-4242.sh',
    relaunch: true,
  };

  it('脚本引号转义、留回滚、ZIP 不 detach', () => {
    const result = installerScript(plan);
    expect(result.ok).toBe(true);
    const script = result.ok ? result.script : '';
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    expect(script).toContain("NEW_APP='/Users/a/Library/Caches/BaoCut/Updates/unpack-57/BaoCut'\\''s.app'");
    expect(script).toContain("STAGING='/Applications/.BaoCut.app.incoming'");
    expect(script).toContain("BACKUP='/Applications/.BaoCut.app.previous'");
    expect(script).toContain('PID=4242');
    expect(script).toContain('/bin/mv "$BACKUP" "$TARGET"');
    expect(script).toContain('/bin/rm -rf "$UNPACKED"');
    expect(script).not.toContain('hdiutil');
    const dmg = installerScript({ ...plan, mount: '/Volumes/BaoCut', unpacked: null });
    expect(dmg.ok && dmg.script).toContain('/usr/bin/hdiutil detach "$MOUNT" -quiet');
    // 换完、回滚（三处）都打开应用
    expect(script.match(/\/usr\/bin\/open "\$TARGET"/g)).toHaveLength(4);
  });

  it('退出即安装：换完、回滚都不打开应用', () => {
    const result = installerScript({ ...plan, relaunch: false });
    expect(result.ok).toBe(true);
    const script = result.ok ? result.script : '';
    expect(script).not.toContain('/usr/bin/open');
    expect(script).toContain('/bin/mv "$BACKUP" "$TARGET"');
    expect(script.match(/exit 1/g)).toHaveLength(3);
    expect(script).toContain('/bin/rm -f "$SELF"');
  });

  it('拒绝不安全的目标', () => {
    for (const target of ['/BaoCut.app', '/Applications/BaoCut', 'Applications/BaoCut.app', '/Applications/']) {
      expect(installerScript({ ...plan, target }).ok, target).toBe(false);
    }
  });
});
