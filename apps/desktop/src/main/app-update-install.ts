import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppUpdateFailure, AppUpdateInfo } from '@baocut/ui';
import { BUNDLE_ID, NSIS_UNINSTALLER, installerScript, mountPath, teamIdentifier } from './app-update-rules.ts';
import type { InstallOutcome, Prepared, StagedApp } from './app-update-service.ts';

/*
 * 平台换包（架构设计 §2.6）。macOS 分两步：下载（或在缓存里找到）之后先 `prepareMac`——解开 ZIP（或从 DMG 里拷出来）
 * 到缓存目录的 `unpack-<build>`，校验新包的 bundle 标识、版本、签名、Team ID 与公证，通过了才算「已下载」；安装时
 * （「重启并更新」或退出即安装）`installMac` 只核对就位的新包还在、身份与版本没变，写换包脚本并脱离应用起它。
 * Windows 在应用退出时静默起 NSIS 安装器。这台机器不能自己换包（不是正式打包的、`.app` 所在目录不可写、运行中的应用
 * 没有 Team ID、Windows 的 zip 版）时不就位，安装时返回 `fallback`，由服务在访达里显示安装包并打开下载页。
 * 外部命令经注入的 `exec` 跑，单测给假输出；这里从不运行生成的脚本。
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 跑一条外部命令；`signal` 停了就结束它（取消校验时）。 */
export type Exec = (file: string, args: string[], signal?: AbortSignal) => Promise<ExecResult>;

const FALLBACK: InstallOutcome = { type: 'fallback' };
const failed = (failure: AppUpdateFailure, detail: string): InstallOutcome => ({ type: 'failed', failure, detail });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 跑一条命令，退出码不是 0 就抛（带 stderr）；`signal` 停了也抛。 */
async function run(exec: Exec, file: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await exec(file, args, signal);
  if (signal?.aborted) throw new Error('cancelled');
  if (result.code !== 0) throw new Error(`${file} exited ${result.code}: ${result.stderr.trim()}`);
  return result.stdout;
}

/** `codesign -dv --verbose=2` 读 Team ID（在 stderr；这条命令对未签名的包也返回非 0，所以不看退出码）。 */
export async function macTeamId(exec: Exec, bundle: string, signal?: AbortSignal): Promise<string | null> {
  const result = await exec('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], signal);
  return teamIdentifier(result.stderr);
}

export interface MacInstallDeps {
  exec: Exec;
  /** 正在运行的 `.app`；不是正式打包的、不在包里的为 null。 */
  runningBundle: string | null;
  writable(dir: string): Promise<boolean>;
  cacheDir: string | null;
  pid: number;
  /** 脱离应用进程起换包脚本，输出写进日志。 */
  launchScript(script: string, log: string): Promise<void>;
}

/** macOS 能不能不经用户手动地换包：在正式的 `.app` 里跑、`.app` 的父目录可写、运行中的应用有 Team ID。 */
export async function macCanAutoInstall(deps: Pick<MacInstallDeps, 'exec' | 'runningBundle' | 'writable'>): Promise<boolean> {
  if (!deps.runningBundle) return false;
  if (!(await deps.writable(path.dirname(deps.runningBundle)))) return false;
  return (await macTeamId(deps.exec, deps.runningBundle)) !== null;
}

async function firstApp(dir: string): Promise<string | null> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith('.app')).sort();
  return names[0] ? path.join(dir, names[0]) : null;
}

type StageResult = { ok: true; staged: StagedApp } | { ok: false; detail: string };

/**
 * 解开到缓存目录的 `unpack-<build>`：ZIP 用 ditto 解开；DMG 只读挂上，把里面的 `.app` 用 ditto 拷出来就卸下（不让
 * 一个卷在用户干活时一直挂着）。返回解出来的第一个 `.app`。失败时删掉这个目录。
 */
async function stage(exec: Exec, info: AppUpdateInfo, archive: string, cacheDir: string, signal?: AbortSignal): Promise<StageResult> {
  if (info.format !== 'zip' && info.format !== 'dmg') return { ok: false, detail: `${info.format} is not a macOS artifact` };
  const dir = path.join(cacheDir, `unpack-${info.build}`);
  const fail = async (detail: string): Promise<StageResult> => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, detail };
  };
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    return fail(errorText(error));
  }
  if (info.format === 'zip') {
    try {
      await run(exec, '/usr/bin/ditto', ['-x', '-k', archive, dir], signal);
    } catch (error) {
      return fail(errorText(error));
    }
  } else {
    let output: string;
    try {
      output = await run(exec, '/usr/bin/hdiutil', ['attach', '-nobrowse', '-noverify', '-readonly', archive], signal);
    } catch (error) {
      return fail(errorText(error));
    }
    const mount = mountPath(output);
    if (!mount) return fail('no mount point in hdiutil output');
    const inside = await firstApp(mount);
    let problem = inside ? null : 'no .app in the dmg';
    if (inside) {
      try {
        await run(exec, '/usr/bin/ditto', [inside, path.join(dir, path.basename(inside))], signal);
      } catch (error) {
        problem = errorText(error);
      }
    }
    await exec('/usr/bin/hdiutil', ['detach', mount, '-quiet']).catch(() => undefined);
    if (problem) return fail(problem);
  }
  const app = await firstApp(dir);
  if (!app) return fail(`no .app in the ${info.format}`);
  return { ok: true, staged: { app, dir } };
}

