import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MCP_INTERFACE_VERSION, PROTOCOL_VERSION, type ComponentBuild, type RuntimeInfo } from '@baocut/protocol';
import { cliInstallCommand } from './admin/cli-entry.ts';
import { M } from './cli-copy.ts';
import { D } from './doctor-copy.ts';
import { CliError, type ExitCode, type Output } from './envelope.ts';
import { buildNext, buildWarnings } from './meta.ts';
import {
  findRuntime,
  launchCredentialStore,
  launchEntry,
  nodeSatisfies,
  openClient,
  packagedApps,
  packagedResourceEnv,
  startLogFile,
  type LaunchSpec,
} from './runtime/connection.ts';

/**
 * `baocut doctor`（CLI 独立使用与发布 §8.1）：为什么起不来、为什么读不到。逐项给出 ok / warn / fail（查不了时 skip）与补救命令。
 * 只读：不拉起 Runtime，不读密钥（钥匙串只对一个编出来的键问一次 `has`）。`status` 回答这台机器能做什么，`doctor` 回答为什么不行。
 *
 * 分两层：`gatherDoctor` 收集事实（PATH、App、拉起方式、正在跑的 Runtime、凭据助手，从仓库拉起时还有 Runtime 的自检），
 * `doctorReport` 是纯函数，把事实写成检查项。
 */

export type DoctorLevel = 'ok' | 'warn' | 'fail' | 'skip';
export type DoctorCheckId = 'entry' | 'runtime' | 'credentials' | 'fullDiskAccess' | 'build';

export interface DoctorCheck {
  id: DoctorCheckId;
  level: DoctorLevel;
  message: string;
  /** 用户（或征得同意的 Agent）可以跑的补救命令。 */
  remedy?: string;
  details: Record<string, unknown>;
}

export interface DoctorResult {
  /** 没有 fail。 */
  ok: boolean;
  checks: DoctorCheck[];
}

/** 凭据助手对 `has` 的回答；`missing` 是助手程序不在，`timeout` 是限时内没回答。 */
export type HelperProbe =
  | { ok: true }
  | { ok: false; error: 'not-found' | 'denied' | 'unavailable' | 'unsupported' | 'internal' | 'missing' | 'timeout'; message: string };

export type DoctorRuntime =
  | { state: 'stopped' }
  | { state: 'unreachable'; pid: number; code: string; message: string }
  | {
      state: 'running';
      info: RuntimeInfo;
      interfaceVersion: string;
      access: { platform: string; fullDiskAccess?: 'granted' | 'missing' } | null;
    };

/** Runtime 的 `--self-check --probe`（各原生程序启动一次，比对构建与源码）的结论；没跑完时说为什么。 */
export type DoctorBuild =
  | { state: 'done'; problems: string[]; builds: ComponentBuild[] }
  | { state: 'failed'; message: string };

export interface DoctorInputs {
  platform: NodeJS.Platform;
  home: string;
  /** 终端里找到的第一个 `baocut`，以及它最终指向的文件（软链接解析后、Windows 转发脚本的目标）。 */
  terminal: { found: string; target: string } | null;
  /** 装好的 BaoCut App 的命令行入口与版本（读得到时）。 */
  app: { entry: string; version: string | null } | null;
  /** 终端那个 `baocut` 落在哪个 App 里、那个 App 的版本（macOS 读 Info.plist）。 */
  terminalApp: { root: string; version: string | null } | null;
  launch: LaunchSpec | null;
  node: string;
  runtime: DoctorRuntime;
  credentials: { store: 'keychain' | 'file' | null; helper: string | null; probe: HelperProbe | null };
  /** 运行这条命令的终端（`TERM_PROGRAM`），给完全磁盘访问的说明用。 */
  terminalProgram: string | null;
  /** 开发态的构建检查（§7.4）：不从打包的 App 拉起时才跑，否则 null。 */
  build: DoctorBuild | null;
}

