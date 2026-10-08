import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExternalToolUpdateMethod, ExternalToolUpdatePlan } from '@baocut/protocol';
import { envValue, findOnPath, isExecutableFile } from './tool-probe.ts';
import { refOf, type Localized } from '@baocut/protocol';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

/**
 * 按原安装方式更新系统里的外部工具（架构设计 §12.9）：探测时按可执行文件的真实位置（跟随符号链接）判断它是怎么装的，
 * 给出要执行的命令。只看本机文件，不联网、不执行任何程序。
 *
 * - Homebrew：真实位置在 `<前缀>/Cellar/<formula>/<版本>/` 下，用同一个前缀的 `bin/brew` 执行 `brew upgrade`；
 *   从源码装的开发版（版本目录以 `HEAD` 开头）加 `--fetch-HEAD`，否则 Homebrew 不会去取新的提交。
 * - pipx：真实位置在 `pipx/venvs/<包>/` 下，执行 `pipx upgrade`。
 * - pip：入口脚本（解释器的 shebang、导入工具的模块），用同一个解释器执行 `-m pip install -U`；脚本在用户目录
 *   （`~/Library/Python/<版本>/bin`、`~/.local/bin`）时加 `--user`。
 *   Windows 上入口是 Scripts 目录里的 `.exe` 启动器（distlib）：启动器程序 + `#!<解释器>` 一行 + 含 `__main__.py` 的 zip，
 *   从这一行读出解释器；解释器指向 pipx 的 venv 时按 pipx 处理；脚本不在解释器旁边（`%APPDATA%\Python\…\Scripts`、
 *   Microsoft Store 的 Python）时加 `--user`。
 * - Windows 的包管理器（它们的入口是复制出来的 `.exe` shim 或指过去的符号链接，要在认独立程序之前认出来）：
 *   - winget：真实位置在 `WinGet\Packages\<包 ID>_<源>\` 下（`WinGet\Links` 里的符号链接指向那里），用 PATH 里（或 WindowsApps 里）的 winget
 *     不交互地升级这一个包，只查 winget 源（msstore 源的协议提示会让命令失败）；
 *   - Scoop：`<Scoop 目录>\shims\<app>.exe`（旁边有同名的 `.shim`）或 `<Scoop 目录>\apps\<app>\<版本>\` 下。Scoop 本身
 *     是 PowerShell 脚本，照它自己的 `scoop.cmd` 那样用 System32 的 powershell.exe 执行 `scoop.ps1 update <app>`；
 *     全局安装（ProgramData 下，或 `SCOOP_GLOBAL` 指的目录）要管理员权限，只给 `scoop update <app> --global`；
 *   - Chocolatey：`<Chocolatey 目录>\bin\<包>.exe` 或 `lib\<包>\` 下，装在 ProgramData，总要管理员权限，只给
 *     `choco upgrade <包>`。
 * - 官方独立程序：可执行的二进制文件（Mach-O、ELF、PE）或 Python zipapp，执行它自带的更新参数（`yt-dlp -U`）。
 * - 其余（自己写的包装脚本、认不出的文件、uv 装的工具——它的环境里没有 pip）判断不了，返回 null，由界面列出常见做法。
 *
 * 要改写的位置当前用户不能写时不代为执行、不提权：独立程序给出带 `sudo` 的命令（Windows 上说明用管理员身份），
 * 其余只给原命令并说明原因。Windows 上 `fs.access` 不看访问控制列表，按位置判断：Program Files、ProgramData、
 * Windows 目录下的都算要管理员权限。
 *
 * 给人看的命令（`command`）按 Runtime 主机的平台写：Windows 上按 PowerShell 的规则加引号，其他系统按 POSIX shell。
 */

/** 清单里的更新方式：Homebrew 的 formula、pipx 与 pip 的包、入口脚本导入的模块、独立程序自带的更新参数，以及 Windows 包管理器里的名字。 */
export interface ToolUpdateRecipe {
  formula: string;
  pipxPackage: string;
  /** `pip install -U` 的需求（带 extras）。 */
  pipRequirement: string;
  /** 入口脚本里 `from <模块> import …` 的模块名，据此认出 pip 装的脚本。 */
  module: string;
  selfUpdateArgs: readonly string[];
  /** winget 的包 ID（`WinGet\Packages\<ID>_<源>\`）。 */
  wingetId: string;
  /** Scoop 的 app 名（`apps\<app>\`、`shims\<app>.exe`）。 */
  scoopApp: string;
  /** Chocolatey 的包名（`lib\<包>\`、`bin\<包>.exe`）。 */
  chocolateyPackage: string;
}

