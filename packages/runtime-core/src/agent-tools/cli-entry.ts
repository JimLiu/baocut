import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RpcError, type CliEntryState, type CliEntryStatus } from '@baocut/protocol';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';

/**
 * 终端里的 `baocut` 入口（CLI 独立使用与发布 §3.2）：放在哪、现在是什么状态、装与移除。CLI 的 `baocut cli install|status|remove`
 * 与 App 的「安装命令行工具」都经 `cliEntry.*` 走这里，同一份规则。
 *
 * - 位置：macOS 与 Linux 在 `~/.local/bin/baocut` 放指向 App 入口的软链接；Windows 在 `%LOCALAPPDATA%\BaoCut\bin\baocut.cmd`
 *   写一个转发脚本（带 `FORWARDER_MARK` 那一行），再把这个目录加进用户 PATH（`HKCU\Environment` 的 `Path`，广播
 *   `WM_SETTINGCHANGE`）。都不要管理员权限。App 入口来自 `BAOCUT_CLI_ENTRY`；源码 Runtime 没有它，装不了。
 * - 状态：`none`；`current` 指向本 App 的入口；`stale` 指向另一份 BaoCut 入口；`broken` 指向的位置不在了；`foreign` 那里的东西
 *   不是 BaoCut 放的（文件、目录、指向别处的链接、没有标记行的脚本），永不覆盖或删除。软链接认作 BaoCut 入口的条件：指向的文件名是
 *   `baocut-cli`，或与记录里的目标相同。
 * - 记录：装好后在 `<Runtime Home>/cli-entry.json` 记下位置与目标。App 启动时（`repair`）只修记录里的那个、而且还指向记录里的目标
 *   的入口：指向独立 CLI 包（§9）或用户自己建的链接都不动。
 * - PATH：macOS 与 Linux 以用户的登录交互 shell 取 PATH（`$SHELL -ilc 'printenv PATH'`，限时几秒，只认最后一行，rc 文件的输出
 *   在它前面），按它找 `baocut`；不在 PATH 上时给出要加进 shell 配置的一行，不替用户改配置文件。Windows 读注册表里的系统与用户 PATH。
 */

/** 装过的入口记在 Runtime Home 下的这个文件。 */
export const CLI_ENTRY_RECORD_FILE = 'cli-entry.json';
/** Windows 转发脚本里的标记行：有它的 `baocut.cmd` 是 BaoCut 写的。 */
export const FORWARDER_MARK = 'rem BaoCut command line forwarder';
/** macOS 的 App 入口文件名（`BaoCut.app/Contents/MacOS/baocut-cli`）：软链接指向这个名字的文件时认作 BaoCut 入口。 */
const ENTRY_NAMES = new Set(['baocut-cli', 'baocut.cmd']);

export interface CommandResult {
  ok: boolean;
  stdout: string;
}

/** 跑一条命令：stdin 关掉、stderr 丢掉，超时杀掉，算失败。 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<CommandResult>;

const SHELL_TIMEOUT_MS = 5_000;
const POWERSHELL_TIMEOUT_MS = 20_000;

export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], env: options.env, windowsHide: true });
    } catch {
      resolve({ ok: false, stdout: '' });
      return;
    }
    let stdout = '';
    let done = false;
    const finish = (result: CommandResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, stdout });
    }, options.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.on('error', () => finish({ ok: false, stdout }));
    child.on('close', (code) => finish({ ok: code === 0, stdout }));
  });

export interface CliEntryInstallerOptions {
  /** Runtime Home（记录放这里）。 */
  home: string;
  /** 用户主目录；测试换成临时目录。 */
  userHome?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: CommandRunner;
}

interface CliEntryRecord {
  path: string;
  target: string;
}

interface Inspected {
  state: CliEntryState;
  target: string | null;
}

export class CliEntryInstaller {
  private readonly home: string;
  private readonly userHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly run: CommandRunner;

  constructor(options: CliEntryInstallerOptions) {
    this.home = options.home;
    this.env = options.env ?? process.env;
    this.userHome = options.userHome ?? (this.env.HOME || this.env.USERPROFILE || os.homedir());
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? runCommand;
  }

  private get win(): boolean {
    return this.platform === 'win32';
  }

  private get p(): path.PlatformPath {
    return this.win ? path.win32 : path.posix;
  }

  /** App 自带的命令行入口；没有或文件不在时 null。 */
  entry(): string | null {
    const entry = this.env.BAOCUT_CLI_ENTRY;
    return entry && fs.existsSync(entry) ? entry : null;
  }

  /** BaoCut 放入口的位置。 */
  location(): string {
    if (!this.win) return path.posix.join(this.userHome, '.local', 'bin', 'baocut');
    const local = this.env.LOCALAPPDATA || path.win32.join(this.userHome, 'AppData', 'Local');
    return path.win32.join(local, 'BaoCut', 'bin', 'baocut.cmd');
  }

