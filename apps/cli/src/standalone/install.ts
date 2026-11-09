import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STANDALONE_WINDOWS_CURRENT,
  standaloneLayout,
  standaloneVersionDir,
  standaloneVersionsRoot,
  type CliEntryState,
  type CliEntryStatus,
} from '@baocut/protocol';
import { findOnPath } from '../doctor.ts';
import { CliError } from '../envelope.ts';
import { standalonePackageAt, type StandalonePackage } from '../runtime/connection.ts';
import { S } from './standalone-copy.ts';

/**
 * 独立 CLI 包装进用户目录（CLI 独立使用与发布 §9.3）：版本目录、当前与上一版的记录、终端里的 `baocut`。只在独立包里跑，不经 Runtime
 * （Runtime 坏了也能装、能更新）。
 *
 * - 版本目录：macOS `~/.local/share/baocut/versions/<版本>-build.<n>/BaoCut CLI.app`，Windows
 *   `%LOCALAPPDATA%\BaoCut\cli\versions\<版本>-build.<n>\`。记录 `state.json` 在 `versions` 旁边：`current` 与 `previous`（回滚用）。
 * - 入口：macOS `~/.local/bin/baocut` 是指向当前版本启动器的软链接（换链接是原子的）；Windows `%LOCALAPPDATA%\BaoCut\bin\baocut.cmd`
 *   是转发到 `%LOCALAPPDATA%\BaoCut\cli\current\baocut.cmd` 的转发脚本，`current` 是指向当前版本目录的目录联接。更新只换联接：
 *   cmd 边执行边读批处理文件，正在跑的 `baocut update` 自己就在执行转发脚本。
 * - 与 App 的规则相同（`cliEntry.*`）：指向某个 BaoCut 入口（App 的或独立包的）的入口可以改，别的东西（`foreign`）永不覆盖或删除。
 *   PATH 上的 `baocut` 由独立包管（§9.4）：App 不改指向独立包的入口。
 */

/** Windows 转发脚本里的标记行，与 Runtime 写的相同（`packages/runtime-core/src/agent-tools/cli-entry.ts` 的 `FORWARDER_MARK`）。 */
export const FORWARDER_MARK = 'rem BaoCut command line forwarder';
const ENTRY_NAMES = new Set(['baocut-cli', 'baocut.cmd']);
const VERSION_DIR = /^(\d+)\.(\d+)\.(\d+)-build\.(\d+)$/;
const POWERSHELL_TIMEOUT_MS = 20_000;

export interface StandaloneState {
  current: string | null;
  previous: string | null;
}

export interface StandalonePlaces {
  /** 版本目录的父目录。 */
  versions: string;
  /** `current` / `previous` 的记录。 */
  state: string;
  /** 终端里的 `baocut`：macOS 的软链接、Windows 的转发脚本。 */
  entry: string;
  /** Windows 指向当前版本目录的目录联接；macOS 没有。 */
  junction: string | null;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

/** 跑一条命令：stdin 关掉，超时杀掉，算失败。 */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env, windowsHide: true });
    } catch {
      resolve({ ok: false, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, options.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 1_000_000) stderr += chunk;
    });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });

export interface StandaloneInstallerOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: CommandRunner;
}

/** 独立包自己的 `cli install|status|remove` 的结果：同 `cliEntry.status`，`entry` 是入口应指向的位置，另带装好的版本。 */
export interface StandaloneEntryStatus extends CliEntryStatus {
  installed: StandaloneState & { versions: string[]; root: string };
}

export class StandaloneInstaller {
  readonly platform: NodeJS.Platform;
  readonly places: StandalonePlaces;
  private readonly env: NodeJS.ProcessEnv;
  private readonly run: CommandRunner;
  private readonly userHome: string;

  constructor(options: StandaloneInstallerOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? runCommand;
    this.userHome = this.env.HOME || this.env.USERPROFILE || os.homedir();
    this.places = standalonePlaces(this.env, this.platform, this.userHome);
  }

  private get win(): boolean {
    return this.platform === 'win32';
  }

  private get p(): path.PlatformPath {
    return this.win ? path.win32 : path.posix;
  }

  // ---- 版本目录与记录 ----

  versionPath(name: string): string {
    return this.p.join(this.places.versions, name);
  }