async function plistValue(exec: Exec, app: string, key: string, signal?: AbortSignal): Promise<string> {
  const plist = path.join(app, 'Contents', 'Info.plist');
  return (await run(exec, '/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], signal)).trim();
}

/** 新包的 bundle 标识、版本与 build 和清单一致；不一致时返回原因。 */
async function identityProblem(exec: Exec, app: string, info: AppUpdateInfo, signal?: AbortSignal): Promise<string | null> {
  let identifier: string;
  let version: string;
  let build: string;
  try {
    identifier = await plistValue(exec, app, 'CFBundleIdentifier', signal);
    version = await plistValue(exec, app, 'CFBundleShortVersionString', signal);
    build = await plistValue(exec, app, 'CFBundleVersion', signal);
  } catch (error) {
    return errorText(error);
  }
  if (identifier !== BUNDLE_ID || version !== info.version || Number(build) !== info.build) {
    return `bundle ${identifier} ${version} (${build}) does not match the manifest`;
  }
  return null;
}

/** 新包的身份、版本、build、签名、Team ID 与公证。通过时返回 null。 */
async function validate(exec: Exec, app: string, info: AppUpdateInfo, team: string, signal?: AbortSignal): Promise<Prepared | null> {
  const identity = await identityProblem(exec, app, info, signal);
  if (identity) return { type: 'failed', failure: 'verify', detail: identity };
  try {
    await run(exec, '/usr/bin/codesign', ['--verify', '--deep', '--strict', app], signal);
  } catch (error) {
    return { type: 'failed', failure: 'signature', detail: errorText(error) };
  }
  const newTeam = await macTeamId(exec, app, signal);
  if (newTeam !== team) return { type: 'failed', failure: 'signature', detail: `team ${newTeam ?? 'none'} != running team ${team}` };
  try {
    await run(exec, '/usr/sbin/spctl', ['--assess', '--type', 'execute', app], signal);
  } catch (error) {
    return { type: 'failed', failure: 'signature', detail: errorText(error) };
  }
  return null;
}

/**
 * macOS 的校验与就位（下载完、进「已下载」之前）：这台机器能自己换包时解开安装包、校验新包，通过了返回就位的 `.app`
 * 与它所在的目录；不能自己换包时 `none`（安装时走手动）。失败时删掉解开的目录。`signal` 停了就结束在跑的命令。
 */
export async function prepareMac(info: AppUpdateInfo, archive: string, deps: MacInstallDeps, signal?: AbortSignal): Promise<Prepared> {
  const target = deps.runningBundle;
  if (!target || !(await deps.writable(path.dirname(target)))) return { type: 'none' };
  // 运行中的应用没有 Team ID（ad-hoc 或未签名）就没有可钉的签名者：不自动装。
  const team = await macTeamId(deps.exec, target, signal);
  if (!team) return { type: 'none' };
  if (!deps.cacheDir) return { type: 'failed', failure: 'install', detail: 'no cache directory' };
  const staging = await stage(deps.exec, info, archive, deps.cacheDir, signal);
  if (!staging.ok) return { type: 'failed', failure: 'verify', detail: staging.detail };
  const { staged } = staging;
  const problem = await validate(deps.exec, staged.app, info, team, signal);
  if (problem) {
    await fs.rm(staged.dir, { recursive: true, force: true }).catch(() => undefined);
    return problem;
  }
  return { type: 'staged', staged };
}

/** 就位的新包还在、身份与版本没变（安装时的便宜核对，不再验签）。 */
async function stagedIntact(exec: Exec, staged: StagedApp, info: AppUpdateInfo): Promise<boolean> {
  const stat = await fs.stat(path.join(staged.app, 'Contents', 'Info.plist')).catch(() => null);
  if (!stat?.isFile()) return false;
  return (await identityProblem(exec, staged.app, info)) === null;
}

export interface InstallOptions {
  /** `prepareMac` 就位的新包；没有时（就位的被删了等）「重启并更新」从头解开校验，退出即安装不装。 */
  staged: StagedApp | null;
  /** 换完要不要重新打开应用：「重启并更新」开，退出即安装不开。 */
  relaunch: boolean;
}

/**
 * macOS 换包：就位的新包核对过（或「重启并更新」时从头解开校验过）后写好换包脚本并起它；应用随后正常退出，脚本等进程
 * 退出再换。退出即安装只用就位的新包：没有或核对不过时返回失败，应用照常退出，不在退出途中现解现验。
 */
export async function installMac(
  info: AppUpdateInfo,
  archive: string,
  deps: MacInstallDeps,
  options: InstallOptions,
): Promise<InstallOutcome> {
  const target = deps.runningBundle;
  if (!target) return FALLBACK;
  if (!(await deps.writable(path.dirname(target)))) return FALLBACK;
  if (!deps.cacheDir) return failed('install', 'no cache directory');
  let staged = options.staged && (await stagedIntact(deps.exec, options.staged, info)) ? options.staged : null;
  if (!staged) {
    if (!options.relaunch) return failed('install', 'the update is not staged');
    const prepared = await prepareMac(info, archive, deps);
    if (prepared.type === 'none') return FALLBACK;
    if (prepared.type === 'failed') return prepared;
    staged = prepared.staged;
  }
  const script = path.join(deps.cacheDir, `install-${deps.pid}.sh`);
  const built = installerScript({
    pid: deps.pid,
    newApp: staged.app,
    target,
    mount: null,
    archive,
    unpacked: staged.dir,
    script,
    relaunch: options.relaunch,
  });
  if (!built.ok) return failed('install', built.error);
  try {
    const part = path.join(deps.cacheDir, `.install-${deps.pid}.part`);
    await fs.writeFile(part, built.script, { mode: 0o700 });
    await fs.rename(part, script);
    await deps.launchScript(script, path.join(deps.cacheDir, 'install.log'));
  } catch (error) {
    return failed('install', errorText(error));
  }
  return { type: 'launched' };
}

/**
 * electron-builder 的 NSIS 安装器的参数：`/S` 静默；`--updated` 让它按更新处理（保留快捷方式，等应用自己退出一会儿再
 * 结束安装目录里还在跑的进程）；`--force-run` 装完以 `--updated` 重新打开应用（「重启并更新」）。
 */
export const NSIS_UPDATE_ARGS: readonly string[] = ['/S', '--updated', '--force-run'];

/** 退出即安装：同上，但装完不打开应用（用户是要退出）。 */
export const NSIS_QUIT_ARGS: readonly string[] = ['/S', '--updated'];

/**
 * NSIS 装的那一份：exe 旁边有安装器放的 `Uninstall BaoCut.exe`。zip 解开的没有，不自动装。
 * 只看文件，不读注册表（`HKCU\Software\<GUID>` 的 InstallLocation）：读注册表要解析 reg.exe 的输出，这里测不到。
 */
export async function nsisInstalledCopy(executable: string, isFile: (file: string) => Promise<boolean>): Promise<boolean> {
  return isFile(path.win32.join(path.win32.dirname(executable), NSIS_UNINSTALLER));
}

export interface WindowsInstallDeps {
  /** NSIS 装的那一份（`nsisInstalledCopy`）；zip 版不是，不自动装。 */
  installedCopy: boolean;
  /** 记下应用退出时要起的安装器（`createPendingLaunch`）。 */
  launchOnQuit(file: string, args: readonly string[]): void;
}

/**
 * Windows：安装器不在这里起，而是记下来，等应用走完正常退出（`before-quit` 里经 IPC 停 Runtime）、到 `will-quit` 时再起。
 * 带 `--updated` 的安装器只等应用约 1.3 秒，就结束安装目录里所有还在跑的进程（Runtime 也是 `BaoCut.exe`，Worker 在
 * `resources\bin`），先起它会把 Runtime 的收尾截断。「重启并更新」返回 `launched` 后服务让应用退出，装完重新打开；
 * 退出即安装（`relaunch` 为假）时应用本来就在退出，装完不打开。
 */
export async function installWindows(archive: string, deps: WindowsInstallDeps, relaunch = true): Promise<InstallOutcome> {
  if (!deps.installedCopy) return FALLBACK;
  deps.launchOnQuit(archive, relaunch ? NSIS_UPDATE_ARGS : NSIS_QUIT_ARGS);
  return { type: 'launched' };
}

export interface PendingLaunch {
  /** 记下（覆盖之前记下的）。 */
  arm(file: string, args: readonly string[]): void;
  /** 起记下的那一个，只起一次；没有记下的什么都不做。返回起了没有。 */
  fire(): boolean;
}

/** 应用退出时才起的安装器：`installWindows` 记下，`will-quit` 里 `fire`。`spawn` 失败只记日志，应用照常退出。 */
export function createPendingLaunch(spawn: (file: string, args: readonly string[]) => void, log: (message: string) => void): PendingLaunch {
  let pending: { file: string; args: readonly string[] } | null = null;
  return {
    arm(file, args) {
      pending = { file, args: [...args] };
    },
    fire() {
      if (!pending) return false;
      const { file, args } = pending;
      pending = null;
      try {
        spawn(file, args);
        return true;
      } catch (error) {
        // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
        log(`起安装器失败：${errorText(error)}`);
        return false;
      }
    },
  };
}