  async status(): Promise<CliEntryStatus> {
    const at = this.location();
    const entry = this.entry();
    const found = this.inspect(at, entry);
    const shell = await this.shell(this.p.dirname(at));
    return {
      entry,
      path: at,
      state: found.state,
      target: found.target,
      managed: this.isManaged(at, found),
      shell,
      pathHint: shell && !shell.dirOnPath ? this.pathHint() : null,
    };
  }

  /** 装或修：BaoCut 的入口（任何状态）改成指向本 App；`foreign` 拒绝。Windows 再把目录加进用户 PATH。 */
  async install(): Promise<CliEntryStatus> {
    const entry = this.entry();
    if (!entry) throw new RpcError('unsupported', RcSkills.cliEntryUnavailable(), { code: 'CLI_ENTRY_UNAVAILABLE' });
    const at = this.location();
    if (this.inspect(at, entry).state === 'foreign') throw taken(at);
    this.place(at, entry);
    if (this.win && !(await this.userPath('add', this.p.dirname(at)))) {
      throw new RpcError('internal', RcSkills.cliEntryPathFailed({ dir: this.p.dirname(at) }), {
        code: 'CLI_ENTRY_PATH_FAILED',
        path: this.p.dirname(at),
      });
    }
    return this.status();
  }

  /** 移除 BaoCut 的入口：软链接只删链接；Windows 连同用户 PATH 里的那个目录。`foreign` 拒绝，`none` 什么都不做。 */
  async remove(): Promise<CliEntryStatus> {
    const at = this.location();
    const found = this.inspect(at, this.entry());
    if (found.state === 'foreign') throw taken(at);
    if (found.state !== 'none') {
      fs.rmSync(at, { force: true });
      this.forget();
      if (this.win) {
        const dir = this.p.dirname(at);
        // 目录留在 PATH 里不碍事：改不成也不算移除失败。
        await this.userPath('remove', dir);
        try {
          fs.rmdirSync(dir);
        } catch {
          // 里面还有别的东西，留着。
        }
      }
    }
    return this.status();
  }

  /**
   * App 启动时：记录里的入口还指向记录里的目标、而那个目标已经不是本 App（App 被移动、换了位置）时，改指向本 App。只改文件，
   * 不动 PATH。改了返回 true。
   */
  repair(): boolean {
    const entry = this.entry();
    if (!entry) return false;
    const at = this.location();
    const found = this.inspect(at, entry);
    if ((found.state !== 'stale' && found.state !== 'broken') || !this.isManaged(at, found)) return false;
    this.place(at, entry);
    return true;
  }

  // ---- 位置 ----

  inspect(at: string, entry: string | null): Inspected {
    return this.win ? this.inspectForwarder(at, entry) : this.inspectLink(at, entry);
  }