  /** 装好的版本目录（只认有清单的），按版本从旧到新。 */
  versions(): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.places.versions);
    } catch {
      return [];
    }
    return names.filter((name) => VERSION_DIR.test(name) && this.packageAt(name) !== null).sort(compareVersionDirs);
  }

  packageAt(name: string): StandalonePackage | null {
    return standalonePackageAt(this.versionPath(name), this.platform);
  }

  readState(): StandaloneState {
    try {
      const wire = JSON.parse(fs.readFileSync(this.places.state, 'utf8')) as Record<string, unknown>;
      const name = (value: unknown) => (typeof value === 'string' && VERSION_DIR.test(value) ? value : null);
      return { current: name(wire.current), previous: name(wire.previous) };
    } catch {
      return { current: null, previous: null };
    }
  }

  writeState(state: StandaloneState): void {
    fs.mkdirSync(this.p.dirname(this.places.state), { recursive: true });
    const temp = `${this.places.state}.${process.pid}-${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: 1, ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
    fs.renameSync(temp, this.places.state);
  }

  /** `pkg` 所在的版本目录名：它就在 `versions` 下面时。 */
  versionOf(pkg: StandalonePackage): string | null {
    const parent = this.p.dirname(pkg.root);
    const name = this.p.basename(pkg.root);
    return samePath(realpathOr(parent), realpathOr(this.places.versions), this.platform) && VERSION_DIR.test(name) ? name : null;
  }

  /**
   * 把 `pkg` 放进版本目录（已经在那里、或那里已有同一版本时不拷），返回目录名。旁边的临时目录里拷好再改名：macOS 用 `ditto`
   * （保留签名与扩展属性），Windows 逐项递归复制。
   */
  async adopt(pkg: StandalonePackage): Promise<string> {
    const own = this.versionOf(pkg);
    if (own) return own;
    const name = standaloneVersionDir(pkg.manifest);
    const existing = this.packageAt(name);
    if (existing && sameBuild(existing, pkg)) return name;
    const layout = standaloneLayout(this.platform)!;
    const staging = this.stagingDir('install');
    try {
      for (const item of layout.top) {
        const from = this.p.join(pkg.root, item);
        const to = this.p.join(staging, item);
        if (this.win) fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
        else {
          const copied = await this.run('/usr/bin/ditto', [from, to], { timeoutMs: 600_000 });
          if (!copied.ok) throw new CliError('STANDALONE_COPY_FAILED', S.copyFailed(from, this.places.versions, copied.stderr.trim()));
        }
      }
      this.moveInto(staging, name);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    return name;
  }

  /** 临时目录：放在 `versions` 下面（同一个卷，改名不跨卷），名字以 `.` 开头不算版本。 */
  stagingDir(kind: string): string {
    fs.mkdirSync(this.places.versions, { recursive: true });
    const dir = this.p.join(this.places.versions, `.${kind}-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir);
    return dir;
  }

  /** 临时目录改名成版本目录；那里已有不成形的东西先删掉。 */
  moveInto(staging: string, name: string): void {
    const dest = this.versionPath(name);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
  }

  // ---- 入口 ----

  /** 入口应指向的位置：macOS 是版本目录里的启动器，Windows 是 `current` 联接里的 `baocut.cmd`。 */
  launcherFor(name: string): string {
    const layout = standaloneLayout(this.platform)!;
    if (this.win) return this.p.join(this.places.junction!, ...layout.launcher);
    return this.p.join(this.versionPath(name), ...layout.launcher);
  }

  /**
   * 入口现在的样子（从独立包这边看）：`current` 指向 `name` 这个版本；`stale` 指向另一份 BaoCut 入口（App 或独立包的别的版本）；
   * `broken` 指向的位置不在了；`foreign` 不是 BaoCut 放的。`ours` 指入口指向本机装的独立包（`baocut update` 只在这时换它）。
   */
  inspect(name: string | null): { state: CliEntryState; target: string | null; ours: boolean } {
    return this.win ? this.inspectForwarder(name) : this.inspectLink(name);
  }

  private inspectLink(name: string | null): { state: CliEntryState; target: string | null; ours: boolean } {
    const at = this.places.entry;
    let stat;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return { state: 'none', target: null, ours: false };
    }
    if (!stat.isSymbolicLink()) return { state: 'foreign', target: null, ours: false };
    const target = path.posix.resolve(path.posix.dirname(at), fs.readlinkSync(at));
    const ours = this.insideVersions(target);
    const real = safeRealpath(at);
    if (!real) return { state: ours || ENTRY_NAMES.has(path.posix.basename(target)) ? 'broken' : 'foreign', target, ours };
    if (name && samePath(real, realpathOr(this.launcherFor(name)), this.platform)) return { state: 'current', target, ours: true };
    return { state: ours || ENTRY_NAMES.has(path.posix.basename(real)) ? 'stale' : 'foreign', target, ours };
  }

  private inspectForwarder(name: string | null): { state: CliEntryState; target: string | null; ours: boolean } {
    const at = this.places.entry;
    let text;
    try {
      if (!fs.lstatSync(at).isFile()) return { state: 'foreign', target: null, ours: false };
      text = fs.readFileSync(at, 'utf8');
    } catch {
      return { state: 'none', target: null, ours: false };
    }
    if (!text.split(/\r?\n/).some((line) => line.trim() === FORWARDER_MARK)) return { state: 'foreign', target: null, ours: false };
    const target = parseForwarder(text);
    const ours = !!target && samePath(target, this.launcherFor(name ?? ''), this.platform);
    if (!target || !fs.existsSync(target)) return { state: 'broken', target, ours };
    if (ours && name && samePath(realpathOr(this.places.junction!), realpathOr(this.versionPath(name)), this.platform)) {
      return { state: 'current', target, ours };
    }
    return { state: 'stale', target, ours };
  }

  private insideVersions(file: string): boolean {
    const root = this.places.versions.replace(/[\\/]+$/, '');
    const norm = (p: string) => (this.platform === 'darwin' ? p.toLowerCase() : p);
    return norm(file).startsWith(norm(root) + this.p.sep);
  }

  /** 让入口指向 `name`：macOS 换软链接；Windows 换 `current` 联接，没有转发脚本时写一个、把目录加进用户 PATH。 */
  async point(name: string): Promise<void> {
    const at = this.places.entry;
    const dir = this.p.dirname(at);
    fs.mkdirSync(dir, { recursive: true });
    if (!this.win) {
      const staging = path.posix.join(dir, `.baocut.baocut-${process.pid}-${Date.now()}`);
      try {
        fs.symlinkSync(this.launcherFor(name), staging);
        fs.renameSync(staging, at);
      } catch (error) {
        fs.rmSync(staging, { force: true });
        throw error;
      }
      return;
    }
    this.switchJunction(name);
    const script = forwarderScript(this.launcherFor(name));
    if (readText(at) !== script) {
      const staging = path.win32.join(dir, `.baocut.cmd.baocut-${process.pid}-${Date.now()}`);
      fs.writeFileSync(staging, script);
      fs.renameSync(staging, at);
    }
    if (!(await this.userPath('add', dir))) throw new CliError('CLI_ENTRY_PATH_FAILED', S.pathFailed(dir), { path: dir });
  }

  /** Windows：`current` 联接改指向 `name`（删掉旧联接再建：联接不能原地改，目录也不能改名覆盖）。 */
  switchJunction(name: string): void {
    const junction = this.places.junction!;
    fs.mkdirSync(path.win32.dirname(junction), { recursive: true });
    try {
      if (fs.lstatSync(junction).isSymbolicLink()) fs.unlinkSync(junction);
      else throw new CliError('CLI_ENTRY_TAKEN', S.entryTaken(junction), { path: junction });
    } catch (error) {
      if (error instanceof CliError) throw error;
      // 没有旧联接。
    }
    fs.symlinkSync(this.versionPath(name), junction, 'junction');
  }

  /** 移除入口：软链接只删链接；Windows 连同 `current` 联接与用户 PATH 里的目录。版本目录留着。 */
  async unplace(): Promise<void> {
    fs.rmSync(this.places.entry, { force: true });
    if (!this.win) return;
    try {
      if (fs.lstatSync(this.places.junction!).isSymbolicLink()) fs.unlinkSync(this.places.junction!);
    } catch {
      // 没有联接。
    }
    const dir = path.win32.dirname(this.places.entry);
    await this.userPath('remove', dir);
    try {
      fs.rmdirSync(dir);
    } catch {
      // 里面还有别的东西，留着。
    }
  }

  // ---- 状态 ----

  status(name: string | null): StandaloneEntryStatus {
    const at = this.places.entry;
    const found = this.inspect(name);
    const dir = this.p.dirname(at);
    const pathList = ((this.win ? (this.env.Path ?? this.env.PATH) : this.env.PATH) ?? '').split(this.win ? ';' : ':').filter(Boolean);
    const onPath = findOnPath('baocut', this.env, this.platform);
    const dirOnPath = pathList.some((d) => samePath(d, dir, this.platform));
    const state = this.readState();
    return {
      entry: name ? this.launcherFor(name) : null,
      path: at,
      state: found.state,
      target: found.target,
      managed: found.ours,
      shell: { found: onPath?.found ?? null, dirOnPath },
      pathHint: !this.win && !dirOnPath ? pathHint(this.env.SHELL || safeShell(), this.platform) : null,
      installed: { ...state, versions: this.versions(), root: this.places.versions },
    };
  }

  // ---- PATH（Windows） ----

  private async userPath(mode: 'add' | 'remove', dir: string): Promise<boolean> {
    const env = { ...this.env, BAOCUT_CLI_PATH_DIR: dir, BAOCUT_CLI_PATH_MODE: mode };
    const powershell = path.win32.join(this.env.SystemRoot || this.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await this.run(powershell, encodedCommand(WINDOWS_USER_PATH_SCRIPT), { env, timeoutMs: POWERSHELL_TIMEOUT_MS });
    const last = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
    return result.ok && (last === 'changed' || last === 'unchanged');
  }
}