/** 把收集到的事实写成检查项（纯函数）。 */
export function doctorReport(inputs: DoctorInputs): DoctorResult {
  const checks = [entryCheck(inputs), runtimeCheck(inputs), credentialsCheck(inputs)];
  if (inputs.platform === 'darwin') checks.push(fullDiskAccessCheck(inputs));
  checks.push(buildCheck(inputs));
  return { ok: checks.every((check) => check.level !== 'fail'), checks };
}

/** 第一个问题（先 fail 后 warn）的补救，作为信封的 `next`。 */
export function doctorNext(result: DoctorResult): string | null {
  for (const level of ['fail', 'warn'] as const) {
    const check = result.checks.find((c) => c.level === level && c.remedy);
    if (check) return check.remedy!;
  }
  return null;
}

function entryCheck({ terminal, app, terminalApp, platform }: DoctorInputs): DoctorCheck {
  const details = { found: terminal?.found ?? null, target: terminal?.target ?? null, app: app?.entry ?? null, appVersion: app?.version ?? null };
  if (!terminal) {
    return app
      ? { id: 'entry', level: 'warn', message: D.entryMissing, remedy: cliInstallCommand(app.entry, platform), details }
      : { id: 'entry', level: 'skip', message: D.entryMissingNoApp, details };
  }
  const shown = terminal.target === terminal.found ? terminal.found : `${terminal.found} → ${terminal.target}`;
  if (app && samePath(terminal.target, app.entry, platform)) {
    return { id: 'entry', level: 'ok', message: D.entryApp(shown, app.version), details };
  }
  if (app) {
    return {
      id: 'entry',
      level: 'warn',
      message: D.entryOtherApp(terminal.found, terminalApp?.version ? `${terminal.target}, ${terminalApp.version}` : terminal.target, app.entry),
      // `cli status` 点名终端先找到的是哪个、该怎么改（PATH 顺序、移除旧的）；入口还不在 PATH 上，写完整路径。
      remedy: cliInstallCommand(app.entry, platform, 'status'),
      details: { ...details, terminalAppVersion: terminalApp?.version ?? null },
    };
  }
  return { id: 'entry', level: 'ok', message: D.entryNoApp(terminal.found, terminal.target), details };
}

function runtimeCheck({ runtime, launch, node, home }: DoctorInputs): DoctorCheck {
  const launchDetails = launch
    ? { source: launch.source, entry: launchEntry(launch), credentialStore: launchCredentialStore(launch), ...(launch.nodeRange ? { nodeRange: launch.nodeRange } : {}) }
    : null;
  const details: Record<string, unknown> = { home, launch: launchDetails, log: startLogFile(home) };
  if (runtime.state === 'running') {
    const { info } = runtime;
    Object.assign(details, {
      version: info.runtimeVersion,
      interfaceVersion: runtime.interfaceVersion,
      pid: info.pid,
      launchedBy: info.launchedBy ?? 'app',
      startedAt: info.startedAt,
      projectsDir: info.projectsDir,
      logsDir: info.logsDir,
    });
    if (runtime.interfaceVersion !== MCP_INTERFACE_VERSION) {
      const update = Number(runtime.interfaceVersion) > Number(MCP_INTERFACE_VERSION) ? 'cli' : 'runtime';
      return { id: 'runtime', level: 'fail', message: M.interfaceMismatch(MCP_INTERFACE_VERSION, runtime.interfaceVersion, update), details };
    }
    return { id: 'runtime', level: 'ok', message: D.runtimeRunning(info.runtimeVersion, info.pid, info.launchedBy === 'cli' ? 'cli' : 'app'), details };
  }
  if (runtime.state === 'unreachable') {
    Object.assign(details, { pid: runtime.pid, code: runtime.code });
    const message = runtime.code === 'PROTOCOL_MISMATCH' ? runtime.message : D.runtimeUnreachable(runtime.pid, runtime.message);
    return { id: 'runtime', level: 'fail', message, remedy: 'baocut runtime status', details };
  }
  if (!launch) return { id: 'runtime', level: 'fail', message: D.runtimeNoLaunch, details };
  if (launch.nodeRange && !nodeSatisfies(node, launch.nodeRange)) {
    return { id: 'runtime', level: 'fail', message: M.runtimeNodeUnsupported(node, launch.nodeRange), details: { ...details, node } };
  }
  return { id: 'runtime', level: 'ok', message: D.runtimeStopped(launchEntry(launch)), details };
}