  private inspectLink(at: string, entry: string | null): Inspected {
    let stat;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return { state: 'none', target: null };
    }
    if (!stat.isSymbolicLink()) return { state: 'foreign', target: null };
    const target = path.posix.resolve(path.posix.dirname(at), fs.readlinkSync(at));
    const recorded = this.readRecord();
    const ours = ENTRY_NAMES.has(path.posix.basename(target)) || (!!recorded && samePath(recorded.target, target, this.platform));
    const real = safeRealpath(at);
    if (!real) return { state: ours ? 'broken' : 'foreign', target };
    if (entry && samePath(real, safeRealpath(entry) ?? entry, this.platform)) return { state: 'current', target };
    const realOurs = ours || ENTRY_NAMES.has(path.posix.basename(real));
    return { state: realOurs ? 'stale' : 'foreign', target };
  }

  private inspectForwarder(at: string, entry: string | null): Inspected {
    let text;
    try {
      const stat = fs.lstatSync(at);
      if (!stat.isFile()) return { state: 'foreign', target: null };
      text = fs.readFileSync(at, 'utf8');
    } catch {
      return { state: 'none', target: null };
    }
    if (!text.split(/\r?\n/).some((line) => line.trim() === FORWARDER_MARK)) return { state: 'foreign', target: null };
    const target = parseForwarder(text);
    if (!target || !fs.existsSync(target)) return { state: 'broken', target };
    if (entry && samePath(target, entry, this.platform)) return { state: 'current', target };
    return { state: 'stale', target };
  }

  private isManaged(at: string, found: Inspected): boolean {
    if (found.state === 'none' || found.state === 'foreign' || !found.target) return false;
    const recorded = this.readRecord();
    return !!recorded && samePath(recorded.path, at, this.platform) && samePath(recorded.target, found.target, this.platform);
  }

  /** 在 `at` 放指向 `entry` 的入口：旁边做好，再换上去；记下来。 */
  private place(at: string, entry: string): void {
    const dir = this.p.dirname(at);
    fs.mkdirSync(dir, { recursive: true });
    const staging = this.p.join(dir, `.${this.p.basename(at)}.baocut-${process.pid}-${Date.now()}`);
    try {
      if (this.win) fs.writeFileSync(staging, forwarderScript(entry));
      else fs.symlinkSync(entry, staging);
      fs.renameSync(staging, at);
    } catch (error) {
      fs.rmSync(staging, { force: true });
      throw error;
    }
    this.writeRecord({ path: at, target: entry });
  }

  // ---- 记录 ----

  private readRecord(): CliEntryRecord | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.home, CLI_ENTRY_RECORD_FILE), 'utf8')) as Partial<CliEntryRecord>;
      return typeof parsed.path === 'string' && typeof parsed.target === 'string' ? { path: parsed.path, target: parsed.target } : null;
    } catch {
      return null;
    }
  }

  private writeRecord(record: CliEntryRecord): void {
    const file = path.join(this.home, CLI_ENTRY_RECORD_FILE);
    fs.mkdirSync(this.home, { recursive: true });
    const temp = `${file}.${process.pid}-${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ ...record, installedAt: new Date().toISOString() }, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  private forget(): void {
    fs.rmSync(path.join(this.home, CLI_ENTRY_RECORD_FILE), { force: true });
  }

  // ---- PATH ----

  /** 终端里会找到哪个 `baocut`，`dir` 在不在 PATH 上；查不出时 null。 */
  private async shell(dir: string): Promise<CliEntryStatus['shell']> {
    const dirs = this.win ? await this.windowsPath() : await this.loginShellPath();
    if (!dirs) return null;
    const expand = (d: string) => (!this.win && (d === '~' || d.startsWith('~/')) ? path.posix.join(this.userHome, d.slice(1)) : d);
    const list = dirs.map(expand);
    return {
      found: findOnPath(list, this.win ? ['baocut.exe', 'baocut.cmd'] : ['baocut'], this.platform),
      dirOnPath: list.some((d) => samePath(d, dir, this.platform)),
    };
  }

  private loginShell(): string {
    let fromUser: string | undefined;
    try {
      fromUser = os.userInfo().shell ?? undefined;
    } catch {
      fromUser = undefined;
    }
    return this.env.SHELL || fromUser || '/bin/sh';
  }

  /** 新开一个终端时的 PATH：从系统的最小环境起一个登录交互 shell，让它按用户的配置文件算。 */
  private async loginShellPath(): Promise<string[] | null> {
    const env: NodeJS.ProcessEnv = {
      HOME: this.userHome,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'dumb',
      ...pick(this.env, ['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR']),
    };
    const result = await this.run(this.loginShell(), ['-ilc', 'printenv PATH'], { env, timeoutMs: SHELL_TIMEOUT_MS });
    if (!result.ok) return null;
    const last = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
    return last ? last.split(':').filter(Boolean) : null;
  }

  /** 注册表里的系统 PATH 与用户 PATH（新开的终端拿到的就是它们）。 */
  private async windowsPath(): Promise<string[] | null> {
    const result = await this.run(this.powershell(), encodedCommand(WINDOWS_PATH_PROBE), { timeoutMs: POWERSHELL_TIMEOUT_MS });
    if (!result.ok) return null;
    const parsed = parseWindowsPathProbe(result.stdout);
    if (!parsed) return null;
    return [parsed.machine, parsed.user].flatMap((value) => value.split(';')).map((d) => expandWindows(d.trim(), this.env)).filter(Boolean);
  }

  /** 把 `dir` 加进或移出用户 PATH；成功（含本来就是那样）返回 true。 */
  private async userPath(mode: 'add' | 'remove', dir: string): Promise<boolean> {
    const env = { ...this.env, BAOCUT_CLI_PATH_DIR: dir, BAOCUT_CLI_PATH_MODE: mode };
    const result = await this.run(this.powershell(), encodedCommand(WINDOWS_USER_PATH_SCRIPT), { env, timeoutMs: POWERSHELL_TIMEOUT_MS });
    const last = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
    return result.ok && (last === 'changed' || last === 'unchanged');
  }

  private powershell(): string {
    return path.win32.join(this.env.SystemRoot || this.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }

  /** `~/.local/bin` 不在 PATH 上时要加的那一行，与它该放进的配置文件。 */
  private pathHint(): CliEntryStatus['pathHint'] {
    if (this.win) return null;
    const shell = path.posix.basename(this.loginShell());
    if (shell === 'fish') return { line: 'fish_add_path $HOME/.local/bin', file: '~/.config/fish/config.fish' };
    const line = 'export PATH="$HOME/.local/bin:$PATH"';
    if (shell === 'zsh') return { line, file: '~/.zshrc' };
    if (shell === 'bash') return { line, file: this.platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc' };
    return { line, file: null };
  }
}

/** Windows 的转发脚本：调用 App 安装目录里的 `baocut.cmd`，参数原样传过去。`%` 要写成 `%%`。 */
export function forwarderScript(target: string): string {
  return ['@echo off', FORWARDER_MARK, `"${target.replace(/%/g, '%%')}" %*`, ''].join('\r\n');
}

/** 转发脚本转发到哪里；认不出时 null。 */
export function parseForwarder(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^"(.+)" %\*\s*$/.exec(line.trim());
    if (match) return match[1]!.replace(/%%/g, '%');
  }
  return null;
}

/** 读注册表里的系统与用户 PATH，写成一行 JSON。 */
export const WINDOWS_PATH_PROBE = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "@{ machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); user = [Environment]::GetEnvironmentVariable('Path', 'User') } | ConvertTo-Json -Compress",
].join('\n');

/**
 * 把 `BAOCUT_CLI_PATH_DIR` 加进（`BAOCUT_CLI_PATH_MODE=add`）或移出（`remove`）用户 PATH，最后一行输出 `changed` 或 `unchanged`。
 * 不用 `setx`（会把超过 1024 个字符的 PATH 截断）；按原样读出（不展开 `%USERPROFILE%` 这类变量）、原样写回，值的类型不变
 * （没有时用可展开的字符串）；改了之后广播 `WM_SETTINGCHANGE`，之后新开的终端拿到新的 PATH。
 */
export const WINDOWS_USER_PATH_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$dir = $env:BAOCUT_CLI_PATH_DIR
$mode = $env:BAOCUT_CLI_PATH_MODE
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
if ($null -ne $key.GetValue('Path')) {
  $existing = $key.GetValueKind('Path')
  if ($existing -eq [Microsoft.Win32.RegistryValueKind]::String) { $kind = $existing }
}
$norm = { param($p) [Environment]::ExpandEnvironmentVariables($p).Trim().TrimEnd('\').ToLowerInvariant() }
$want = & $norm $dir
$parts = @($raw -split ';' | Where-Object { $_.Trim() -ne '' })
$has = @($parts | Where-Object { (& $norm $_) -eq $want }).Count -gt 0
if ($mode -eq 'add' -and -not $has) {
  $next = @($parts) + @($dir)
} elseif ($mode -eq 'remove' -and $has) {
  $next = @($parts | Where-Object { (& $norm $_) -ne $want })
} else {
  'unchanged'
  return
}
$key.SetValue('Path', ($next -join ';'), $kind)
$key.Close()
Add-Type -Namespace BaoCut -Name UserEnvironment -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
$result = [UIntPtr]::Zero
[void][BaoCut.UserEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
'changed'
`;

/** PowerShell 的参数：脚本按 UTF-16LE 编成 base64，多行与引号都不用转义。 */
export function encodedCommand(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

/** `WINDOWS_PATH_PROBE` 的输出；认不出时 null。 */
export function parseWindowsPathProbe(output: string): { machine: string; user: string } | null {
  try {
    const value = JSON.parse(output.trim().replace(/^\uFEFF/, '')) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    return { machine: text(value.machine), user: text(value.user) };
  } catch {
    return null;
  }
}

/** 展开 `%NAME%`（注册表里的可展开字符串）；认不出的照原样。 */
function expandWindows(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? (env[key] ?? whole) : whole;
  });
}