export function standalonePlaces(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, userHome: string): StandalonePlaces {
  const root = standaloneVersionsRoot(platform);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.win32.join(userHome, 'AppData', 'Local');
    const versions = path.win32.join(local, ...root.segments);
    return {
      versions,
      state: path.win32.join(path.win32.dirname(versions), 'state.json'),
      entry: path.win32.join(local, 'BaoCut', 'bin', 'baocut.cmd'),
      junction: path.win32.join(local, ...STANDALONE_WINDOWS_CURRENT),
    };
  }
  const versions = path.posix.join(userHome, ...root.segments);
  return {
    versions,
    state: path.posix.join(path.posix.dirname(versions), 'state.json'),
    entry: path.posix.join(userHome, '.local', 'bin', 'baocut'),
    junction: null,
  };
}

/** 版本目录名按版本号与 build 排序。 */
export function compareVersionDirs(a: string, b: string): number {
  const pa = VERSION_DIR.exec(a)!.slice(1).map(Number);
  const pb = VERSION_DIR.exec(b)!.slice(1).map(Number);
  for (let i = 0; i < 4; i += 1) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function isVersionDir(name: string): boolean {
  return VERSION_DIR.test(name);
}

function sameBuild(a: StandalonePackage, b: StandalonePackage): boolean {
  const x = a.manifest;
  const y = b.manifest;
  return x.version === y.version && x.build === y.build && x.target === y.target && x.variant === y.variant;
}

/** `~/.local/bin` 不在 PATH 上时要加的那一行与配置文件，与 Runtime 给的相同（`cliEntry.status` 的 `pathHint`）。 */
export function pathHint(shellPath: string, platform: NodeJS.Platform): CliEntryStatus['pathHint'] {
  const shell = path.posix.basename(shellPath);
  if (shell === 'fish') return { line: 'fish_add_path $HOME/.local/bin', file: '~/.config/fish/config.fish' };
  const line = 'export PATH="$HOME/.local/bin:$PATH"';
  if (shell === 'zsh') return { line, file: '~/.zshrc' };
  if (shell === 'bash') return { line, file: platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc' };
  return { line, file: null };
}

/** Windows 的转发脚本，与 Runtime 写的相同（`cli-entry.ts` 的 `forwarderScript`）：`%` 写成 `%%`。 */
export function forwarderScript(target: string): string {
  return ['@echo off', FORWARDER_MARK, `"${target.replace(/%/g, '%%')}" %*`, ''].join('\r\n');
}

export function parseForwarder(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^"(.+)" %\*\s*$/.exec(line.trim());
    if (match) return match[1]!.replace(/%%/g, '%');
  }
  return null;
}

/** 把 `BAOCUT_CLI_PATH_DIR` 加进或移出用户 PATH，与 Runtime 用的相同（`cli-entry.ts` 的 `WINDOWS_USER_PATH_SCRIPT`，测试核对两份一致）。 */
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

export function encodedCommand(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

function safeShell(): string {
  try {
    return os.userInfo().shell ?? '/bin/sh';
  } catch {
    return '/bin/sh';
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function realpathOr(p: string): string {
  return safeRealpath(p) ?? p;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const norm = (x: string) => p.resolve(x).replace(/[\\/]+$/, '');
  return platform === 'win32' || platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}
