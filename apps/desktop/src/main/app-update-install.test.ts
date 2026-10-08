import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateInfo } from '@baocut/ui';
import {
  NSIS_QUIT_ARGS,
  NSIS_UPDATE_ARGS,
  createPendingLaunch,
  installMac,
  installWindows,
  macCanAutoInstall,
  nsisInstalledCopy,
  prepareMac,
  type Exec,
  type ExecResult,
  type MacInstallDeps,
} from './app-update-install.ts';
import type { StagedApp } from './app-update-service.ts';

/*
 * 换包只用假的 exec：ditto 在临时目录里建一个只有 Info.plist 的 BaoCut.app，plutil / codesign / spctl / hdiutil 给预设的输出。
 * 生成的脚本只检查写出来没有，从不运行。
 */

const TEAM = 'ABCDE12345';

let root: string;
let cacheDir: string;
const running = '/Applications/BaoCut.app';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-install-'));
  cacheDir = path.join(root, 'cache');
  await fs.mkdir(cacheDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const info = (format: AppUpdateInfo['format'] = 'zip'): AppUpdateInfo => ({
  version: '2.3.0',
  build: 57,
  date: '2026-10-01',
  minimumSystemVersion: null,
  notes: '',
  notesLocalized: {},
  format,
  url: 'https://example.invalid/BaoCut.zip',
  size: 1,
  sha256: 'a'.repeat(64),
});

interface FakeOptions {
  plist?: Record<string, string>;
  newTeam?: string | null;
  runningTeam?: string | null;
  verifyFails?: boolean;
  spctlFails?: boolean;
  mount?: string;
}

/** 假的外部命令；记下每一条调用。ditto 解开（`-x`）或拷贝时在目标里建一个只有 Info.plist 的 BaoCut.app。 */
function fakeExec(options: FakeOptions = {}): { exec: Exec; calls: string[][] } {
  const plist = { CFBundleIdentifier: 'com.jimliu.baocut', CFBundleShortVersionString: '2.3.0', CFBundleVersion: '57', ...options.plist };
  const calls: string[][] = [];
  const ok = (stdout = '', stderr = ''): ExecResult => ({ code: 0, stdout, stderr });
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args]);
    const name = path.basename(file);
    if (name === 'ditto') {
      const app = args[0] === '-x' ? path.join(args[3] ?? '', 'BaoCut.app') : (args[1] ?? '');
      await fs.mkdir(path.join(app, 'Contents'), { recursive: true });
      await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), '');
      return ok();
    }
    if (name === 'plutil') return ok(`${plist[(args[1] ?? '') as keyof typeof plist] ?? ''}\n`);
    if (name === 'codesign' && args[0] === '-dv') {
      const team =
        args[2] === running ? (options.runningTeam === undefined ? TEAM : options.runningTeam) : options.newTeam === undefined ? TEAM : options.newTeam;
      return { code: 0, stdout: '', stderr: `Executable=${args[2]}\nTeamIdentifier=${team ?? 'not set'}\n` };
    }
    if (name === 'codesign') return options.verifyFails ? { code: 1, stdout: '', stderr: 'invalid signature' } : ok();
    if (name === 'spctl') return options.spctlFails ? { code: 3, stdout: '', stderr: 'rejected' } : ok();
    if (name === 'hdiutil' && args[0] === 'attach') return ok(`/dev/disk4\tGUID_partition_scheme\t\n/dev/disk4s1\tApple_HFS\t${options.mount ?? ''}\n`);
    if (name === 'hdiutil') return ok();
    return { code: 127, stdout: '', stderr: `unexpected ${file}` };
  };
  return { exec, calls };
}

function macDeps(exec: Exec, overrides: Partial<MacInstallDeps> = {}): MacInstallDeps {
  return {
    exec,
    runningBundle: running,
    writable: async () => true,
    cacheDir,
    pid: 4242,
    launchScript: vi.fn(async () => {}),
    ...overrides,
  };
}