function credentialsCheck({ credentials, home, platform }: DoctorInputs): DoctorCheck {
  const { store, helper, probe } = credentials;
  const details: Record<string, unknown> = { store, helper };
  if (store === null) return { id: 'credentials', level: 'skip', message: D.credentialsUnknown, details };
  if (store === 'file') {
    const file = path.join(home, 'store', 'model-credentials.json');
    return { id: 'credentials', level: 'ok', message: D.credentialsFile(file), details: { ...details, file } };
  }
  if (!probe || (!probe.ok && probe.error === 'missing')) {
    return { id: 'credentials', level: 'fail', message: D.credentialsNoHelper(helper), details };
  }
  if (probe.ok) return { id: 'credentials', level: 'ok', message: D.credentialsKeychain(platform), details };
  details.error = probe.error;
  if (probe.error === 'denied') {
    return {
      id: 'credentials',
      level: 'warn',
      message: D.credentialsDenied,
      ...(platform === 'darwin' ? { remedy: 'security unlock-keychain' } : {}),
      details,
    };
  }
  return { id: 'credentials', level: 'fail', message: D.credentialsUnavailable(probe.message), details };
}

function fullDiskAccessCheck({ runtime, terminalProgram }: DoctorInputs): DoctorCheck {
  if (runtime.state !== 'running' || !runtime.access?.fullDiskAccess) {
    return { id: 'fullDiskAccess', level: 'skip', message: D.fdaNotRunning, details: {} };
  }
  const state = runtime.access.fullDiskAccess;
  const launchedBy = runtime.info.launchedBy === 'cli' ? 'cli' : 'app';
  const details = { state, launchedBy };
  if (state === 'granted') return { id: 'fullDiskAccess', level: 'ok', message: D.fdaGranted, details };
  // 架构设计 §12.11：权限算在拉起它的那个应用头上；从终端拉起时多半是终端。
  const message = launchedBy === 'cli' ? D.fdaMissingCli(terminalAppName(terminalProgram)) : D.fdaMissingApp;
  return { id: 'fullDiskAccess', level: 'warn', message, details: { ...details, terminal: terminalProgram } };
}

/** 少了就做不了事的组件：缺了或起不来算 fail；其余（本地语音、Electron 宿主、凭据助手等）算 warn。 */
const CORE_COMPONENTS = new Set(['engine-host', 'export-worker', 'model-worker', 'speech-worker', 'web', 'editor.wasm', 'templates', 'skills', 'agentSkills']);

/** 自检的一条问题（`<组件>: <说明>`）由哪条命令补上。 */
export function selfCheckRemedy(problem: string): string {
  const component = problem.slice(0, problem.indexOf(':'));
  if (['engine-host', 'export-worker', 'model-worker', 'speech-worker'].includes(component)) return 'npm run build:engine';
  if (component === 'web') return 'npm run build:web';
  if (component === 'editor.wasm') return 'npm run build:wasm';
  if (component.startsWith('audiocpp')) return 'npm run build:audiocpp';
  if (component === 'litertlm-runtime') return 'npm run build:litertlm-runtime';
  if (component === 'credential-helper') return 'cargo build -p credential-helper';
  if (component === 'electron' || component === 'composition-host') return 'npm install';
  return 'npm run setup';
}

function buildCheck({ build, launch }: DoctorInputs): DoctorCheck {
  if (!build || !launch) return { id: 'build', level: 'skip', message: D.buildNotSource, details: {} };
  const details: Record<string, unknown> = { entry: launchEntry(launch) };
  if (build.state === 'failed') return { id: 'build', level: 'fail', message: D.buildFailed(build.message), details };
  const { problems, builds } = build;
  Object.assign(details, { problems, builds });
  if (problems.length > 0) {
    const first = problems.find((problem) => CORE_COMPONENTS.has(problem.slice(0, problem.indexOf(':')))) ?? null;
    const shown = first ?? problems[0]!;
    return {
      id: 'build',
      level: first ? 'fail' : 'warn',
      message: D.buildProblems(problems.length, shown),
      remedy: selfCheckRemedy(shown),
      details,
    };
  }
  const warnings = buildWarnings(builds, PROTOCOL_VERSION);
  if (warnings.length > 0) {
    const message = warnings.length === 1 ? warnings[0]! : D.buildMore(warnings[0]!, warnings.length - 1);
    return { id: 'build', level: 'warn', message, ...(buildNext(builds) ? { remedy: buildNext(builds)! } : {}), details };
  }
  return { id: 'build', level: 'ok', message: D.buildOk(builds.length), details };
}

