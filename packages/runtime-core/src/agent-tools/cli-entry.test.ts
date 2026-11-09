import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import {
  CLI_ENTRY_FIRST_LAUNCH_FILE,
  CLI_ENTRY_RECORD_FILE,
  CliEntryInstaller,
  FORWARDER_MARK,
  WINDOWS_USER_PATH_SCRIPT,
  encodedCommand,
  forwarderScript,
  parseForwarder,
  parseWindowsPathProbe,
  type CommandRunner,
} from './cli-entry.ts';

/** CLI 独立使用与发布 §3.2：终端里的 `baocut` 入口放在哪、状态、装、移除与 App 启动时的修复。 */

async function rejection(run: () => Promise<unknown>): Promise<RpcError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('should have been rejected');
}

describe('cli entry installer', () => {
  let dir: string;
  let home: string;
  let user: string;
  let entry: string;
  let shellPath: string | null;
  let calls: { command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }[];

  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (shellPath === null) return { ok: false, stdout: '' };
    return { ok: true, stdout: `Last login: today\nwelcome to the shell\n${shellPath}\n` };
  };

  const makeApp = (name: string) => {
    const macos = path.join(dir, name, 'Contents', 'MacOS');
    fs.mkdirSync(macos, { recursive: true });
    const file = path.join(macos, 'baocut-cli');
    fs.writeFileSync(file, '#!/bin/sh\n', { mode: 0o755 });
    return file;
  };

  const installer = (env: NodeJS.ProcessEnv = { BAOCUT_CLI_ENTRY: entry, SHELL: '/bin/zsh' }) =>
    new CliEntryInstaller({ home, userHome: user, env, platform: 'darwin', run });
  const link = () => path.join(user, '.local', 'bin', 'baocut');

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-entry-')));
    home = path.join(dir, 'runtime-home');
    user = path.join(dir, 'user');
    fs.mkdirSync(user, { recursive: true });
    entry = makeApp('BaoCut.app');
    shellPath = '/usr/bin:/bin';
    calls = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('一开始没有；装上后是指向 App 入口的软链接，记在 Runtime Home 里', async () => {
    expect(await installer().status()).toMatchObject({ entry, path: link(), state: 'none', target: null, managed: false });
    const status = await installer().install();
    expect(status).toMatchObject({ state: 'current', target: entry, managed: true });
    expect(fs.readlinkSync(link())).toBe(entry);
    expect(JSON.parse(fs.readFileSync(path.join(home, CLI_ENTRY_RECORD_FILE), 'utf8'))).toMatchObject({ path: link(), target: entry });
  });

  it('源码 Runtime 没有 App 入口：装不了，报 CLI_ENTRY_UNAVAILABLE', async () => {
    const error = await rejection(() => installer({ SHELL: '/bin/zsh' }).install());
    expect(error.code).toBe('unsupported');
    expect(error.details).toMatchObject({ code: 'CLI_ENTRY_UNAVAILABLE' });
    expect(fs.existsSync(link())).toBe(false);
  });

  it('不是 BaoCut 放的不动：文件、指向别处的链接都是 foreign，装与移除都拒绝', async () => {
    fs.mkdirSync(path.dirname(link()), { recursive: true });
    fs.writeFileSync(link(), '#!/bin/sh\necho mine\n');
    expect((await installer().status()).state).toBe('foreign');
    expect((await rejection(() => installer().install())).details).toMatchObject({ code: 'CLI_ENTRY_TAKEN', path: link() });
    expect((await rejection(() => installer().remove())).details).toMatchObject({ code: 'CLI_ENTRY_TAKEN' });
    expect(fs.readFileSync(link(), 'utf8')).toContain('mine');

    fs.rmSync(link());
    const other = path.join(dir, 'tools', 'baocut-dev');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, '#!/bin/sh\n', { mode: 0o755 });
    fs.symlinkSync(other, link());
    expect(await installer().status()).toMatchObject({ state: 'foreign', target: other });
  });

  it('App 移动后：BaoCut 放的链接失效，App 启动时改指向新位置', async () => {
    const old = makeApp('Old/BaoCut.app');
    await installer({ BAOCUT_CLI_ENTRY: old }).install();
    fs.rmSync(path.join(dir, 'Old'), { recursive: true });
    expect(await installer().status()).toMatchObject({ state: 'broken', target: old, managed: true });
    expect(installer().repair()).toBe(true);
    expect(fs.readlinkSync(link())).toBe(entry);
    expect((await installer().status()).state).toBe('current');
    expect(installer().repair()).toBe(false);
  });

  it('用户自己指向另一份 BaoCut 入口的链接是 stale，但不是 BaoCut 放的：启动时不改，用户明确安装时才换', async () => {
    const standalone = makeApp('Standalone/BaoCut.app');
    fs.mkdirSync(path.dirname(link()), { recursive: true });
    fs.symlinkSync(standalone, link());
    expect(await installer().status()).toMatchObject({ state: 'stale', target: standalone, managed: false });
    expect(installer().repair()).toBe(false);
    expect(fs.readlinkSync(link())).toBe(standalone);
    expect((await installer().install()).state).toBe('current');
  });

  it('记录里的链接被用户改指别处后不再算 BaoCut 放的', async () => {
    await installer().install();
    const standalone = makeApp('Standalone/BaoCut.app');
    fs.rmSync(link());
    fs.symlinkSync(standalone, link());
    expect(await installer().status()).toMatchObject({ state: 'stale', managed: false });
    expect(installer().repair()).toBe(false);
  });

  it('移除只删链接与记录，App 入口不动；没有时什么都不做', async () => {
    await installer().install();
    const status = await installer().remove();
    expect(status).toMatchObject({ state: 'none', managed: false });
    expect(fs.existsSync(link())).toBe(false);
    expect(fs.existsSync(entry)).toBe(true);
    expect(fs.existsSync(path.join(home, CLI_ENTRY_RECORD_FILE))).toBe(false);
    expect((await installer().remove()).state).toBe('none');
  });

  describe('首次启动', () => {
    const marker = () => path.join(home, CLI_ENTRY_FIRST_LAUNCH_FILE);
    const markerResult = () => (JSON.parse(fs.readFileSync(marker(), 'utf8')) as { result: string }).result;

    it('第一次启动时装上，记下做过；之后再启动什么都不做，也不查终端的 PATH', async () => {
      expect(await installer().installOnFirstLaunch()).toBe('installed');
      expect(fs.readlinkSync(link())).toBe(entry);
      expect(await installer().status()).toMatchObject({ state: 'current', managed: true });
      expect(markerResult()).toBe('installed');
      calls = [];
      expect(await installer().installOnFirstLaunch()).toBe('done');
      expect(calls).toEqual([]);
    });

    it('用户移除后不再装回来，没有自动装过也一样', async () => {
      await installer().installOnFirstLaunch();
      await installer().remove();
      expect(await installer().installOnFirstLaunch()).toBe('done');
      expect(fs.existsSync(link())).toBe(false);

      fs.rmSync(home, { recursive: true });
      await installer().install();
      await installer().remove();
      expect(await installer().installOnFirstLaunch()).toBe('done');
      expect(fs.existsSync(link())).toBe(false);
      expect(markerResult()).toBe('removed');
    });

    it('那里已有东西时一律不动，只记下做过：别人的文件、用户指向另一份 BaoCut 的链接、已经装好的', async () => {
      fs.mkdirSync(path.dirname(link()), { recursive: true });
      fs.writeFileSync(link(), '#!/bin/sh\necho mine\n');
      expect(await installer().installOnFirstLaunch()).toBe('present');
      expect(fs.readFileSync(link(), 'utf8')).toContain('mine');
      expect(markerResult()).toBe('present');
      expect(await installer().installOnFirstLaunch()).toBe('done');

      fs.rmSync(home, { recursive: true });
      fs.rmSync(link());
      const standalone = makeApp('Standalone/BaoCut.app');
      fs.symlinkSync(standalone, link());
      expect(await installer().installOnFirstLaunch()).toBe('present');
      expect(fs.readlinkSync(link())).toBe(standalone);

      fs.rmSync(home, { recursive: true });
      fs.rmSync(link());
      await installer().install();
      expect(await installer().installOnFirstLaunch()).toBe('present');
      expect(fs.readlinkSync(link())).toBe(entry);
    });

    it('源码 Runtime 没有 App 入口：什么都不做，也不记，留给打包后的 App', async () => {
      expect(await installer({ SHELL: '/bin/zsh' }).installOnFirstLaunch()).toBe('unavailable');
      expect(fs.existsSync(link())).toBe(false);
      expect(fs.existsSync(marker())).toBe(false);
      expect(await installer().installOnFirstLaunch()).toBe('installed');
    });

    it('放不进去时报错，也记下做过，不在每次启动重试', async () => {
      fs.mkdirSync(path.join(user, '.local'), { recursive: true });
      fs.writeFileSync(path.join(user, '.local', 'bin'), 'not a folder');
      await expect(installer().installOnFirstLaunch()).rejects.toThrow();
      expect(markerResult()).toBe('failed');
      expect(await installer().installOnFirstLaunch()).toBe('done');
    });
  });

  it('PATH 按登录交互 shell 取，只认最后一行；不在 PATH 上时给出要加的一行', async () => {
    let status = await installer().status();
    expect(calls[0]).toMatchObject({ command: '/bin/zsh', args: ['-ilc', 'printenv PATH'] });
    expect(calls[0]!.env).toMatchObject({ HOME: user, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
    expect(status.shell).toEqual({ found: null, dirOnPath: false });
    expect(status.pathHint).toEqual({ line: 'export PATH="$HOME/.local/bin:$PATH"', file: '~/.zshrc' });

    await installer().install();
    shellPath = `/usr/bin:~/.local/bin:/bin`;
    status = await installer().status();
    expect(status.shell).toEqual({ found: link(), dirOnPath: true });
    expect(status.pathHint).toBeNull();

    const fish = new CliEntryInstaller({ home, userHome: user, env: { BAOCUT_CLI_ENTRY: entry, SHELL: '/opt/homebrew/bin/fish' }, platform: 'darwin', run });
    shellPath = '/usr/bin';
    expect((await fish.status()).pathHint).toEqual({ line: 'fish_add_path $HOME/.local/bin', file: '~/.config/fish/config.fish' });
  });

  it('终端里先找到的是别的 baocut 时报出它', async () => {
    await installer().install();
    const brew = path.join(dir, 'brew', 'bin');
    fs.mkdirSync(brew, { recursive: true });
    fs.symlinkSync(entry, path.join(brew, 'baocut'));
    shellPath = `${brew}:${path.dirname(link())}`;
    expect((await installer().status()).shell).toEqual({ found: path.join(brew, 'baocut'), dirOnPath: true });
  });

  it('shell 超时或失败时 PATH 查不出：shell 与 pathHint 都是 null，状态照常', async () => {
    shellPath = null;
    expect(await installer().status()).toMatchObject({ state: 'none', shell: null, pathHint: null });
  });
});

