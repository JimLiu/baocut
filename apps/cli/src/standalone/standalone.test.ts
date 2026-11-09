import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STANDALONE_FEED_ENV, STANDALONE_MANIFEST_FILE, STANDALONE_PRODUCT, standaloneLayout } from '@baocut/protocol';
import * as runtimeEntry from '../../../../packages/runtime-core/src/agent-tools/cli-entry.ts';
import { CliError } from '../envelope.ts';
import { standalonePackageAt, type StandalonePackage } from '../runtime/connection.ts';
import { captureOutput } from '../testing/fake-client.ts';
import { standaloneCli, standaloneUpdate, versionLabel, type StandaloneIo } from './command.ts';
import { FORWARDER_MARK, StandaloneInstaller, WINDOWS_USER_PATH_SCRIPT, forwarderScript, parseForwarder, pathHint, type CommandRunner } from './install.ts';
import { collectGarbage, download, rollbackStandalone, updateStandalone } from './update.ts';
import { S } from './standalone-copy.ts';

/**
 * 独立包的 `cli install|status|remove` 与 `baocut update`：在临时主目录里放假的包（布局与清单真实，Node 与启动器是空文件），
 * 命令（`ditto`、`codesign`、`spctl`）换成假的。归档也是假的：一段 JSON 指向要“解开”的目录。
 */

const layout = standaloneLayout('darwin')!;
let tmp: string;
let userHome: string;
let runtimeHome: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-standalone-')));
  userHome = path.join(tmp, 'user');
  runtimeHome = path.join(tmp, 'runtime-home');
  fs.mkdirSync(userHome, { recursive: true });
  fs.mkdirSync(runtimeHome, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makePackage(root: string, version: string, build: number): StandalonePackage {
  const at = (segments: readonly string[]) => path.join(root, ...segments);
  fs.mkdirSync(at(layout.app), { recursive: true });
  fs.mkdirSync(path.dirname(at(layout.node)), { recursive: true });
  for (const file of [layout.node, layout.launcher, layout.disclaim!]) fs.writeFileSync(at(file), '#!/bin/sh\n', { mode: 0o755 });
  const manifest = { schema: 1, product: STANDALONE_PRODUCT, version, build, target: 'aarch64-apple-darwin', variant: 'cpu', sourceCommit: null, node: '24.22.1' };
  fs.writeFileSync(at([...layout.app, STANDALONE_MANIFEST_FILE]), JSON.stringify(manifest));
  return standalonePackageAt(root, 'darwin')!;
}

interface FakeRun {
  run: CommandRunner;
  calls: string[][];
}

/** `ditto` 复制目录、“解开”假归档；`codesign -dv` 给 `team`；`codesign --verify` 与 `spctl` 按 `verify` 成败。 */
function fakeRun(options: { team?: string | null; verify?: boolean; spctl?: boolean } = {}): FakeRun {
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === '/usr/bin/ditto' && args[0] === '-x') {
      const { dir } = JSON.parse(fs.readFileSync(args[2]!, 'utf8')) as { dir: string };
      fs.cpSync(dir, args[3]!, { recursive: true, verbatimSymlinks: true });
      return { ok: true, stdout: '', stderr: '' };
    }
    if (command === '/usr/bin/ditto') {
      fs.cpSync(args[0]!, args[1]!, { recursive: true, verbatimSymlinks: true });
      return { ok: true, stdout: '', stderr: '' };
    }
    if (command === '/usr/bin/codesign' && args[0] === '-dv') {
      const team = options.team === undefined ? null : options.team;
      return { ok: !!team, stdout: '', stderr: team ? `Identifier=com.baocut.cli\nTeamIdentifier=${team}\n` : 'code object is not signed at all\n' };
    }
    if (command === '/usr/bin/codesign') return { ok: options.verify !== false, stdout: '', stderr: options.verify === false ? 'a sealed resource is missing or invalid' : '' };
    if (command === '/usr/sbin/spctl') return { ok: options.spctl !== false, stdout: '', stderr: options.spctl === false ? 'rejected' : '' };
    if (command === '/usr/bin/sw_vers') return { ok: true, stdout: '26.0\n', stderr: '' };
    return { ok: false, stdout: '', stderr: `unexpected ${command}` };
  };
  return { run, calls };
}

