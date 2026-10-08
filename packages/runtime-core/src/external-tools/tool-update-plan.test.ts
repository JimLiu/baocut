import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YT_DLP, BUILTIN_TOOL_MANIFESTS } from './tool-manifests.ts';
import { commandLine, exitCodeText, toolUpdatePlan, updateSucceeded } from './tool-update-plan.ts';

/**
 * 按原安装方式更新的判断（架构设计 §12.9）：在临时目录里摆出各种安装方式的文件布局（Homebrew 的 Cellar、pipx 的 venv、
 * pip 的入口脚本、独立程序与 zipapp，Windows 上 winget、Scoop、Chocolatey 的目录），只看文件，不执行任何程序。
 */

const recipe = BUILTIN_TOOL_MANIFESTS.find((m) => m.name === YT_DLP)!.update!;
const root = process.getuid?.() === 0;

let dir: string;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-tool-update-')));
});

afterEach(async () => {
  for (const sub of ['locked', 'pip-locked']) await fs.chmod(path.join(dir, sub), 0o755).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(file: string, content: string | Buffer, mode = 0o755): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { mode });
  return file;
}

async function link(target: string, file: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.symlink(target, file);
  return file;
}

const plan = (file: string, searchPath = '') => toolUpdatePlan(file, 'yt-dlp', recipe, searchPath, 'darwin');
/** Windows 的判断在本机的临时目录里核对：路径仍是本机的写法，只换平台与环境变量。 */
const winPlan = (file: string, env: NodeJS.ProcessEnv = {}, searchPath = '') => toolUpdatePlan(file, 'yt-dlp', recipe, searchPath, 'win32', env);
const PE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(254)]);
/** pip（distlib）在 Windows 上生成的入口程序：启动器 + `#!<解释器>` + 含 `__main__.py`（不压缩）的 zip。 */
const launcher = (shebang: string, module = 'yt_dlp') =>
  Buffer.concat([
    PE,
    Buffer.from(`#!${shebang}\n`),
    Buffer.from('PK\x03\x04', 'latin1'),
    Buffer.alloc(26),
    Buffer.from(`__main__.py# -*- coding: utf-8 -*-\nimport re\nimport sys\nfrom ${module}.__main__ import main\nif __name__ == '__main__':\n    sys.exit(main())\n`),
  ]);
const PIP_SCRIPT = (shebang: string) => `${shebang}\n# -*- coding: utf-8 -*-\nimport re\nimport sys\nfrom yt_dlp import main\nif __name__ == '__main__':\n    sys.exit(main())\n`;