/** 按顺序在这些目录里找第一个可执行的 `names` 之一（同一目录里按 `names` 的顺序）。 */
export function findOnPath(dirs: readonly string[], names: readonly string[], platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix;
  for (const dir of dirs) {
    for (const name of names) {
      const file = p.join(dir, name);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {
        // 下一个。
      }
    }
  }
  return null;
}

/**
 * 终端里的 `baocut`（`agentSkill.status` 用）：先按这个进程的 PATH，再看常见的安装位置（从 Finder 打开的 App 拿到的 PATH 很短）。
 * Windows 认 `.exe` 与 `.cmd`。
 */
export function findCliOnPath(env: NodeJS.ProcessEnv, userHome: string, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  if (!win) dirs.push('/usr/local/bin', '/opt/homebrew/bin', path.posix.join(userHome, '.local', 'bin'), path.posix.join(userHome, 'bin'));
  return findOnPath(dirs, win ? ['baocut.exe', 'baocut.cmd'] : ['baocut'], platform);
}

function pick(env: NodeJS.ProcessEnv, names: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of names) if (env[name] !== undefined) out[name] = env[name];
  return out;
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const norm = (x: string) => p.resolve(x).replace(/[\\/]+$/, '');
  return platform === 'win32' || platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function taken(at: string): RpcError {
  return new RpcError('conflict', RcSkills.cliEntryTaken({ path: at }), { code: 'CLI_ENTRY_TAKEN', path: at });
}