/** 假归档 + 指向它的更新源；返回更新源文件的路径。 */
function publish(version: string, build: number, extra: { minimumSystemVersion?: string; corrupt?: boolean } = {}): string {
  const source = path.join(tmp, 'published', `${version}-build.${build}`);
  makePackage(source, version, build);
  const archive = path.join(tmp, 'published', `BaoCut-CLI-${version}-build.${build}.zip`);
  const body = JSON.stringify({ dir: source });
  fs.writeFileSync(archive, body);
  const sha256 = createHash('sha256').update(extra.corrupt ? `${body}x` : body).digest('hex');
  const feed = path.join(tmp, 'published', 'appcast.json');
  fs.writeFileSync(
    feed,
    JSON.stringify({
      schema: 1,
      target: 'aarch64-apple-darwin',
      version,
      build,
      ...(extra.minimumSystemVersion ? { minimumSystemVersion: extra.minimumSystemVersion } : {}),
      app: { format: 'zip', url: 'https://example.invalid/app.zip', size: 1, sha256: '0'.repeat(64) },
      cli: { format: 'zip', url: `file://${archive}`, size: Buffer.byteLength(body), sha256 },
    }),
  );
  return feed;
}

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: userHome, PATH: `${path.join(userHome, '.local', 'bin')}:/usr/bin:/bin`, SHELL: '/bin/zsh', ...extra };
}

function installer(e = env(), run = fakeRun().run): StandaloneInstaller {
  return new StandaloneInstaller({ env: e, platform: 'darwin', run });
}

function io(e: NodeJS.ProcessEnv, own: StandalonePackage, run: CommandRunner, json = true) {
  const capture = captureOutput(json);
  const value: StandaloneIo = { output: capture.output, env: e, home: runtimeHome, own, platform: 'darwin', run, systemVersion: async () => '26.0' };
  return { capture, io: value };
}

const rejected = (code: string) => (error: unknown) => error instanceof CliError && error.code === code;