/** winget 没有可升级的版本时的退出码（APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE）。 */
export const WINGET_UPDATE_NOT_APPLICABLE = 0x8a15002b;

/**
 * 更新命令算不算成功：退出码是 0；winget 没有可升级的版本时以 0x8A15002B 退出，也算（版本不变，就是已是最新）。
 * Windows 的退出码是 32 位无符号数，Node 可能报成负数，比较前按无符号数看。
 */
export function updateSucceeded(method: ExternalToolUpdateMethod, exitCode: number | null): boolean {
  if (exitCode === 0) return true;
  return method === 'winget' && exitCode !== null && exitCode >>> 0 === WINGET_UPDATE_NOT_APPLICABLE;
}

/** 给人看的退出码：负数或超过 0xFFFF 的（Windows 的 HRESULT、NTSTATUS 一类）按 8 位十六进制写。 */
export function exitCodeText(code: number): string {
  return code < 0 || code > 0xffff ? `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : String(code);
}

const HEAD_BYTES = 4096;
/** pip 的启动器只有一百多 KB；更大的 `.exe`（PyInstaller 打包的独立程序）不读全文。 */
const LAUNCHER_MAX_BYTES = 2 * 1024 * 1024;
const SAFE_POSIX = /^[A-Za-z0-9_@%+=:,./~-]+$/;
/** PowerShell 里不用加引号的参数：不含空格、引号、`$`、`` ` ``、`@`、`;`、`,`、`&`、`|`、括号与方括号、`#`、`%`、`<>` 等。 */
const SAFE_POWERSHELL = /^[A-Za-z0-9_+=:./\\-]+$/;

/**
 * 参数数组 → 给人看、能粘进终端的一行。
 *
 * - POSIX：单引号，内部的单引号写成 `'\''`。
 * - Windows（PowerShell）：单引号，内部的单引号（含弯引号，PowerShell 也把它们当单引号）写两遍；第一个词加了引号时
 *   前面加调用运算符 `& `，否则 PowerShell 只把它当字符串输出。
 */
export function commandLine(argv: readonly string[], platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return argv.map((a) => (a !== '' && SAFE_POSIX.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
  const words = argv.map((a) => (a !== '' && SAFE_POWERSHELL.test(a) ? a : `'${a.replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`));
  if (words.length && words[0] !== argv[0]) words[0] = `& ${words[0]}`;
  return words.join(' ');
}

/**
 * `file` 是此刻用的那一份（可以是符号链接），`label` 是给人看的工具名。`env` 只用来在 Windows 上找 Program Files 等
 * 要管理员权限的位置（默认当前进程的）。
 */
export async function toolUpdatePlan(
  file: string,
  label: string,
  recipe: ToolUpdateRecipe,
  searchPath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExternalToolUpdatePlan | null> {
  const real = await fs.realpath(file).catch(() => null);
  if (!real) return null;
  const posix = real.split(path.sep).join('/');
  const plan = (method: ExternalToolUpdateMethod, argv: string[]): ExternalToolUpdatePlan => ({
    method,
    argv,
    command: commandLine(argv, platform),
    runnable: true,
    reason: null,
  });
  const manual = (method: ExternalToolUpdateMethod, argv: string[], reason: Localized): ExternalToolUpdatePlan => ({
    method,
    argv,
    command: commandLine(argv, platform),
    runnable: false,
    reason: reason.text,
    reasonRef: refOf(reason),
  });
  const pipx = async () => {
    const found = await findOnPath('pipx', searchPath, platform);
    if (found) return plan('pipx', [found, 'upgrade', recipe.pipxPackage]);
    return manual('pipx', ['pipx', 'upgrade', recipe.pipxPackage], RcExternalTools.pipxMissing({ label }));
  };
  const adminOnly = async (dir: string, ...targets: string[]) =>
    (platform === 'win32' && windowsAdminDir(dir, env)) || !(await writable(dir, ...targets));

  const cellar = new RegExp(`^(.*)/Cellar/${escape(recipe.formula)}/([^/]+)/`).exec(posix);
  if (cellar) {
    const brew = path.join(cellar[1] || '/', 'bin', 'brew');
    const head = cellar[2]!.startsWith('HEAD') ? ['--fetch-HEAD'] : [];
    if (await isExecutableFile(brew)) return plan('homebrew', [brew, 'upgrade', ...head, recipe.formula]);
    return manual('homebrew', ['brew', 'upgrade', ...head, recipe.formula], RcExternalTools.brewMissing({ label, brew }));
  }

  if (posix.includes(`/pipx/venvs/${recipe.pipxPackage}/`)) return await pipx();

  if (posix.includes('/uv/tools/')) return null;

  if (platform === 'win32') {
    const winget = new RegExp(`/winget/packages/${escape(recipe.wingetId)}_[^/]+/`, 'i').test(posix);
    if (winget) {
      const args = ['upgrade', '--id', recipe.wingetId, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
      const found = await findWindowsProgram('winget', searchPath, env);
      if (windowsAdminDir(path.dirname(real), env)) {
        return manual('winget', [found ?? 'winget', ...args], RcExternalTools.wingetMachineWide({ label, dir: path.dirname(real) }));
      }
      if (found) return plan('winget', [found, ...args]);
      return manual('winget', ['winget', ...args], RcExternalTools.wingetMissing({ label }));
    }
    const scoop = await scoopRoot(real, posix, recipe.scoopApp);
    if (scoop) {
      const global = windowsAdminDir(scoop, env) || sameDirOrNull(scoop, envValue(env, 'SCOOP_GLOBAL'));
      if (global) {
        return manual('scoop', ['scoop', 'update', recipe.scoopApp, '--global'], RcExternalTools.scoopGlobal({ label, dir: scoop }));
      }
      const script = path.join(scoop, 'apps', 'scoop', 'current', 'bin', 'scoop.ps1');
      if (!(await exists(script))) return manual('scoop', ['scoop', 'update', recipe.scoopApp], RcExternalTools.scoopMissing({ label, script }));
      return plan('scoop', [windowsPowerShell(env), '-NoProfile', '-ExecutionPolicy', 'Unrestricted', '-File', script, 'update', recipe.scoopApp]);
    }
    if (chocolatey(posix, recipe.chocolateyPackage, env)) {
      return manual('chocolatey', ['choco', 'upgrade', recipe.chocolateyPackage], RcExternalTools.chocolateyAdmin());
    }
  }

  const head = await readHead(real);
  if (!head) return null;
  const text = head.toString('latin1');
  const binary = isNativeExecutable(head);
  const zipapp = text.startsWith('#!') && text.includes('PK\x03\x04');

  if (!binary && !zipapp && text.startsWith('#!') && importsModule(text, recipe.module)) {
    if (platform === 'win32') return null;
    const user = /\/Library\/Python\/[^/]+\/bin$|\/\.local\/bin$/.test(path.posix.dirname(posix));
    const tail = ['-m', 'pip', 'install', '-U', ...(user ? ['--user'] : []), recipe.pipRequirement];
    const python = await scriptInterpreter(text, searchPath, platform);
    if (!python) return manual('pip', ['python3', ...tail], RcExternalTools.pythonScriptMissing());
    if (await adminOnly(path.dirname(real))) {
      return manual('pip', [python, ...tail], RcExternalTools.pipAdmin({ label, dir: path.dirname(real) }));
    }
    return plan('pip', [python, ...tail]);
  }

  if (binary && platform === 'win32') {
    const launcher = await pipLauncher(real, recipe.module);
    if (launcher === 'uv') return null;
    if (launcher) {
      const interpreter = launcher.replace(/\\/g, '/');
      if (interpreter.includes(`/pipx/venvs/${recipe.pipxPackage}/`)) return await pipx();
      if (interpreter.includes('/uv/tools/')) return null;
      const scripts = path.dirname(real);
      const user = !sameDir(scripts, path.win32.dirname(launcher)) && !sameDir(scripts, path.win32.join(path.win32.dirname(launcher), 'Scripts'));
      const tail = ['-m', 'pip', 'install', '-U', ...(user ? ['--user'] : []), recipe.pipRequirement];
      if (!(await exists(launcher))) return manual('pip', ['py', ...tail], RcExternalTools.pythonLauncherMissing());
      if (await adminOnly(scripts)) {
        return manual('pip', [launcher, ...tail], RcExternalTools.pipAdminWin({ label, dir: scripts }));
      }
      return plan('pip', [launcher, ...tail]);
    }
    // 认不出的 Scripts 目录里的 .exe（别的启动器）不认 -U。
    if (/[\\/]scripts[\\/][^\\/]+$/i.test(real)) return null;
  }

  if (binary || zipapp) {
    const argv = [file, ...recipe.selfUpdateArgs];
    if (!(await adminOnly(path.dirname(real), real))) return plan('standalone', argv);
    if (platform === 'win32') return manual('standalone', argv, RcExternalTools.standaloneAdminWin({ label, dir: path.dirname(real) }));
    const reason = RcExternalTools.standaloneAdmin({ label, dir: path.dirname(real) }).text;
    return { method: 'standalone', argv, command: `sudo ${commandLine(argv, platform)}`, runnable: false, reason };
  }
  return null;
}

/**
 * Windows 上 pip 的入口程序（distlib 启动器）：启动器程序之后是 `#!<解释器>` 一行，紧接着是 zip（`__main__.py` 不压缩）。
 * 是导入 `module` 的启动器时返回那一行里的解释器路径（含空格时带双引号，去掉）；uv 的启动器（结尾是 `UVSC`）返回 'uv'；
 * 其他 null。
 */
async function pipLauncher(file: string, module: string): Promise<string | 'uv' | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > LAUNCHER_MAX_BYTES) return null;
  const data = await fs.readFile(file).catch(() => null);
  if (!data) return null;
  if (data.subarray(-4).toString('latin1') === 'UVSC') return 'uv';
  const zip = Buffer.from('PK\x03\x04', 'latin1');
  for (let at = data.indexOf(zip); at > 0; at = data.indexOf(zip, at + 1)) {
    if (data[at - 1] !== 0x0a) continue;
    const start = data.lastIndexOf('#!', at - 1);
    if (start < 0 || at - start > 1024 || data.subarray(start, at - 1).includes(0x0a)) continue;
    const line = data.subarray(start + 2, at).toString('utf8').trim();
    const quoted = /^"([^"]+)"/.exec(line);
    const interpreter = quoted ? quoted[1]! : line.split(/\s+/, 1)[0]!;
    if (!interpreter || !importsModule(data.subarray(at).toString('latin1'), module)) return null;
    return interpreter;
  }
  return null;
}

/**
 * Scoop 的目录（用户的 `~\scoop`、`SCOOP` 指的目录，或全局的）：入口是 `<目录>\shims\<app>.exe` 且旁边有 `<app>.shim`，
 * 或真实位置在 `<目录>\apps\<app>\<版本>\` 下且 `<目录>\shims` 在。不是时 null。
 */
async function scoopRoot(real: string, posix: string, app: string): Promise<string | null> {
  const name = escape(app);
  const shim = new RegExp(`^(.*)/shims/${name}\\.exe$`, 'i').exec(posix);
  if (shim && (await exists(`${real.slice(0, -'.exe'.length)}.shim`))) return real.slice(0, shim[1]!.length);
  const installed = new RegExp(`^(.*)/apps/${name}/[^/]+/`, 'i').exec(posix);
  if (installed && (await isDirectory(path.join(real.slice(0, installed[1]!.length), 'shims')))) return real.slice(0, installed[1]!.length);
  return null;
}

/** Chocolatey 装的：`<Chocolatey 目录>\bin\<包>.exe` 或 `lib\<包>\` 下；目录是 `ChocolateyInstall` 指的，或名叫 chocolatey。 */
function chocolatey(posix: string, pkg: string, env: NodeJS.ProcessEnv): boolean {
  const name = escape(pkg);
  const under = (root: string) => new RegExp(`^${escape(root)}/(?:bin/${name}\\.exe$|lib/${name}/)`, 'i').test(posix);
  const configured = envValue(env, 'ChocolateyInstall');
  return (configured ? under(configured.replace(/\\/g, '/').replace(/\/+$/, '')) : false) || new RegExp(`/chocolatey/(?:bin/${name}\\.exe$|lib/${name}/)`, 'i').test(posix);
}

/** Windows 上 PATH 里的程序（`<名字>.exe`），再看 `%LOCALAPPDATA%\Microsoft\WindowsApps`。winget 是那里的应用执行别名，跟随它的 `stat` 会失败，只看它在不在。 */
async function findWindowsProgram(name: string, searchPath: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const local = envValue(env, 'LOCALAPPDATA');
  const dirs = searchPath.split(path.delimiter).concat(local ? [path.join(local, 'Microsoft', 'WindowsApps')] : []);
  for (const dir of dirs) {
    if (!dir || (!path.isAbsolute(dir) && !path.win32.isAbsolute(dir))) continue;
    const file = path.join(dir, `${name}.exe`);
    if (await exists(file)) return file;
  }
  return null;
}

/** System32 里的 Windows PowerShell（不在 PATH 里找，免得被同名程序顶替；它随系统安装，总在）。 */
function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const root = envValue(env, 'SystemRoot') || envValue(env, 'windir') || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Windows 上要管理员权限才能改写的位置：Program Files（含 x86）、ProgramData、Windows 目录。 */
function windowsAdminDir(dir: string, env: NodeJS.ProcessEnv): boolean {
  const roots = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'SystemRoot']
    .map((name) => envValue(env, name))
    .concat(['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\Windows'])
    .filter((root): root is string => !!root)
    .map(normalizeDir);
  const target = normalizeDir(dir);
  return roots.some((root) => target === root || target.startsWith(`${root}/`));
}