/** `TERM_PROGRAM` → 系统设置里看到的应用名；认不出时 null（文案说「运行命令的那个应用」）。 */
export function terminalAppName(program: string | null): string | null {
  if (!program) return null;
  const known: Record<string, string> = {
    Apple_Terminal: 'Terminal',
    'iTerm.app': 'iTerm',
    vscode: 'Visual Studio Code',
    WarpTerminal: 'Warp',
    ghostty: 'Ghostty',
    WezTerm: 'WezTerm',
    Hyper: 'Hyper',
    Tabby: 'Tabby',
    kitty: 'kitty',
    alacritty: 'Alacritty',
  };
  return known[program] ?? null;
}

/* ---------- 收集事实 ---------- */

export interface DoctorDeps {
  platform?: NodeJS.Platform;
  /** 凭据助手的期限。 */
  helperTimeoutMs?: number;
  /** 跑 Runtime 自检（测试替换）。 */
  selfCheck?: (launch: LaunchSpec, env: NodeJS.ProcessEnv, home: string) => Promise<DoctorBuild>;
}

const HELPER_TIMEOUT_MS = 5_000;
/** 自检要把每个原生程序启动一次，Intel Mac 上 model-worker 首次编译 Metal 要一分钟。 */
const SELF_CHECK_TIMEOUT_MS = 120_000;

export async function gatherDoctor(
  env: NodeJS.ProcessEnv,
  home: string,
  launch: LaunchSpec | null,
  deps: DoctorDeps = {},
): Promise<DoctorInputs> {
  const platform = deps.platform ?? process.platform;
  const terminal = findOnPath('baocut', env, platform);
  const app = appEntry(env, platform);
  const store = launch ? launchCredentialStore(launch) : null;
  const helper = store === 'keychain' ? credentialHelper(env, launch!, platform) : null;
  const [runtime, probe, build] = await Promise.all([
    runningRuntime(home),
    store === 'keychain' ? (helper ? probeCredentialHelper({ command: helper }, deps.helperTimeoutMs) : null) : null,
    // 打包的产物与代码同一次构建，不比；只在从仓库或 BAOCUT_RUNTIME_ENTRY 拉起时跑（列出来，以后加的安装方式默认不跑）。
    launch && (launch.source === 'repo' || launch.source === 'env') ? (deps.selfCheck ?? runSelfCheck)(launch, env, home) : null,
  ]);
  return {
    platform,
    home,
    terminal,
    app,
    terminalApp: terminal && platform === 'darwin' ? appBundleOf(terminal.target) : null,
    launch,
    node: process.versions.node,
    runtime,
    credentials: { store, helper, probe },
    terminalProgram: env.TERM_PROGRAM || null,
    build,
  };
}

/**
 * 用拉起 Runtime 的同一条命令跑 `--self-check --probe`：不启动 Runtime，只把各原生程序启动一次、比对构建与源码（`runtimeSelfCheck`），
 * 写一行 JSON。有问题时它以 1 退出，照样读那一行。限时，超时就杀掉。
 */