describe.skipIf(process.platform === 'win32')('独立包 baocut cli install|status|remove', () => {
  it('install 把包复制进版本目录、记成当前版本、在 ~/.local/bin 放指向它的软链接；再装一次不复制', async () => {
    const own = makePackage(path.join(tmp, 'Downloads', 'BaoCut CLI'), '3.17.0', 93);
    const fake = fakeRun();
    const e = env();
    const first = io(e, own, fake.run, false);
    expect(await standaloneCli(first.io, own, 'install')).toBe(0);
    const inst = installer(e);
    const launcher = path.join(inst.places.versions, '3.17.0-build.93', ...layout.launcher);
    expect(fs.readlinkSync(inst.places.entry)).toBe(launcher);
    expect(inst.readState()).toEqual({ current: '3.17.0-build.93', previous: null });
    expect(inst.versions()).toEqual(['3.17.0-build.93']);
    expect(first.capture.out()).toContain('~/.local/share/baocut/versions/3.17.0-build.93');
    expect(fake.calls.filter((c) => c[0] === '/usr/bin/ditto')).toHaveLength(1);

    // 从装好的那份再装：不复制，入口仍是当前。
    const installed = inst.packageAt('3.17.0-build.93')!;
    const again = io(e, installed, fake.run);
    expect(await standaloneCli(again.io, installed, 'install')).toBe(0);
    expect(fake.calls.filter((c) => c[0] === '/usr/bin/ditto')).toHaveLength(1);
    expect(again.capture.envelope().result).toMatchObject({ state: 'current', managed: true, installed: { current: '3.17.0-build.93' } });
  });

  it('入口位置已有别的东西（不是 BaoCut 放的）时拒绝，不复制包', async () => {
    const own = makePackage(path.join(tmp, 'Downloads', 'BaoCut CLI'), '3.17.0', 93);
    const e = env();
    const inst = installer(e);
    fs.mkdirSync(path.dirname(inst.places.entry), { recursive: true });
    fs.writeFileSync(inst.places.entry, '#!/bin/sh\necho mine\n');
    const fake = fakeRun();
    await expect(standaloneCli(io(e, own, fake.run).io, own, 'install')).rejects.toSatisfy(rejected('CLI_ENTRY_TAKEN'));
    expect(fake.calls).toEqual([]);
    expect(fs.readFileSync(inst.places.entry, 'utf8')).toContain('mine');
    await expect(standaloneCli(io(e, own, fake.run).io, own, 'remove')).rejects.toSatisfy(rejected('CLI_ENTRY_TAKEN'));
    expect(fs.existsSync(inst.places.entry)).toBe(true);
  });

  it('指向 App 的入口算 stale：install 改指向独立包；remove 只删链接，版本目录留着', async () => {
    const own = makePackage(path.join(tmp, 'Downloads', 'BaoCut CLI'), '3.17.0', 93);
    const appLauncher = path.join(tmp, 'Applications', 'BaoCut.app', 'Contents', 'MacOS', 'baocut-cli');
    fs.mkdirSync(path.dirname(appLauncher), { recursive: true });
    fs.writeFileSync(appLauncher, '#!/bin/sh\n', { mode: 0o755 });
    const e = env();
    const inst = installer(e);
    fs.mkdirSync(path.dirname(inst.places.entry), { recursive: true });
    fs.symlinkSync(appLauncher, inst.places.entry);
    expect(inst.inspect(null)).toMatchObject({ state: 'stale', ours: false });

    const fake = fakeRun();
    expect(await standaloneCli(io(e, own, fake.run).io, own, 'install')).toBe(0);
    expect(inst.inspect('3.17.0-build.93')).toMatchObject({ state: 'current', ours: true });

    const removed = io(e, own, fake.run, false);
    expect(await standaloneCli(removed.io, own, 'remove')).toBe(0);
    expect(fs.existsSync(inst.places.entry)).toBe(false);
    expect(inst.versions()).toEqual(['3.17.0-build.93']);
    expect(removed.capture.out()).toContain('~/.local/share/baocut/versions');

    const status = io(e, own, fake.run);
    expect(await standaloneCli(status.io, own, 'status')).toBe(0);
    expect(status.capture.envelope()).toMatchObject({ result: { state: 'none' }, next: `'${own.launcher}' cli install` });
    expect(await standaloneCli(status.io, own, 'nope')).toBeNull();
  });

  it('~/.local/bin 不在 PATH 上时给要加的那一行（与 App 的相同）', async () => {
    const own = makePackage(path.join(tmp, 'Downloads', 'BaoCut CLI'), '3.17.0', 93);
    const e = env({ PATH: '/usr/bin:/bin' });
    const out = io(e, own, fakeRun().run);
    expect(await standaloneCli(out.io, own, 'install')).toBe(0);
    expect(out.capture.envelope().result).toMatchObject({
      shell: { dirOnPath: false },
      pathHint: { line: 'export PATH="$HOME/.local/bin:$PATH"', file: '~/.zshrc' },
    });
  });
});

