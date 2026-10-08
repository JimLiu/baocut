import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaoCutClient } from '@baocut/client';
import {
  MCP_INTERFACE_VERSION,
  RUNTIME_VERSION,
  isLanguagePreference,
  processLanguageTags,
  resolveLanguage,
  setLocale,
  type CatalogListResult,
  type RuntimeDiscovery,
  type RuntimeInfo,
} from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { CliError } from '../envelope.ts';

/**
 * CLI 与 Runtime 的连接（Agent 面设计 §5.6；架构设计 §2.2）：按 `BAOCUT_HOME` 的发现文件找正在跑的 Runtime，找不到时
 * 默认在后台拉起一个（脱离终端，输出写到 `<BAOCUT_HOME>/logs/cli-runtime.log`），等它写出发现文件再连。拉起时带
 * `--launched-by cli --idle-exit`：`runtime stop` 只停这样的，空闲满 `runtime.idleExitMinutes` 它自己退出。
 *
 * 连上之后的版本门：`catalog.list` 的接口版本与 CLI 的 `MCP_INTERFACE_VERSION` 不同时以退出码 3 拒绝，不按旧参数解释。
 */

/** 一次请求的上限：工具调用（取帧、读大文档）可能久；等任务走 `jobs` 主题，不占请求。 */
const REQUEST_TIMEOUT_MS = 30 * 60_000;
/** 拉起之后等发现文件的上限。 */
const START_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

export function runtimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BAOCUT_HOME || path.join(os.homedir(), '.baocut'));
}

export function discoveryFile(home: string): string {
  return path.join(home, 'runtime.json');
}

/** 实例锁（`@baocut/runtime-storage`）：活着的 Runtime 持有它，停完才放开。 */
export function lockFile(home: string): string {
  return path.join(home, 'runtime.lock');
}

/** 实例锁的持有者还活着（锁文件不在或读不了时 false）。 */
export function lockHolderAlive(home: string): boolean {
  try {
    const { pid } = JSON.parse(fs.readFileSync(lockFile(home), 'utf8')) as { pid?: unknown };
    return typeof pid === 'number' && isProcessAlive(pid);
  } catch {
    return false;
  }
}

export function startLogFile(home: string): string {
  return path.join(home, 'logs', 'cli-runtime.log');
}

export function readDiscovery(home: string): RuntimeDiscovery | null {
  try {
    return JSON.parse(fs.readFileSync(discoveryFile(home), 'utf8')) as RuntimeDiscovery;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 正在跑的 Runtime 的发现信息；没有发现文件或进程已经不在时 null。 */
export function findRuntime(home: string): RuntimeDiscovery | null {
  const discovery = readDiscovery(home);
  return discovery && isProcessAlive(discovery.pid) ? discovery : null;
}

/** 怎么启动 Runtime。 */
export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'env' | 'packaged' | 'repo';
}

/**
 * Runtime 的入口，依次找：`BAOCUT_RUNTIME_ENTRY`（`.ts` / `.js` 用当前的 Node 跑，否则当可执行文件）→ 装好的 BaoCut 应用
 * （以 Node 方式运行它带的 Runtime，资源位置照桌面端的 `packagedResourceEnv`）→ 仓库里的 `apps/runtime/src/main.ts`。
 */
export function resolveRuntimeLaunch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  from: string = path.dirname(fileURLToPath(import.meta.url)),
): LaunchSpec | null {
  const explicit = env.BAOCUT_RUNTIME_ENTRY;
  if (explicit) {
    const entry = path.resolve(explicit);
    return /\.(ts|mts|js|mjs|cjs)$/.test(entry)
      ? { command: process.execPath, args: [entry], env: {}, source: 'env' }
      : { command: entry, args: [], env: {}, source: 'env' };
  }
  for (const app of packagedApps(env, platform)) {
    if (fs.existsSync(app.executable) && fs.existsSync(path.join(app.resources, 'app.asar'))) {
      return {
        command: app.executable,
        args: [path.join(app.resources, 'app.asar', 'out', 'main', 'runtime.js'), '--credential-store', 'keychain'],
        env: { ELECTRON_RUN_AS_NODE: '1', ...packagedResourceEnv(app.resources) },
        source: 'packaged',
      };
    }
  }
  const root = repoRoot(from);
  const entry = root && path.join(root, 'apps', 'runtime', 'src', 'main.ts');
  if (entry && fs.existsSync(entry)) return { command: process.execPath, args: [entry], env: {}, source: 'repo' };
  return null;
}