const archive = () => path.join(cacheDir, 'BaoCut.zip');
const unpacked = () => path.join(cacheDir, 'unpack-57');
const stagedApp = (): StagedApp => ({ app: path.join(unpacked(), 'BaoCut.app'), dir: unpacked() });
const commandsOf = (calls: string[][]) => calls.map((c) => [path.basename(c[0] ?? ''), c[1]].join(' '));

describe('macOS 校验与就位', () => {
  it('能否自动换包：正式包、目录可写、有 Team ID', async () => {
    expect(await macCanAutoInstall(macDeps(fakeExec().exec))).toBe(true);
    expect(await macCanAutoInstall(macDeps(fakeExec().exec, { runningBundle: null }))).toBe(false);
    expect(await macCanAutoInstall(macDeps(fakeExec().exec, { writable: async () => false }))).toBe(false);
    expect(await macCanAutoInstall(macDeps(fakeExec({ runningTeam: null }).exec))).toBe(false);
  });

  it('ZIP：解到 unpack-<build>，校验身份 / 签名 / Team ID / 公证后就位；这一步不写脚本', async () => {
    const { exec, calls } = fakeExec();
    const deps = macDeps(exec);
    expect(await prepareMac(info(), archive(), deps)).toEqual({ type: 'staged', staged: stagedApp() });
    expect(commandsOf(calls)).toEqual(expect.arrayContaining(['ditto -x', 'codesign --verify', 'spctl --assess']));
    expect(await fs.readdir(cacheDir)).toEqual(['unpack-57']);
    expect(deps.launchScript).not.toHaveBeenCalled();
  });

  it('身份或版本对不上：报校验失败，清掉解开的目录', async () => {
    const deps = macDeps(fakeExec({ plist: { CFBundleVersion: '56' } }).exec);
    expect(await prepareMac(info(), archive(), deps)).toMatchObject({ type: 'failed', failure: 'verify' });
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it('签名、Team ID 或公证不过：报签名问题，清掉解开的目录', async () => {
    for (const options of [{ verifyFails: true }, { newTeam: 'ZZZZZ99999' }, { newTeam: null }, { spctlFails: true }] satisfies FakeOptions[]) {
      const outcome = await prepareMac(info(), archive(), macDeps(fakeExec(options).exec));
      expect(outcome, JSON.stringify(options)).toMatchObject({ type: 'failed', failure: 'signature' });
      expect(await fs.readdir(cacheDir)).toEqual([]);
    }
  });

  it('DMG：只读挂上；挂上了却找不到 .app 时卸下，挂不上报校验失败', async () => {
    // 挂载点按 hdiutil 的输出认 `/Volumes/…`，测试里建不出来，所以只走「里面没有 .app」这条路。
    const mount = '/Volumes/BaoCut update test that does not exist';
    const empty = fakeExec({ mount });
    const dmg = path.join(cacheDir, 'BaoCut.dmg');
    expect(await prepareMac(info('dmg'), dmg, macDeps(empty.exec))).toMatchObject({ type: 'failed', failure: 'verify' });
    expect(empty.calls[1]).toEqual(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-noverify', '-readonly', dmg]);
    expect(empty.calls).toContainEqual(['/usr/bin/hdiutil', 'detach', mount, '-quiet']);
    expect(await fs.readdir(cacheDir)).toEqual([]);

    const unmounted = fakeExec({ mount: 'nowhere' });
    expect(await prepareMac(info('dmg'), dmg, macDeps(unmounted.exec))).toMatchObject({ type: 'failed', failure: 'verify' });
  });

  it('Windows 的安装包不在 macOS 上装', async () => {
    const outcome = await prepareMac(info('exe'), path.join(cacheDir, 'BaoCut.exe'), macDeps(fakeExec().exec));
    expect(outcome).toMatchObject({ type: 'failed', failure: 'verify' });
  });

  it('这台机器不能自己换包时不就位', async () => {
    expect(await prepareMac(info(), archive(), macDeps(fakeExec().exec, { runningBundle: null }))).toEqual({ type: 'none' });
    expect(await prepareMac(info(), archive(), macDeps(fakeExec().exec, { writable: async () => false }))).toEqual({ type: 'none' });
    expect(await prepareMac(info(), archive(), macDeps(fakeExec({ runningTeam: null }).exec))).toEqual({ type: 'none' });
  });

  it('停了就不再往下跑，清掉解开的目录', async () => {
    const controller = new AbortController();
    const { exec, calls } = fakeExec();
    const stopping: Exec = async (file, args, signal) => {
      const result = await exec(file, args, signal);
      if (path.basename(file) === 'ditto') controller.abort();
      return result;
    };
    expect(await prepareMac(info(), archive(), macDeps(stopping), controller.signal)).toMatchObject({ type: 'failed', failure: 'verify' });
    expect(commandsOf(calls)).not.toContain('codesign --verify');
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });
});

describe('macOS 换包', () => {
  async function staged(): Promise<StagedApp> {
    const outcome = await prepareMac(info(), archive(), macDeps(fakeExec().exec));
    if (outcome.type !== 'staged') throw new Error('not staged');
    return outcome.staged;
  }

  it('就位的新包：只核对身份与版本，写好脚本并起它，不再解开、验签', async () => {
    const ready = await staged();
    const { exec, calls } = fakeExec();
    const deps = macDeps(exec);
    expect(await installMac(info(), archive(), deps, { staged: ready, relaunch: true })).toEqual({ type: 'launched' });
    const script = path.join(cacheDir, 'install-4242.sh');
    expect(deps.launchScript).toHaveBeenCalledWith(script, path.join(cacheDir, 'install.log'));
    const body = await fs.readFile(script, 'utf8');
    expect(body).toContain(`NEW_APP='${path.join(cacheDir, 'unpack-57', 'BaoCut.app')}'`);
    expect(body).toContain(`UNPACKED='${unpacked()}'`);
    expect(body).toContain("TARGET='/Applications/BaoCut.app'");
    expect(body).toContain('/usr/bin/open "$TARGET"');
    expect((await fs.stat(script)).mode & 0o777).toBe(0o700);
    expect(commandsOf(calls).every((c) => c.startsWith('plutil'))).toBe(true);
  });

  it('退出即安装：用就位的新包，换完不打开应用', async () => {
    const ready = await staged();
    const deps = macDeps(fakeExec().exec);
    expect(await installMac(info(), archive(), deps, { staged: ready, relaunch: false })).toEqual({ type: 'launched' });
    expect(await fs.readFile(path.join(cacheDir, 'install-4242.sh'), 'utf8')).not.toContain('/usr/bin/open');
  });

  it('就位的新包不在了：重启时从头解开校验，退出时不装', async () => {
    const ready = await staged();
    await fs.rm(unpacked(), { recursive: true });
    const quit = macDeps(fakeExec().exec);
    expect(await installMac(info(), archive(), quit, { staged: ready, relaunch: false })).toMatchObject({
      type: 'failed',
      failure: 'install',
    });
    expect(await installMac(info(), archive(), quit, { staged: null, relaunch: false })).toMatchObject({
      type: 'failed',
      failure: 'install',
    });
    expect(quit.launchScript).not.toHaveBeenCalled();

    const { exec, calls } = fakeExec();
    const restart = macDeps(exec);
    expect(await installMac(info(), archive(), restart, { staged: ready, relaunch: true })).toEqual({ type: 'launched' });
    expect(commandsOf(calls)).toEqual(expect.arrayContaining(['ditto -x', 'codesign --verify', 'spctl --assess']));
  });

  it('就位的新包被换过（版本对不上）：重启时从头校验，不过就报告', async () => {
    const ready = await staged();
    const deps = macDeps(fakeExec({ plist: { CFBundleVersion: '56' } }).exec);
    expect(await installMac(info(), archive(), deps, { staged: ready, relaunch: true })).toMatchObject({
      type: 'failed',
      failure: 'verify',
    });
    expect(deps.launchScript).not.toHaveBeenCalled();
  });

  it('这台机器不能自己换包时走手动', async () => {
    const options = { staged: null, relaunch: true };
    expect(await installMac(info(), archive(), macDeps(fakeExec().exec, { runningBundle: null }), options)).toEqual({ type: 'fallback' });
    expect(await installMac(info(), archive(), macDeps(fakeExec().exec, { writable: async () => false }), options)).toEqual({
      type: 'fallback',
    });
    expect(await installMac(info(), archive(), macDeps(fakeExec({ runningTeam: null }).exec), options)).toEqual({ type: 'fallback' });
  });

  it('起脚本失败算安装失败', async () => {
    const deps = macDeps(fakeExec().exec, {
      launchScript: async () => {
        throw new Error('spawn failed');
      },
    });
    expect(await installMac(info(), archive(), deps, { staged: await staged(), relaunch: true })).toMatchObject({
      type: 'failed',
      failure: 'install',
    });
  });
});

describe('Windows 换包', () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\baocut\\BaoCut.exe';

  it('exe 旁边有 NSIS 的卸载程序才是安装版', async () => {
    const seen: string[] = [];
    const present = async (file: string) => {
      seen.push(file);
      return true;
    };
    expect(await nsisInstalledCopy(exe, present)).toBe(true);
    expect(seen).toEqual(['C:\\Users\\me\\AppData\\Local\\Programs\\baocut\\Uninstall BaoCut.exe']);
    expect(await nsisInstalledCopy(exe, async () => false)).toBe(false);
    // Inno 的卸载程序不算。
    expect(await nsisInstalledCopy(exe, async (file) => file.endsWith('unins000.exe'))).toBe(false);
  });

  it('安装版记下安装器，等应用退出时再起；退出即安装装完不重新打开；zip 版走手动', async () => {
    const launchOnQuit = vi.fn();
    expect(await installWindows('C:\\cache\\BaoCut-setup.exe', { installedCopy: true, launchOnQuit })).toEqual({ type: 'launched' });
    expect(launchOnQuit).toHaveBeenCalledWith('C:\\cache\\BaoCut-setup.exe', ['/S', '--updated', '--force-run']);
    expect(NSIS_UPDATE_ARGS).toEqual(['/S', '--updated', '--force-run']);
    launchOnQuit.mockClear();
    expect(await installWindows('C:\\cache\\BaoCut-setup.exe', { installedCopy: true, launchOnQuit }, false)).toEqual({ type: 'launched' });
    expect(launchOnQuit).toHaveBeenCalledWith('C:\\cache\\BaoCut-setup.exe', ['/S', '--updated']);
    expect(NSIS_QUIT_ARGS).toEqual(['/S', '--updated']);
    launchOnQuit.mockClear();
    expect(await installWindows('C:\\cache\\BaoCut-setup.exe', { installedCopy: false, launchOnQuit })).toEqual({ type: 'fallback' });
    expect(launchOnQuit).not.toHaveBeenCalled();
  });

  it('退出时只起记下的最后一个，只起一次', () => {
    const spawned: [string, readonly string[]][] = [];
    const pending = createPendingLaunch(
      (file, args) => void spawned.push([file, args]),
      () => {},
    );
    expect(pending.fire()).toBe(false);
    pending.arm('C:\\cache\\old-setup.exe', NSIS_UPDATE_ARGS);
    pending.arm('C:\\cache\\new-setup.exe', NSIS_UPDATE_ARGS);
    expect(spawned).toEqual([]);
    expect(pending.fire()).toBe(true);
    expect(pending.fire()).toBe(false);
    expect(spawned).toEqual([['C:\\cache\\new-setup.exe', ['/S', '--updated', '--force-run']]]);
  });

  it('起不来只记日志，不抛', () => {
    const logs: string[] = [];
    const pending = createPendingLaunch(
      () => {
        throw new Error('ENOENT');
      },
      (message) => logs.push(message),
    );
    pending.arm('C:\\cache\\setup.exe', NSIS_UPDATE_ARGS);
    expect(pending.fire()).toBe(false);
    expect(logs).toEqual(['起安装器失败：ENOENT']);
  });
});