describe.skipIf(process.platform === 'win32')('独立包 baocut update', () => {
  async function installed(version = '3.17.0', build = 93, team: string | null = 'TEAM123') {
    const own = makePackage(path.join(tmp, 'Downloads', 'BaoCut CLI'), version, build);
    const e = env();
    await standaloneCli(io(e, own, fakeRun({ team }).run).io, own, 'install');
    const inst = installer(e);
    return { e, inst, own: inst.packageAt(`${version}-build.${build}`)! };
  }

  it('有新 build 时下载、校验、装在旁边、切换入口；上一版留着，--rollback 回去', async () => {
    const { e, inst, own } = await installed();
    const feed = publish('3.18.0', 101);
    const fake = fakeRun({ team: 'TEAM123' });
    const check = io({ ...e, [STANDALONE_FEED_ENV]: feed }, own, fake.run);
    expect(await standaloneUpdate(check.io, ['--check'])).toBe(0);
    expect(check.capture.envelope()).toMatchObject({ result: { available: true, updated: false, latest: '3.18.0-build.101' }, next: 'baocut update' });
    expect(inst.versions()).toEqual(['3.17.0-build.93']);

    const update = io({ ...e, [STANDALONE_FEED_ENV]: feed }, own, fake.run, false);
    expect(await standaloneUpdate(update.io, [])).toBe(0);
    expect(inst.readState()).toEqual({ current: '3.18.0-build.101', previous: '3.17.0-build.93' });
    expect(inst.versions()).toEqual(['3.17.0-build.93', '3.18.0-build.101']);
    expect(inst.inspect('3.18.0-build.101')).toMatchObject({ state: 'current', ours: true });
    expect(update.capture.out()).toContain(S.updated(versionLabel('3.17.0-build.93'), versionLabel('3.18.0-build.101')));
    expect(update.capture.err()).toContain(S.downloading('3.18.0', 101, 0));
    const verify = fake.calls.filter((c) => c[0] === '/usr/bin/codesign' || c[0] === '/usr/sbin/spctl').map((c) => c.slice(0, 2).join(' '));
    expect(verify).toEqual(['/usr/bin/codesign -dv', '/usr/bin/codesign --verify', '/usr/bin/codesign -dv', '/usr/sbin/spctl --assess']);
    // 临时目录与下载的归档都清掉了。
    expect(fs.readdirSync(inst.places.versions).filter((n) => n.startsWith('.'))).toEqual([]);

    const again = io({ ...e, [STANDALONE_FEED_ENV]: feed }, own, fake.run);
    expect(await standaloneUpdate(again.io, [])).toBe(0);
    expect(again.capture.envelope().result).toMatchObject({ available: false, updated: false, current: '3.18.0-build.101' });

    const back = io(e, own, fake.run);
    expect(await standaloneUpdate(back.io, ['--rollback'])).toBe(0);
    expect(back.capture.envelope().result).toMatchObject({ from: '3.18.0-build.101', to: '3.17.0-build.93', entry: { switched: true } });
    expect(inst.readState()).toEqual({ current: '3.17.0-build.93', previous: '3.18.0-build.101' });
    expect(inst.inspect('3.17.0-build.93').state).toBe('current');
  });

  it('再更新一次时删掉更老的版本，但留下还有 Runtime 在用的那个', async () => {
    const { e, inst, own } = await installed();
    const fake = fakeRun({ team: 'TEAM123' });
    await updateStandalone({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: publish('3.18.0', 101) }, home: runtimeHome, run: fake.run }, { check: false });
    // 一个 Runtime 还在跑 3.17：独立包 Runtime 的发现信息 entry 是包根，即那个版本目录（`installEntryOf`）。
    const oldEntry = inst.versionPath('3.17.0-build.93');
    fs.writeFileSync(path.join(runtimeHome, 'runtime.json'), JSON.stringify({ pid: process.pid, entry: oldEntry }));
    const result = await updateStandalone(
      { installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: publish('3.19.0', 110) }, home: runtimeHome, run: fake.run },
      { check: false },
    );
    expect(result).toMatchObject({ updated: true, removed: [], runtime: { pid: process.pid } });
    expect(inst.versions()).toEqual(['3.17.0-build.93', '3.18.0-build.101', '3.19.0-build.110']);

    // Runtime 停了：只留当前、上一版与本包。
    fs.rmSync(path.join(runtimeHome, 'runtime.json'));
    expect(collectGarbage(inst, ['3.19.0-build.110', '3.18.0-build.101', null], runtimeHome)).toEqual(['3.17.0-build.93']);
    // 发现信息里没有 entry 的旧版 Runtime 在跑：这次不删。
    fs.writeFileSync(path.join(runtimeHome, 'runtime.json'), JSON.stringify({ pid: process.pid }));
    expect(collectGarbage(inst, ['3.19.0-build.110', null, null], runtimeHome)).toEqual([]);
  });

  it('入口指向 App 或不在时更新不动它', async () => {
    const { e, inst, own } = await installed();
    const appLauncher = path.join(tmp, 'Applications', 'BaoCut.app', 'Contents', 'MacOS', 'baocut-cli');
    fs.mkdirSync(path.dirname(appLauncher), { recursive: true });
    fs.writeFileSync(appLauncher, '#!/bin/sh\n', { mode: 0o755 });
    fs.rmSync(inst.places.entry);
    fs.symlinkSync(appLauncher, inst.places.entry);
    const out = io({ ...e, [STANDALONE_FEED_ENV]: publish('3.18.0', 101) }, own, fakeRun({ team: 'TEAM123' }).run, false);
    expect(await standaloneUpdate(out.io, [])).toBe(0);
    expect(fs.readlinkSync(inst.places.entry)).toBe(appLauncher);
    expect(inst.readState().current).toBe('3.18.0-build.101');
    expect(out.capture.out()).toContain(S.entryLeftAlone('~/.local/bin/baocut'));
  });

  it('sha256 不对、签名或公证不过、Team ID 不同、系统太旧时不装', async () => {
    const { e, inst, own } = await installed();
    const deps = (feed: string, run: CommandRunner) => ({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: feed }, home: runtimeHome, run, systemVersion: async () => '26.0' });
    await expect(updateStandalone(deps(publish('3.18.0', 101, { corrupt: true }), fakeRun({ team: 'TEAM123' }).run), { check: false })).rejects.toSatisfy(
      rejected('UPDATE_DOWNLOAD_FAILED'),
    );
    await expect(updateStandalone(deps(publish('3.18.0', 101), fakeRun({ team: 'TEAM123', verify: false }).run), { check: false })).rejects.toSatisfy(
      rejected('UPDATE_VERIFY_FAILED'),
    );
    await expect(updateStandalone(deps(publish('3.18.0', 101), fakeRun({ team: 'TEAM123', spctl: false }).run), { check: false })).rejects.toSatisfy(
      rejected('UPDATE_VERIFY_FAILED'),
    );
    await expect(updateStandalone(deps(publish('3.18.0', 101, { minimumSystemVersion: '27.1' }), fakeRun({ team: 'TEAM123' }).run), { check: false })).rejects.toSatisfy(
      rejected('UPDATE_SYSTEM_TOO_OLD'),
    );
    // Team ID 不同：本包是 TEAM123，下载的是 OTHER。
    let n = 0;
    const mixed: CommandRunner = async (command, args, options) => {
      if (command === '/usr/bin/codesign' && args[0] === '-dv') {
        n += 1;
        return { ok: true, stdout: '', stderr: `TeamIdentifier=${n === 1 ? 'TEAM123' : 'OTHER99'}\n` };
      }
      return fakeRun({ team: 'TEAM123' }).run(command, args, options);
    };
    await expect(updateStandalone(deps(publish('3.18.0', 101), mixed), { check: false })).rejects.toSatisfy(rejected('UPDATE_VERIFY_FAILED'));
    expect(inst.versions()).toEqual(['3.17.0-build.93']);
    expect(inst.readState().current).toBe('3.17.0-build.93');
    expect(fs.readdirSync(inst.places.versions).filter((name) => name.startsWith('.'))).toEqual([]);
  });

  it('本包没签名时只在指定了更新源（演练）时放行；默认更新源拒绝本地文件', async () => {
    const { e, inst, own } = await installed('3.17.0', 93, null);
    const feed = publish('3.18.0', 101);
    const result = await updateStandalone({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: feed }, home: runtimeHome, run: fakeRun({ team: null }).run }, { check: false });
    expect(result.updated).toBe(true);
    // 没有覆盖时读的是 https 的默认更新源：这里换成一个给本地文件地址的 fetch，解析时应当拒绝。
    const text = fs.readFileSync(feed, 'utf8').replace(/3\.18\.0/g, '3.19.0').replace('"build":101', '"build":110');
    const fetchFeed = (async () => new Response(text)) as typeof fetch;
    await expect(updateStandalone({ installer: inst, own, env: e, home: runtimeHome, run: fakeRun({ team: null }).run, fetch: fetchFeed }, { check: false })).rejects.toSatisfy(
      rejected('UPDATE_FEED_FAILED'),
    );
  });

  it('更新源里没有 cli 条目、参数不对、不是独立包、没有上一版时给明确的错误', async () => {
    const { e, inst, own } = await installed();
    const feed = path.join(tmp, 'no-cli.json');
    fs.writeFileSync(feed, JSON.stringify({ schema: 1, version: '3.18.0', build: 101, app: {} }));
    await expect(updateStandalone({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: feed }, home: runtimeHome, run: fakeRun().run }, { check: true })).rejects.toSatisfy(
      rejected('UPDATE_NOT_PUBLISHED'),
    );
    await expect(standaloneUpdate(io(e, own, fakeRun().run).io, ['--force'])).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    await expect(standaloneUpdate(io(e, own, fakeRun().run).io, ['--check', '--rollback'])).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    const notStandalone = { ...io(e, own, fakeRun().run).io, own: null };
    await expect(standaloneUpdate(notStandalone, [])).rejects.toSatisfy(rejected('UPDATE_UNAVAILABLE'));
    await expect(rollbackStandalone({ installer: inst, own, home: runtimeHome })).rejects.toSatisfy(rejected('UPDATE_NO_PREVIOUS'));
  });

  it('另一个 baocut update 在跑时拒绝；锁的主人已经退出时接着跑', async () => {
    const { e, inst, own } = await installed();
    const lock = path.join(inst.places.versions, '.update.lock');
    const holder = process.ppid;
    fs.writeFileSync(lock, String(holder));
    const feed = publish('3.18.0', 101);
    await expect(updateStandalone({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: feed }, home: runtimeHome, run: fakeRun().run }, { check: true })).rejects.toSatisfy(
      rejected('UPDATE_IN_PROGRESS'),
    );
    fs.writeFileSync(lock, '999999999');
    const result = await updateStandalone({ installer: inst, own, env: { ...e, [STANDALONE_FEED_ENV]: feed }, home: runtimeHome, run: fakeRun().run }, { check: true });
    expect(result.available).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('download 核对大小：比更新源说的大时中途停下并删掉文件', async () => {
    const file = path.join(tmp, 'big.zip');
    const source = path.join(tmp, 'source.bin');
    fs.writeFileSync(source, Buffer.alloc(4096, 1));
    const entry = { format: 'zip' as const, url: source, size: 100, sha256: '0'.repeat(64) };
    await expect(download(entry, file, fetch)).rejects.toSatisfy(rejected('UPDATE_DOWNLOAD_FAILED'));
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('与 Runtime 写的入口一致', () => {
  it('Windows 转发脚本、PATH 脚本与标记行两份相同', () => {
    expect(FORWARDER_MARK).toBe(runtimeEntry.FORWARDER_MARK);
    expect(WINDOWS_USER_PATH_SCRIPT).toBe(runtimeEntry.WINDOWS_USER_PATH_SCRIPT);
    const target = 'C:\\Users\\a\\AppData\\Local\\BaoCut\\cli\\current\\baocut.cmd';
    expect(forwarderScript(target)).toBe(runtimeEntry.forwarderScript(target));
    expect(parseForwarder(forwarderScript('C:\\100%\\baocut.cmd'))).toBe('C:\\100%\\baocut.cmd');
    // PATH 提示在 Runtime 那边是 CliEntryInstaller 的私有方法：这里核对同样的几种 shell。
    expect(pathHint('/bin/zsh', 'darwin')).toEqual({ line: 'export PATH="$HOME/.local/bin:$PATH"', file: '~/.zshrc' });
    expect(pathHint('/bin/bash', 'darwin')).toEqual({ line: 'export PATH="$HOME/.local/bin:$PATH"', file: '~/.bash_profile' });
    expect(pathHint('/usr/local/bin/fish', 'darwin')).toEqual({ line: 'fish_add_path $HOME/.local/bin', file: '~/.config/fish/config.fish' });
    expect(pathHint('/bin/sh', 'darwin')).toEqual({ line: 'export PATH="$HOME/.local/bin:$PATH"', file: null });
  });

  it('版本目录名读成给人看的版本', () => {
    expect(versionLabel('3.17.0-build.93')).toBe(S.version('3.17.0', 93));
    expect(versionLabel('odd')).toBe('odd');
  });
});