export function runSelfCheck(launch: LaunchSpec, env: NodeJS.ProcessEnv, home: string, timeoutMs = SELF_CHECK_TIMEOUT_MS): Promise<DoctorBuild> {
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    let err = '';
    const child = spawn(launch.command, [...launch.args, '--self-check', '--probe'], {
      env: { ...env, ...launch.env, BAOCUT_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result: DoctorBuild) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ state: 'failed', message: D.buildTimedOut(Math.round(timeoutMs / 1000)) }), timeoutMs);
    child.once('error', (error) => finish({ state: 'failed', message: error.message }));
    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 1024 * 1024) out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString('utf8')).slice(-4096);
    });
    child.once('close', (code) => {
      const line = out.trim().split('\n').reverse().find((text) => text.startsWith('{'));
      let report: { problems?: unknown; builds?: unknown } | null = null;
      try {
        report = line ? JSON.parse(line) : null;
      } catch {
        report = null;
      }
      if (report && Array.isArray(report.problems)) {
        return finish({
          state: 'done',
          problems: report.problems.filter((problem): problem is string => typeof problem === 'string'),
          builds: Array.isArray(report.builds) ? (report.builds as ComponentBuild[]) : [],
        });
      }
      const tail = err.trim().split('\n').slice(-1)[0]?.slice(0, 300);
      finish({ state: 'failed', message: tail || M.exitedWith(code) });
    });
  });
}

/** 正在跑的 Runtime：版本、接口版本与完全磁盘访问；连不上时说为什么。不拉起。 */
async function runningRuntime(home: string): Promise<DoctorRuntime> {
  const discovery = await findRuntime(home);
  if (!discovery) return { state: 'stopped' };
  try {
    const { client, info } = await openClient(discovery);
    try {
      const catalog = await client.request('catalog.list', {});
      const access = await client.request('runtime.access', {}).catch(() => null);
      return { state: 'running', info, interfaceVersion: catalog.interfaceVersion, access };
    } finally {
      client.close();
    }
  } catch (error) {
    const body = error instanceof CliError ? error.body() : { code: 'RUNTIME_UNAVAILABLE', message: String(error) };
    return { state: 'unreachable', pid: discovery.pid, code: body.code, message: body.message };
  }
}

/**
 * 终端会找到的第一个 `baocut`：按 PATH 的顺序（Windows 按 PATHEXT 补后缀）。`target` 是软链接解析之后的文件；Windows 上
 * BaoCut 写的转发脚本（`baocut.cmd`）取它转发到的入口。
 */
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): { found: string; target: string } | null {
  const windows = platform === 'win32';
  const list = (windows ? (env.Path ?? env.PATH) : env.PATH) ?? '';
  const exts = windows ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of list.split(windows ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (!isExecutableFile(candidate, windows)) continue;
      const real = realpath(candidate);
      const forwarded = windows && /\.cmd$/i.test(candidate) ? forwarderTarget(readText(candidate)) : null;
      return { found: candidate, target: forwarded ?? real };
    }
  }
  return null;
}

/** BaoCut 在 Windows 上写的转发脚本（`rem BaoCut command line forwarder` + `"<目标>" %*`）转发到哪；不是这种脚本时 null。 */
export function forwarderTarget(text: string | null): string | null {
  if (!text || !/^rem BaoCut command line forwarder\b/im.test(text)) return null;
  return /^"([^"]+)" %\*\s*$/m.exec(text)?.[1] ?? null;
}

/**
 * 装好的 App 的命令行入口：`BAOCUT_CLI_ENTRY` 给了就只看它（与 Runtime 读的是同一个），否则按 `packagedApps` 的位置找第一个
 * 装着的 App。
 */