/** 装好的 BaoCut 应用可能在的位置（Windows 的 NSIS 按用户安装、macOS 的 Applications）。 */
export function packagedApps(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { executable: string; resources: string }[] {
  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'BaoCut'),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'BaoCut'),
    ];
    return roots
      .filter((root): root is string => Boolean(root))
      .map((root) => ({ executable: path.win32.join(root, 'BaoCut.exe'), resources: path.win32.join(root, 'resources') }));
  }
  if (platform === 'darwin') {
    return ['/Applications', path.posix.join(os.homedir().replaceAll('\\', '/'), 'Applications')].map((dir) => ({
      executable: path.posix.join(dir, 'BaoCut.app', 'Contents', 'MacOS', 'BaoCut'),
      resources: path.posix.join(dir, 'BaoCut.app', 'Contents', 'Resources'),
    }));
  }
  return [];
}

/**
 * 打包后的 Runtime 按路径读的东西：与桌面端 `apps/desktop/src/main/packaged-resources.ts` 的 `packagedResourceEnv` 相同
 * （CLI 不依赖桌面端的包；`connection.test.ts` 核对两边一致）。
 */
export function packagedResourceEnv(resources: string): Record<string, string> {
  return {
    BAOCUT_BIN_DIR: path.join(resources, 'bin'),
    BAOCUT_TEMPLATES_DIR: path.join(resources, 'templates'),
    BAOCUT_SKILLS_DIR: path.join(resources, 'skills'),
    BAOCUT_AGENT_SKILLS_DIR: path.join(resources, 'agent-skills'),
    BAOCUT_MODEL_ASSETS_DIR: path.join(resources, 'model-assets'),
    BAOCUT_WEB_DIST: path.join(resources, 'web'),
  };
}

/**
 * 说明书的根目录（里面是 `baocut/`），给不连 Runtime 的 `baocut skill path` 用：与 Runtime 的 `resolveBuiltinAgentSkillsDir`
 * 同一个顺序——`BAOCUT_AGENT_SKILLS_DIR` → 装好的 BaoCut 应用的 `<resources>/agent-skills` → 仓库根的 `agent-skills/`。
 * 都没有时 null。
 */
export function resolveAgentSkillsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  from: string = path.dirname(fileURLToPath(import.meta.url)),
): string | null {
  if (env.BAOCUT_AGENT_SKILLS_DIR) return env.BAOCUT_AGENT_SKILLS_DIR;
  for (const app of packagedApps(env, platform)) {
    const dir = packagedResourceEnv(app.resources).BAOCUT_AGENT_SKILLS_DIR!;
    if (fs.existsSync(dir)) return dir;
  }
  const root = repoRoot(from);
  const dir = root && path.join(root, 'agent-skills');
  return dir && fs.existsSync(dir) ? dir : null;
}

/** 往上找仓库根（`package.json` 的 name 是 `baocut`）。 */
function repoRoot(from: string): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown };
      if (pkg.name === 'baocut') return dir;
    } catch {
      // 继续往上。
    }
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * 在后台拉起 Runtime 并等它写出发现文件。另一个进程抢先拉起时（子进程以退出码 3 退出：实例锁被占）用那一个，`started` 为 false。
 *
 * 锁被占着却一直没有发现文件，是那个实例正在空闲退出（它先删发现文件再停，架构设计 §2.2）：等它放开锁再拉起一次，只重来一次。
 */
export async function launchRuntime(
  home: string,
  spec: LaunchSpec,
  timeoutMs = START_TIMEOUT_MS,
): Promise<{ discovery: RuntimeDiscovery; started: boolean }> {
  const log = startLogFile(home);
  const deadline = Date.now() + timeoutMs;
  let respawned = false;
  for (;;) {
    const child = spawnRuntime(home, spec, log);
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (child.error) throw new CliError('RUNTIME_START_FAILED', M.runtimeStartFailed(child.error.message, log), { log });
      const discovery = findRuntime(home);
      if (discovery && (discovery.pid === child.pid || child.exitCode === 3)) return { discovery, started: discovery.pid === child.pid };
      if (child.exitCode !== undefined && child.exitCode !== 3) {
        throw new CliError('RUNTIME_START_FAILED', M.runtimeStartFailed(M.exitedWith(child.exitCode), log), { log, tail: tail(log) });
      }
      if (Date.now() >= deadline) {
        throw new CliError('RUNTIME_START_FAILED', M.runtimeStartTimeout(Math.round(timeoutMs / 1000), log), { log, tail: tail(log) });
      }
      if (child.exitCode === 3 && !respawned && !lockHolderAlive(home)) {
        respawned = true;
        break;
      }
    }
  }
}

interface SpawnedRuntime {
  pid: number | undefined;
  /** 退出时的退出码；还在跑时 undefined。 */
  exitCode: number | null | undefined;
  error: Error | null;
}

function spawnRuntime(home: string, spec: LaunchSpec, log: string): SpawnedRuntime {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  let child;
  try {
    child = spawn(spec.command, [...spec.args, '--quiet', '--launched-by', 'cli', '--idle-exit'], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...spec.env, BAOCUT_HOME: home },
      windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  const state: SpawnedRuntime = { pid: child.pid, exitCode: undefined, error: null };
  child.once('error', (error) => (state.error = error));
  child.once('exit', (code) => (state.exitCode = code));
  child.unref();
  return state;
}

function tail(file: string, lines = 20): string[] {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines);
  } catch {
    return [];
  }
}