/** 比较 Windows 路径：不分大小写，`\` 与 `/` 一样，忽略结尾的分隔符。 */
function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function sameDir(a: string, b: string): boolean {
  return normalizeDir(a) === normalizeDir(b);
}

function sameDirOrNull(a: string, b: string | undefined): boolean {
  return !!b && sameDir(a, b);
}

async function isDirectory(dir: string): Promise<boolean> {
  return (await fs.stat(dir).catch(() => null))?.isDirectory() ?? false;
}

/**
 * 解释器在不在：Microsoft Store 的 Python 是 WindowsApps 里的应用执行别名，跟随它的 `stat` 可能失败，看它本身在不在。
 */
async function exists(file: string): Promise<boolean> {
  if (!path.isAbsolute(file) && !path.win32.isAbsolute(file)) return false;
  return (await fs.lstat(file).catch(() => null)) !== null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readHead(file: string): Promise<Buffer | null> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Mach-O（含通用二进制）、ELF、PE。 */
function isNativeExecutable(head: Buffer): boolean {
  if (head.length < 4) return false;
  const magic = head.readUInt32BE(0);
  return (
    [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0x7f454c46].includes(magic) ||
    (head[0] === 0x4d && head[1] === 0x5a)
  );
}

function importsModule(text: string, module: string): boolean {
  return new RegExp(`^\\s*(?:from\\s+${escape(module)}(?:\\.|\\s)|import\\s+${escape(module)}\\b)`, 'm').test(text);
}

/**
 * 入口脚本的解释器：`#!/绝对路径/python`、`#!/usr/bin/env python3`（在 PATH 里找），或 pip 给长路径写的
 * `#!/bin/sh` + `'''exec' "<解释器>" "$0" "$@"`。解释器不能执行时 null。
 */
async function scriptInterpreter(text: string, searchPath: string, platform: NodeJS.Platform): Promise<string | null> {
  const first = text.slice(2).split('\n', 1)[0]!.trim();
  const words = first.split(/\s+/);
  let interpreter: string | null = words[0] ?? null;
  if (interpreter && path.posix.basename(interpreter) === 'sh') {
    const exec = /^'''exec' (?:"([^"]+)"|(\S+)) "\$0" "\$@"/m.exec(text);
    interpreter = exec ? (exec[1] ?? exec[2]!) : null;
  } else if (interpreter && path.posix.basename(interpreter) === 'env') {
    const name = words.slice(1).find((w) => !w.startsWith('-'));
    interpreter = name ? await findOnPath(name, searchPath, platform) : null;
  }
  if (!interpreter || !path.isAbsolute(interpreter)) return null;
  return (await isExecutableFile(interpreter)) ? interpreter : null;
}

async function writable(...targets: string[]): Promise<boolean> {
  for (const target of targets) {
    const ok = await fs.access(target, constants.W_OK).then(
      () => true,
      () => false,
    );
    if (!ok) return false;
  }
  return true;
}