function appEntry(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { entry: string; version: string | null } | null {
  const candidates = env.BAOCUT_CLI_ENTRY
    ? [env.BAOCUT_CLI_ENTRY]
    : packagedApps(env, platform)
        .filter((app) => fs.existsSync(app.executable))
        .map((app) => packagedResourceEnv(app.resources, platform).BAOCUT_CLI_ENTRY)
        .filter((entry): entry is string => Boolean(entry));
  const entry = candidates.find((candidate) => fs.existsSync(candidate));
  if (!entry) return null;
  return { entry, version: platform === 'darwin' ? (appBundleOf(entry)?.version ?? null) : null };
}

/** 文件所在的 `.app` 与它的版本（`Contents/Info.plist` 的 `CFBundleShortVersionString`）；不在 `.app` 里时 null。 */
export function appBundleOf(file: string): { root: string; version: string | null } | null {
  const match = /^(.*?\.app)\/Contents\//.exec(file);
  if (!match) return null;
  const plist = readText(path.join(match[1]!, 'Contents', 'Info.plist'));
  const version = plist && /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
  return { root: match[1]!, version: version ?? null };
}

/** 拉起的 Runtime 会用的凭据助手：`BAOCUT_CREDENTIAL_HELPER`，否则拉起环境里的 `BAOCUT_BIN_DIR`（`@baocut/runtime-core` 的找法）。 */
function credentialHelper(env: NodeJS.ProcessEnv, launch: LaunchSpec, platform: NodeJS.Platform): string | null {
  if (env.BAOCUT_CREDENTIAL_HELPER) return env.BAOCUT_CREDENTIAL_HELPER;
  const bin = launch.env.BAOCUT_BIN_DIR ?? env.BAOCUT_BIN_DIR;
  return bin ? path.join(bin, platform === 'win32' ? 'credential-helper.exe' : 'credential-helper') : null;
}

/**
 * 对一个编出来的键问一次 `has`（助手协议见 `@baocut/runtime-storage` 的 `KeychainCredentialStore`）：只查条目在不在、不读密钥，
 * 这个键不存在，系统也就不会弹出授权提示。限时，超时就杀掉助手。
 */
export function probeCredentialHelper(
  helper: { command: string; args?: string[] },
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<HelperProbe> {
  if (!helper.args?.length && !fs.existsSync(helper.command)) return Promise.resolve({ ok: false, error: 'missing', message: helper.command });
  const key = `doctor-probe-${randomBytes(6).toString('hex')}`;
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    const child = spawn(helper.command, helper.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const finish = (result: HelperProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout', message: D.credentialsTimedOut(Math.round(timeoutMs / 1000)) }),
      timeoutMs,
    );
    child.once('error', (error: NodeJS.ErrnoException) =>
      finish({ ok: false, error: error.code === 'ENOENT' ? 'missing' : 'unavailable', message: error.message }),
    );
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 64 * 1024) out += chunk.toString('utf8');
    });
    child.once('close', (code) => {
      const line = out.split('\n', 1)[0]!.trim();
      let parsed: { ok?: unknown; exists?: unknown; error?: unknown; message?: unknown } | null = null;
      try {
        parsed = line ? JSON.parse(line) : null;
      } catch {
        parsed = null;
      }
      if (parsed?.ok === true && typeof parsed.exists === 'boolean') return finish({ ok: true });
      if (parsed?.ok === false) {
        const known = ['not-found', 'denied', 'unavailable', 'unsupported', 'internal'] as const;
        const error = known.find((value) => value === parsed!.error) ?? 'internal';
        return finish({ ok: false, error, message: typeof parsed.message === 'string' ? parsed.message.slice(0, 300) : error });
      }
      finish({ ok: false, error: 'unavailable', message: M.exitedWith(code) });
    });
    child.stdin.end(`${JSON.stringify({ op: 'has', key })}\n`);
  });
}

/* ---------- 命令 ---------- */

const SYMBOL: Record<DoctorLevel, string> = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

/** `baocut doctor`：信封同 `status`（`result.checks`），`next` 是第一个问题的补救；诊断本身做完了就是退出码 0。 */
export async function doctor(output: Output, env: NodeJS.ProcessEnv, home: string, launch: LaunchSpec | null, deps: DoctorDeps = {}): Promise<ExitCode> {
  const result = doctorReport(await gatherDoctor(env, home, launch, deps));
  const next = doctorNext(result);
  const lines: string[] = [];
  for (const check of result.checks) {
    lines.push(`${SYMBOL[check.level]} ${D.checkName[check.id]}: ${check.message}`);
    if (check.remedy) lines.push(`    ${D.remedyLabel}: ${check.remedy}`);
  }
  return output.report(result, lines, next);
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string) => realpath(p).replace(/[\\/]+$/, '');
  return platform === 'win32' || platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function realpath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function isExecutableFile(file: string, windows: boolean): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (!windows) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