export interface EnsureOptions {
  /** 找不到时拉起（`--no-start` 关掉）。 */
  start: boolean;
  env?: NodeJS.ProcessEnv;
}

/** 找到或拉起 Runtime。 */
export async function ensureRuntime(home: string, options: EnsureOptions): Promise<{ discovery: RuntimeDiscovery; started: boolean }> {
  const running = findRuntime(home);
  if (running) return { discovery: running, started: false };
  if (!options.start) throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeNotRunning(home), { home, next: 'baocut runtime ensure' });
  const spec = resolveRuntimeLaunch(options.env);
  if (!spec) throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeNoEntry, { home });
  return launchRuntime(home, spec);
}

/** 连上一个已知的 Runtime（一次性连接，不重连）。 */
export async function openClient(
  discovery: RuntimeDiscovery,
  options: { readLanguage?: boolean } = {},
): Promise<{ client: BaoCutClient; info: RuntimeInfo }> {
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint: discovery.endpoint, token: discovery.token }),
    client: { kind: 'cli', name: 'baocut', version: RUNTIME_VERSION },
    reconnect: false,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  try {
    const info = await client.connect();
    if (options.readLanguage !== false) await applyRuntimeLanguage(client);
    return { client, info };
  } catch (error) {
    const state = client.state;
    client.close();
    if (state.status === 'incompatible') throw new CliError('PROTOCOL_MISMATCH', M.protocolMismatch(state.reason));
    throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeConnectFailed(error instanceof Error ? error.message : String(error)), {
      endpoint: discovery.endpoint,
    });
  }
}

/**
 * 连上之后按 Runtime 的 `ui.language` 定输出语言（`system` 时仍按本进程的系统语言）。读不到（旧 Runtime、权限不够、值不认识）
 * 时保持启动时的系统语言，不报错。BAOCUT_LOCALE 仍然优先。
 */
async function applyRuntimeLanguage(client: BaoCutClient): Promise<void> {
  try {
    const view = await client.request('settings.get', { keys: ['ui.language'] });
    const preference = view.settings['ui.language'] ?? view.defaults['ui.language'];
    if (isLanguagePreference(preference)) setLocale(resolveLanguage(preference, processLanguageTags()));
  } catch {
    // 忽略：保持系统语言。
  }
}

export interface Session {
  client: BaoCutClient;
  info: RuntimeInfo;
  /** 这次自动拉起的。 */
  started: boolean;
  /** 连上的 Runtime 的目录（执行命令以它为准）。 */
  catalog: CatalogListResult;
}

/**
 * 找到或拉起 Runtime、连上、取目录并过版本门。连接失败而那个 Runtime 随后不在了（进程退出，或撤掉了发现文件：空闲退出与这次
 * 连接撞上）时，再找或拉起一次，只重来一次。
 */
export async function connectRuntime(options: { home: string; start: boolean }): Promise<Session> {
  const first = await ensureRuntime(options.home, { start: options.start });
  try {
    return await openSession(first);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'RUNTIME_UNAVAILABLE' || !withdrawn(options.home, first.discovery)) throw error;
    return openSession(await ensureRuntime(options.home, { start: options.start }));
  }
}

async function openSession({ discovery, started }: { discovery: RuntimeDiscovery; started: boolean }): Promise<Session> {
  const { client, info } = await openClient(discovery);
  try {
    let catalog: CatalogListResult;
    try {
      catalog = await client.request('catalog.list', {});
    } catch (error) {
      if (client.state.status === 'connected') throw error;
      throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeLost(error instanceof Error ? error.message : String(error)));
    }
    checkInterfaceVersion(catalog.interfaceVersion);
    return { client, info, started, catalog };
  } catch (error) {
    client.close();
    throw error;
  }
}

/** 这个 Runtime 已经不在，或正在退出（发现文件不再指向它）。 */
export function withdrawn(home: string, discovery: RuntimeDiscovery): boolean {
  return !isProcessAlive(discovery.pid) || readDiscovery(home)?.instanceId !== discovery.instanceId;
}

/** 接口版本门（§5.6）：说明哪一边要更新。 */
export function checkInterfaceVersion(runtimeVersion: string, cliVersion: string = MCP_INTERFACE_VERSION): void {
  if (runtimeVersion === cliVersion) return;
  const update = Number(runtimeVersion) > Number(cliVersion) ? 'cli' : 'runtime';
  throw new CliError('INTERFACE_VERSION_MISMATCH', M.interfaceMismatch(cliVersion, runtimeVersion, update), {
    cli: cliVersion,
    runtime: runtimeVersion,
    update,
  });
}