describe('按原安装方式更新：判断办法', () => {
  it('Homebrew：用同一个前缀的 brew 执行 upgrade；开发版加 --fetch-HEAD；找不到 brew 时只给命令', async () => {
    const prefix = path.join(dir, 'homebrew');
    const brew = await write(path.join(prefix, 'bin', 'brew'), '#!/bin/sh\n');
    await write(path.join(prefix, 'Cellar', 'yt-dlp', '2026.07.04', 'libexec', 'bin', 'yt-dlp'), PIP_SCRIPT('#!/usr/bin/python3'));
    const shim = await link('../Cellar/yt-dlp/2026.07.04/libexec/bin/yt-dlp', path.join(prefix, 'bin', 'yt-dlp'));
    expect(await plan(shim)).toEqual({
      method: 'homebrew',
      argv: [brew, 'upgrade', 'yt-dlp'],
      command: `${brew} upgrade yt-dlp`,
      runnable: true,
      reason: null,
    });

    const head = path.join(dir, 'head');
    const headBrew = await write(path.join(head, 'bin', 'brew'), '#!/bin/sh\n');
    const headFile = await write(path.join(head, 'Cellar', 'yt-dlp', 'HEAD-1a2b3c4', 'bin', 'yt-dlp'), '#!/bin/sh\n');
    expect((await plan(headFile))!.argv).toEqual([headBrew, 'upgrade', '--fetch-HEAD', 'yt-dlp']);

    const orphan = await write(path.join(dir, 'orphan', 'Cellar', 'yt-dlp', '2026.07.04', 'bin', 'yt-dlp'), '#!/bin/sh\n');
    expect(await plan(orphan)).toMatchObject({
      method: 'homebrew',
      argv: ['brew', 'upgrade', 'yt-dlp'],
      command: 'brew upgrade yt-dlp',
      runnable: false,
      reason: expect.stringContaining('找不到同一个 Homebrew'),
    });
  });

  it('pipx：在 PATH 里找 pipx；找不到时只给命令', async () => {
    const venv = await write(path.join(dir, '.local', 'pipx', 'venvs', 'yt-dlp', 'bin', 'yt-dlp'), PIP_SCRIPT('#!/usr/bin/python3'));
    const shim = await link(venv, path.join(dir, '.local', 'bin', 'yt-dlp'));
    const pathDir = path.join(dir, 'path');
    const pipx = await write(path.join(pathDir, 'pipx'), '#!/bin/sh\n');
    expect(await plan(shim, pathDir)).toMatchObject({ method: 'pipx', argv: [pipx, 'upgrade', 'yt-dlp'], runnable: true });
    expect(await plan(shim, path.join(dir, 'nowhere'))).toMatchObject({
      method: 'pipx',
      command: 'pipx upgrade yt-dlp',
      runnable: false,
    });
  });

  it('pip：用入口脚本的解释器（绝对路径、env、长路径写法），用户目录加 --user，解释器不在时只给命令', async () => {
    const python = await write(path.join(dir, 'venv', 'bin', 'python3.12'), '#!/bin/sh\n');
    const script = await write(path.join(dir, 'venv', 'bin', 'yt-dlp'), PIP_SCRIPT(`#!${python}`));
    expect(await plan(script)).toEqual({
      method: 'pip',
      argv: [python, '-m', 'pip', 'install', '-U', 'yt-dlp[default]'],
      command: `${python} -m pip install -U 'yt-dlp[default]'`,
      runnable: true,
      reason: null,
    });

    const pathDir = path.join(dir, 'path');
    const envPython = await write(path.join(pathDir, 'python3'), '#!/bin/sh\n');
    const user = await write(path.join(dir, 'Library', 'Python', '3.12', 'bin', 'yt-dlp'), PIP_SCRIPT('#!/usr/bin/env python3'));
    expect((await plan(user, pathDir))!.argv).toEqual([envPython, '-m', 'pip', 'install', '-U', '--user', 'yt-dlp[default]']);

    const long = await write(
      path.join(dir, 'long', 'bin', 'yt-dlp'),
      `#!/bin/sh\n'''exec' "${python}" "$0" "$@"\n' '''\n${PIP_SCRIPT('').slice(1)}`,
    );
    expect((await plan(long))!.argv[0]).toBe(python);

    const gone = await write(path.join(dir, 'gone', 'bin', 'yt-dlp'), PIP_SCRIPT(`#!${path.join(dir, 'missing', 'python3')}`));
    expect(await plan(gone)).toMatchObject({
      method: 'pip',
      argv: ['python3', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'],
      runnable: false,
      reason: expect.stringContaining('解释器不在了'),
    });
  });

  it.skipIf(root)('pip：装在当前用户不能写的位置时不代为执行，只给原命令（不加 sudo）', async () => {
    const python = await write(path.join(dir, 'py', 'python3'), '#!/bin/sh\n');
    const script = await write(path.join(dir, 'pip-locked', 'yt-dlp'), PIP_SCRIPT(`#!${python}`));
    await fs.chmod(path.dirname(script), 0o555);
    const result = await plan(script);
    expect(result).toMatchObject({ method: 'pip', runnable: false, reason: expect.stringContaining('管理员权限') });
    expect(result!.command.startsWith('sudo')).toBe(false);
  });

  it('官方独立程序：二进制文件与 zipapp 执行 -U；Windows 上认不出的 Scripts 目录里的 .exe 不算', async () => {
    const macho = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64)]);
    const binary = await write(path.join(dir, 'bin', 'yt-dlp'), macho);
    expect(await plan(binary)).toEqual({ method: 'standalone', argv: [binary, '-U'], command: `${binary} -U`, runnable: true, reason: null });
    const elf = await write(path.join(dir, 'elf', 'yt-dlp'), Buffer.concat([Buffer.from('\x7fELF', 'latin1'), Buffer.alloc(64)]));
    expect((await plan(elf))!.method).toBe('standalone');
    const zipapp = await write(
      path.join(dir, 'zip', 'yt-dlp'),
      Buffer.concat([Buffer.from('#!/usr/bin/env python3\n'), Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(32)]),
    );
    expect((await plan(zipapp))!.argv).toEqual([zipapp, '-U']);

    const pe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
    const scripts = await write(path.join(dir, 'Python312', 'Scripts', 'yt-dlp.exe'), pe);
    expect(await winPlan(scripts)).toBeNull();
    const tools = await write(path.join(dir, 'Tools', 'yt-dlp.exe'), pe);
    expect(await winPlan(tools)).toMatchObject({ method: 'standalone', argv: [tools, '-U'], runnable: true });
  });

  it('Windows 的 winget：真实位置在 WinGet\\Packages\\<包 ID>_<源> 下，用 PATH 里的 winget 不交互地升级；找不到 winget、全机范围时只给命令', async () => {
    const local = path.join(dir, 'Local');
    const pkg = await write(path.join(local, 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe'), PE);
    const shim = await link(pkg, path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'));
    // winget 是 WindowsApps 里的应用执行别名，跟随它的 stat 会失败：这里用指向不存在的文件的符号链接代替。
    const apps = path.join(local, 'Microsoft', 'WindowsApps');
    const winget = await link(path.join(dir, 'alias-target'), path.join(apps, 'winget.exe'));
    const args = ['upgrade', '--id', 'yt-dlp.yt-dlp', '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
    expect(await winPlan(shim, {}, apps)).toEqual({
      method: 'winget',
      argv: [winget, ...args],
      command: commandLine([winget, ...args], 'win32'),
      runnable: true,
      reason: null,
    });
    // PATH 里没有 WindowsApps 时看 %LOCALAPPDATA%\Microsoft\WindowsApps。
    expect((await winPlan(pkg, { LOCALAPPDATA: local }, path.join(dir, 'empty')))!.argv[0]).toBe(winget);
    expect(await winPlan(pkg, {}, path.join(dir, 'empty'))).toMatchObject({
      method: 'winget',
      argv: ['winget', ...args],
      command: `winget ${args.join(' ')}`,
      runnable: false,
      reason: expect.stringContaining('找不到 winget'),
    });
    // 全机范围（Program Files\WinGet）：要管理员权限。
    const programFiles = path.join(dir, 'Program Files');
    const machine = await write(path.join(programFiles, 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe'), PE);
    expect(await winPlan(machine, { ProgramFiles: programFiles }, apps)).toMatchObject({
      method: 'winget',
      argv: [winget, ...args],
      runnable: false,
      reason: expect.stringContaining('用管理员身份打开终端执行这条命令'),
    });
    // 别的包的目录不算。
    const other = await write(path.join(local, 'Microsoft', 'WinGet', 'Packages', 'Other.Tool_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe'), PE);
    expect((await winPlan(other, {}, apps))!.method).toBe('standalone');
  });

  it('Windows 的 Scoop：shims 里的入口（旁边有 .shim）或 apps 下的版本目录，用 System32 的 powershell.exe 执行 scoop.ps1；全局安装与找不到 Scoop 时只给命令', async () => {
    const scoop = path.join(dir, 'scoop');
    const version = await write(path.join(scoop, 'apps', 'yt-dlp', '2026.07.04', 'yt-dlp.exe'), PE);
    await link(path.dirname(version), path.join(scoop, 'apps', 'yt-dlp', 'current'));
    const shim = await write(path.join(scoop, 'shims', 'yt-dlp.exe'), PE);
    await write(path.join(scoop, 'shims', 'yt-dlp.shim'), `path = "${path.join(scoop, 'apps', 'yt-dlp', 'current', 'yt-dlp.exe')}"\n`);
    const script = await write(path.join(scoop, 'apps', 'scoop', 'current', 'bin', 'scoop.ps1'), '');
    const argv = ['D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Unrestricted', '-File', script, 'update', 'yt-dlp'];
    expect(await winPlan(shim, { SystemRoot: 'D:\\Win' })).toEqual({ method: 'scoop', argv, command: commandLine(argv, 'win32'), runnable: true, reason: null });
    expect((await winPlan(path.join(scoop, 'apps', 'yt-dlp', 'current', 'yt-dlp.exe'), { SystemRoot: 'D:\\Win' }))!.argv).toEqual(argv);
    // 没有设 SystemRoot、windir 时用 C:\Windows 下的。
    expect((await winPlan(shim))!.argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');

    // shims 里没有 .shim 的 .exe 不算 Scoop。
    const bare = await write(path.join(dir, 'other', 'shims', 'yt-dlp.exe'), PE);
    expect((await winPlan(bare))!.method).toBe('standalone');

    // 找不到 Scoop 本身。
    const lost = path.join(dir, 'lost-scoop');
    const lostShim = await write(path.join(lost, 'shims', 'yt-dlp.exe'), PE);
    await write(path.join(lost, 'shims', 'yt-dlp.shim'), '');
    expect(await winPlan(lostShim)).toMatchObject({ method: 'scoop', command: 'scoop update yt-dlp', runnable: false, reason: expect.stringContaining('找不到 Scoop 本身') });

    // 全局安装：ProgramData 下，或 SCOOP_GLOBAL 指的目录。
    const programData = path.join(dir, 'ProgramData');
    const global = await write(path.join(programData, 'scoop', 'shims', 'yt-dlp.exe'), PE);
    await write(path.join(programData, 'scoop', 'shims', 'yt-dlp.shim'), '');
    expect(await winPlan(global, { ProgramData: programData })).toMatchObject({
      method: 'scoop',
      argv: ['scoop', 'update', 'yt-dlp', '--global'],
      command: 'scoop update yt-dlp --global',
      runnable: false,
      reason: expect.stringContaining('用管理员身份打开终端执行这条命令'),
    });
    const custom = path.join(dir, 'GlobalApps');
    const customExe = await write(path.join(custom, 'apps', 'yt-dlp', '2026.07.04', 'yt-dlp.exe'), PE);
    await fs.mkdir(path.join(custom, 'shims'), { recursive: true });
    expect(await winPlan(customExe, { SCOOP_GLOBAL: custom })).toMatchObject({ method: 'scoop', command: 'scoop update yt-dlp --global', runnable: false });
  });

  it('Windows 的 Chocolatey：bin 里的入口或 lib 下的包，总要管理员权限，只给 choco upgrade', async () => {
    const reason = expect.stringContaining('Chocolatey 装的程序要管理员权限');
    const bin = await write(path.join(dir, 'ProgramData', 'chocolatey', 'bin', 'yt-dlp.exe'), PE);
    expect(await winPlan(bin)).toEqual({ method: 'chocolatey', argv: ['choco', 'upgrade', 'yt-dlp'], command: 'choco upgrade yt-dlp', runnable: false, reason, reasonRef: { key: 'rcExternalTools.chocolateyAdmin' } });
    // ChocolateyInstall 指的目录不叫 chocolatey 时也认得。
    const root = path.join(dir, 'choco-root');
    const lib = await write(path.join(root, 'lib', 'yt-dlp', 'tools', 'yt-dlp.exe'), PE);
    expect(await winPlan(lib, { ChocolateyInstall: root })).toMatchObject({ method: 'chocolatey', runnable: false });
    expect((await winPlan(lib))!.method).toBe('standalone');
  });

  it('Windows 的 pip：从启动器里的 #! 一行读出解释器，用它执行 -m pip；不在解释器旁边的加 --user；指向 pipx 的 venv 按 pipx', async () => {
    // 系统里装的 Python：Scripts 在解释器旁边。路径带空格时 #! 一行加双引号。
    const python = await write(path.join(dir, 'Py thon313', 'python.exe'), PE);
    const exe = await write(path.join(dir, 'Py thon313', 'Scripts', 'yt-dlp.exe'), launcher(`"${python}"`));
    expect(await winPlan(exe)).toEqual({
      method: 'pip',
      argv: [python, '-m', 'pip', 'install', '-U', 'yt-dlp[default]'],
      command: `& '${python}' -m pip install -U 'yt-dlp[default]'`,
      runnable: true,
      reason: null,
    });
    // venv：解释器与入口在同一个 Scripts 里。
    const venvPython = await write(path.join(dir, 'venv', 'Scripts', 'python.exe'), PE);
    const venvExe = await write(path.join(dir, 'venv', 'Scripts', 'yt-dlp.exe'), launcher(venvPython));
    expect((await winPlan(venvExe))!.argv).toEqual([venvPython, '-m', 'pip', 'install', '-U', 'yt-dlp[default]']);
    // pip install --user：%APPDATA%\Python\Python313\Scripts。
    const userExe = await write(path.join(dir, 'Roaming', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'), launcher(`"${python}"`));
    expect((await winPlan(userExe))!.argv).toEqual([python, '-m', 'pip', 'install', '-U', '--user', 'yt-dlp[default]']);
    // pipx 复制出来的入口：解释器在 pipx 的 venv 里。
    const pipxPython = await write(path.join(dir, 'pipx', 'venvs', 'yt-dlp', 'Scripts', 'python.exe'), PE);
    const pipxExe = await write(path.join(dir, '.local', 'bin', 'yt-dlp.exe'), launcher(pipxPython));
    expect(await winPlan(pipxExe)).toMatchObject({ method: 'pipx', command: 'pipx upgrade yt-dlp', runnable: false });
    // 解释器不在了：给 py 启动器的命令。
    const gone = await write(path.join(dir, 'gone', 'Scripts', 'yt-dlp.exe'), launcher(path.join(dir, 'gone', 'python.exe')));
    expect(await winPlan(gone)).toMatchObject({ method: 'pip', command: "py -m pip install -U 'yt-dlp[default]'", runnable: false });
    // 别的模块的启动器、uv 的启动器：判断不了。
    const other = await write(path.join(dir, 'other', 'Scripts', 'yt-dlp.exe'), launcher(python, 'other_tool'));
    expect(await winPlan(other)).toBeNull();
    const uv = await write(path.join(dir, 'uvbin', 'yt-dlp.exe'), Buffer.concat([PE, Buffer.from('UVSC', 'latin1')]));
    expect(await winPlan(uv)).toBeNull();
  });

  it('Windows：Program Files、ProgramData 下的按要管理员权限处理（fs.access 在 Windows 上不看访问控制列表）', async () => {
    const programFiles = path.join(dir, 'Program Files');
    const env = { ProgramFiles: programFiles };
    const standalone = await write(path.join(programFiles, 'yt-dlp', 'yt-dlp.exe'), PE);
    expect(await winPlan(standalone, env)).toEqual({
      method: 'standalone',
      argv: [standalone, '-U'],
      command: `& '${standalone}' -U`,
      runnable: false,
      reason: expect.stringContaining('用管理员身份打开终端'),
      reasonRef: { key: 'rcExternalTools.standaloneAdminWin', params: { label: 'yt-dlp', dir: path.dirname(standalone) } },
    });
    const python = await write(path.join(programFiles, 'Python313', 'python.exe'), PE);
    const exe = await write(path.join(programFiles, 'Python313', 'Scripts', 'yt-dlp.exe'), launcher(`"${python}"`));
    expect(await winPlan(exe, { PROGRAMFILES: programFiles })).toMatchObject({ method: 'pip', runnable: false, reason: expect.stringContaining('管理员身份') });
  });

  it.skipIf(root)('官方独立程序：所在目录要管理员权限时不代为执行，给出带 sudo 的命令', async () => {
    const binary = await write(path.join(dir, 'locked', 'yt-dlp'), Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64)]));
    await fs.chmod(path.dirname(binary), 0o555);
    expect(await plan(binary)).toEqual({
      method: 'standalone',
      argv: [binary, '-U'],
      command: `sudo ${binary} -U`,
      runnable: false,
      reason: expect.stringContaining('要管理员权限才能改写'),
    });
  });

  it('判断不了的：自己写的包装脚本、uv 装的工具（环境里没有 pip）、不存在的文件', async () => {
    const wrapper = await write(path.join(dir, 'wrap', 'yt-dlp'), '#!/bin/sh\nexec node /opt/yt-dlp.js "$@"\n');
    expect(await plan(wrapper)).toBeNull();
    const python = await write(path.join(dir, '.local', 'share', 'uv', 'tools', 'yt-dlp', 'bin', 'python3'), '#!/bin/sh\n');
    const uv = await write(path.join(dir, '.local', 'share', 'uv', 'tools', 'yt-dlp', 'bin', 'yt-dlp'), PIP_SCRIPT(`#!${python}`));
    expect(await plan(await link(uv, path.join(dir, '.local', 'bin', 'yt-dlp')))).toBeNull();
    expect(await plan(path.join(dir, 'missing'))).toBeNull();
  });
});

describe('更新命令的结果', () => {
  it('退出码 0 算成功；winget 没有可升级的版本（0x8A15002B，可能报成负数）也算，别的方式不算', () => {
    expect(updateSucceeded('homebrew', 0)).toBe(true);
    expect(updateSucceeded('winget', 0x8a15002b)).toBe(true);
    expect(updateSucceeded('winget', 0x8a15002b - 2 ** 32)).toBe(true);
    expect(updateSucceeded('scoop', 0x8a15002b)).toBe(false);
    expect(updateSucceeded('winget', 1)).toBe(false);
    expect(updateSucceeded('winget', null)).toBe(false);
  });

  it('退出码：负数或超过 0xFFFF 的按 8 位十六进制写', () => {
    expect(exitCodeText(1)).toBe('1');
    expect(exitCodeText(0x8a150014)).toBe('0x8A150014');
    expect(exitCodeText(-1)).toBe('0xFFFFFFFF');
  });
});

describe('给人看的命令', () => {
  it('POSIX：安全的参数原样，其余加单引号', () => {
    expect(commandLine(['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'], 'darwin')).toBe('/opt/homebrew/bin/brew upgrade yt-dlp');
    expect(commandLine(['python3', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'], 'linux')).toBe("python3 -m pip install -U 'yt-dlp[default]'");
    expect(commandLine(['/Users/a b/yt-dlp', "it's", ''], 'darwin')).toBe(`'/Users/a b/yt-dlp' 'it'\\''s' ''`);
  });

  it('Windows（PowerShell）：单引号里的单引号写两遍，第一个词加了引号时前面加 &', () => {
    expect(commandLine(['C:\\Users\\ming\\bin\\yt-dlp.exe', '-U'], 'win32')).toBe('C:\\Users\\ming\\bin\\yt-dlp.exe -U');
    expect(commandLine(['C:\\Program Files\\Python313\\python.exe', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'], 'win32')).toBe(
      "& 'C:\\Program Files\\Python313\\python.exe' -m pip install -U 'yt-dlp[default]'",
    );
    expect(commandLine(["C:\\Users\\O'Neil\\yt-dlp.exe", 'a\u2019b', '$env:x', '@a', 'a;b', ''], 'win32')).toBe(
      "& 'C:\\Users\\O''Neil\\yt-dlp.exe' 'a\u2019\u2019b' '$env:x' '@a' 'a;b' ''",
    );
  });
});