describe('windows forwarder', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-forwarder-')));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('转发脚本带标记行，参数原样转发；% 写成 %%，读回来是原路径', () => {
    const target = 'C:\\Users\\100%\\AppData\\Local\\Programs\\BaoCut\\baocut.cmd';
    const script = forwarderScript(target);
    expect(script.split('\r\n')).toEqual(['@echo off', FORWARDER_MARK, '"C:\\Users\\100%%\\AppData\\Local\\Programs\\BaoCut\\baocut.cmd" %*', '']);
    expect(parseForwarder(script)).toBe(target);
    expect(parseForwarder('@echo off\r\necho hi\r\n')).toBeNull();
  });

  it('状态：没有标记行是 foreign；转发到不在的位置是 broken；转发到别处是 stale；转发到本 App 是 current', () => {
    const app = path.join(dir, 'app', 'baocut.cmd');
    const old = path.join(dir, 'old', 'baocut.cmd');
    fs.mkdirSync(path.dirname(app), { recursive: true });
    fs.writeFileSync(app, '@echo off\r\n');
    const installer = new CliEntryInstaller({ home: path.join(dir, 'home'), userHome: dir, env: { BAOCUT_CLI_ENTRY: app }, platform: 'win32' });
    const at = path.join(dir, 'baocut.cmd');
    expect(installer.inspect(at, app).state).toBe('none');
    fs.writeFileSync(at, '@echo off\r\n"C:\\tools\\baocut.exe" %*\r\n');
    expect(installer.inspect(at, app).state).toBe('foreign');
    fs.writeFileSync(at, forwarderScript(old));
    expect(installer.inspect(at, app)).toEqual({ state: 'broken', target: old });
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '@echo off\r\n');
    expect(installer.inspect(at, app)).toEqual({ state: 'stale', target: old });
    fs.writeFileSync(at, forwarderScript(app));
    expect(installer.inspect(at, app)).toEqual({ state: 'current', target: app });
  });

  it('位置在 %LOCALAPPDATA%\\BaoCut\\bin 下', () => {
    const installer = new CliEntryInstaller({
      home: dir,
      userHome: 'C:\\Users\\me',
      env: { LOCALAPPDATA: 'D:\\Profiles\\me\\Local' },
      platform: 'win32',
    });
    expect(installer.location()).toBe('D:\\Profiles\\me\\Local\\BaoCut\\bin\\baocut.cmd');
    const fallback = new CliEntryInstaller({ home: dir, userHome: 'C:\\Users\\me', env: {}, platform: 'win32' });
    expect(fallback.location()).toBe('C:\\Users\\me\\AppData\\Local\\BaoCut\\bin\\baocut.cmd');
  });

  it('改用户 PATH 的脚本不用 setx，按原样读写、广播 WM_SETTINGCHANGE；按 UTF-16LE base64 传给 PowerShell', () => {
    expect(WINDOWS_USER_PATH_SCRIPT).not.toMatch(/setx/i);
    expect(WINDOWS_USER_PATH_SCRIPT).toContain('DoNotExpandEnvironmentNames');
    expect(WINDOWS_USER_PATH_SCRIPT).toContain('SendMessageTimeout');
    const args = encodedCommand(WINDOWS_USER_PATH_SCRIPT);
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(Buffer.from(args[3]!, 'base64').toString('utf16le')).toBe(WINDOWS_USER_PATH_SCRIPT);
  });

  it('读系统与用户 PATH 的输出', () => {
    expect(parseWindowsPathProbe('\uFEFF{"machine":"C:\\\\Windows","user":"%USERPROFILE%\\\\bin"}')).toEqual({
      machine: 'C:\\Windows',
      user: '%USERPROFILE%\\bin',
    });
    expect(parseWindowsPathProbe('{"machine":"C:\\\\Windows","user":null}')).toEqual({ machine: 'C:\\Windows', user: '' });
    expect(parseWindowsPathProbe('garbage')).toBeNull();
  });
});
