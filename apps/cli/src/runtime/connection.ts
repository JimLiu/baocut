import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaoCutClient } from '@baocut/client';
import {
  MCP_INTERFACE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  decideRuntimeReuse,
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
 * 连上之后的版本门：`catalog.list` 的接口版本与 CLI 的 `MCP_INTERFACE_VERSION` 不同时，对方是 CLI 拉起的、空闲的就请它停下、
 * 换成这一份安装的 Runtime（CLI 独立使用与发布 §4.2）；否则以退出码 3 拒绝，不按旧参数解释。
 */

/** 起不来、找不到 Runtime 时的下一步（CLI 独立使用与发布 §8.2）。 */
const DOCTOR = 'baocut doctor';

/** 一次请求的上限：工具调用（取帧、读大文档）可能久；等任务走 `jobs` 主题，不占请求。 */
const REQUEST_TIMEOUT_MS = 30 * 60_000;
/** 拉起之后等发现文件的上限。 */
const START_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

function defaultHome(): string {
  return path.join(os.homedir(), '.baocut');
}

export function runtimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BAOCUT_HOME || defaultHome());
}

/** 是不是默认的 `~/.baocut`（不是时，交给别的进程的命令要带上 `BAOCUT_HOME`）。 */
export function isDefaultHome(home: string): boolean {
  return path.resolve(home) === path.resolve(defaultHome());
}

export function discoveryFile(home: string): string {
  return path.join(home, 'runtime.json');
}

/** 实例锁（`@baocut/runtime-storage`）：活着的 Runtime 持有它，停完才放开。 */
export function lockFile(home: string): string {
  return path.join(home, 'runtime.lock');
}

/** 实例锁的持有者还活着（锁文件不在或读不了时 false；上一次开机留下的锁也是 false，见 `isRecordedProcessAlive`）。 */
export function lockHolderAlive(home: string): boolean {
  try {
    const { pid, acquiredAt } = JSON.parse(fs.readFileSync(lockFile(home), 'utf8')) as { pid?: unknown; acquiredAt?: unknown };
    return typeof pid === 'number' && isRecordedProcessAlive(pid, typeof acquiredAt === 'string' ? acquiredAt : '');
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

/** 记录时间早于这次开机多少才算上一次开机留下的：墙上时钟在开机后可能被校准。 */
const BOOT_SLACK_MS = 60_000;

/**
 * 发现文件或实例锁里记下的进程还在吗（与 `@baocut/runtime-storage` 的同名函数一致）。开机后 PID 重新分配，重启前没来得及
 * 清理的记录里的 PID 多半已经是别的进程：记录写于这次开机之前的一律当作不在。
 */
export function isRecordedProcessAlive(pid: number, recordedAt: string, now = Date.now()): boolean {
  const at = Date.parse(recordedAt);
  if (Number.isFinite(at) && at < now - os.uptime() * 1000 - BOOT_SLACK_MS) return false;
  return isProcessAlive(pid);
}

/**
 * 端点明确拒绝连接吗（与 `@baocut/runtime-storage` 的同名函数一致）。连不上的其他情况（超时、地址不对）不算拒绝：只在确定
 * 没人监听时才把发现文件当作过期。
 */
export function isEndpointRefused(endpoint: string, timeoutMs = 3_000): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return Promise.resolve(false);
  }
  const port = Number(url.port);
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port });
    const finish = (refused: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(refused);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'));
  });
}

/**
 * 正在跑的 Runtime 的发现信息；没有发现文件、进程已经不在、是上一次开机留下的，或端点拒绝连接时 null。判断与桌面端的
 * `isDiscoveryLive` 相同：Runtime 没收尾就被结束、PID 又被别的进程用上时，只看进程会把一个死掉的端点当成在跑。
 */
export async function findRuntime(home: string): Promise<RuntimeDiscovery | null> {
  const discovery = readDiscovery(home);
  if (!discovery || !isRecordedProcessAlive(discovery.pid, discovery.startedAt)) return null;
  return (await isEndpointRefused(discovery.endpoint)) ? null : discovery;
}

/** 怎么启动 Runtime。 */
export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'env' | 'packaged' | 'repo';
  /** 从仓库运行时，仓库 `package.json` 的 `engines.node`：当前的 Node 不在其中时不拉起（`checkRuntimeNode`）。 */
  nodeRange?: string;
  /**
   * 拉起的是这个 CLI 所在的那份安装（同一个仓库，或包着这个 CLI 的 App）：接口版本必定与 CLI 相同，版本不同的空闲 Runtime
   * 才值得替换（§4.2）。`BAOCUT_RUNTIME_ENTRY` 与别处装的 App 不算。
   */
  own?: boolean;
}

/** 给人看的入口：打包的写 App 的可执行文件，其余写入口文件（是可执行文件时写它）。 */
export function launchEntry(spec: LaunchSpec): string {
  return spec.source === 'packaged' ? spec.command : (spec.args.find((arg) => !arg.startsWith('-')) ?? spec.command);
}

/**
 * 拉起的 Runtime 把密钥放哪（架构设计 §6.8）：打包的入口带 `--credential-store`；仓库入口是开发构建的默认（文件）；
 * `BAOCUT_RUNTIME_ENTRY` 由那个入口自己定，这里不知道（null）。
 */
export function launchCredentialStore(spec: LaunchSpec): 'keychain' | 'file' | null {
  const flag = spec.args.indexOf('--credential-store');
  if (flag >= 0) return spec.args[flag + 1] === 'keychain' ? 'keychain' : 'file';
  return spec.source === 'repo' ? 'file' : null;
}

/** 用来跑源码 Runtime 的 Node：版本，以及不带旗标时会不会去掉类型标注。 */
export interface NodeInfo {
  version: string;
  stripsTypes: boolean;
}

/**
 * 当前的 Node 不带旗标时会不会去掉类型标注。`process.features.typescript` 也反映了这个进程自己的旗标：CLI 是以
 * `--experimental-strip-types` 跑起来的话，子进程不带它仍然不认 `.ts`。
 */
function currentNode(): NodeInfo {
  const flagged = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)].some((arg) =>
    /^--experimental-(strip|transform)-types$/.test(arg),
  );
  return { version: process.versions.node, stripsTypes: Boolean(process.features.typescript) && !flagged };
}

/** 用当前的 Node 跑一个源码入口：不默认去掉类型标注时补 `--experimental-strip-types`。 */
function nodeArgs(entry: string, node: NodeInfo): string[] {
  return /\.(ts|mts)$/.test(entry) && !node.stripsTypes ? ['--experimental-strip-types', entry] : [entry];
}

/**
 * Node 版本在不在 `engines.node` 的范围里。只认 `^X.Y.Z` 与 `>=X.Y.Z` 用 `||` 连起来的写法；认不出的范围不拦。
 */
export function nodeSatisfies(version: string, range: string): boolean {
  const parse = (text: string) => text.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const compare = (a: number[], b: number[]) => (a[0]! - b[0]!) || (a[1]! - b[1]!) || (a[2]! - b[2]!);
  const current = parse(version.replace(/^v/, ''));
  const alternatives = range.split('||').map((part) => part.trim());
  let understood = false;
  for (const alternative of alternatives) {
    const match = /^(\^|>=)\s*(\d+(?:\.\d+){0,2})$/.exec(alternative);
    if (!match) continue;
    understood = true;
    const floor = parse(match[2]!);
    if (compare(current, floor) >= 0 && (match[1] === '>=' || current[0] === floor[0])) return true;
  }
  return !understood;
}

/** 从仓库拉起之前看 Node 的版本：不合要求时报出要哪个版本，不留一行难懂的错误在 `cli-runtime.log` 里。 */
export function checkRuntimeNode(spec: LaunchSpec, version: string = process.versions.node): void {
  if (spec.nodeRange && !nodeSatisfies(version, spec.nodeRange)) {
    throw new CliError('RUNTIME_START_FAILED', M.runtimeNodeUnsupported(version, spec.nodeRange), {
      node: version,
      required: spec.nodeRange,
      next: DOCTOR,
    });
  }
}

/**
 * Runtime 的入口，依次找：`BAOCUT_RUNTIME_ENTRY`（`.ts` / `.js` 用当前的 Node 跑，否则当可执行文件）→ 当前 CLI 所在的桌面包 →
 * 从仓库运行且主目录不是默认的 `~/.baocut` 时，仓库里的 `apps/runtime/src/main.ts`（同一份代码，新工具才调得到）→ 标准安装位置
 * （以 Node 方式运行它带的 Runtime，资源位置照桌面端的 `packagedResourceEnv`）→ 仓库里的入口。默认主目录是用户的真实数据与钥匙串，
 * 开发中的代码不碰它，留给装好的应用（Agent 面设计 §5.6）。
 */
export function resolveRuntimeLaunch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  from: string = path.dirname(fileURLToPath(import.meta.url)),
  node: NodeInfo = currentNode(),
): LaunchSpec | null {
  const explicit = env.BAOCUT_RUNTIME_ENTRY;
  if (explicit) {
    const entry = path.resolve(explicit);
    return /\.(ts|mts|js|mjs|cjs)$/.test(entry)
      ? { command: process.execPath, args: nodeArgs(entry, node), env: {}, source: 'env' }
      : { command: entry, args: [], env: {}, source: 'env' };
  }
  // 桌面包可能就放在仓库的打包输出目录里：包内的 CLI 不算从仓库运行。
  const root = path.basename(path.resolve(from, '..', '..')) === 'app.asar' ? null : repoRoot(from);
  const entry = root && path.join(root, 'apps', 'runtime', 'src', 'main.ts');
  const repo: LaunchSpec | null =
    root && entry && fs.existsSync(entry)
      ? { command: process.execPath, args: nodeArgs(entry, node), env: {}, source: 'repo', own: true, ...repoNodeRange(root) }
      : null;
  if (repo && runtimeHome(env) !== path.resolve(defaultHome())) return repo;
  for (const app of packagedApps(env, platform, from)) {
    if (fs.existsSync(app.executable) && fs.existsSync(path.join(app.resources, 'app.asar'))) {
      return {
        command: app.executable,
        args: [path.join(app.resources, 'app.asar', 'out', 'main', 'runtime.js'), '--credential-store', 'keychain'],
        env: { ELECTRON_RUN_AS_NODE: '1', ...packagedResourceEnv(app.resources, platform) },
        source: 'packaged',
        own: Boolean(app.own),
      };
    }
  }
  return repo;
}

/**
 * 这个 CLI 自己怎么启动（`mcp install` 写进宿主的 stdio 形式，CLI 独立使用与发布 §6.1）：包内的 CLI 是 App 自带的命令行入口
 * （`entry`：macOS `Contents/MacOS/baocut-cli`，Windows 安装目录里的 `baocut.cmd`）；从仓库运行时是当前的 Node 加仓库里的
 * `apps/cli/src/main.ts`（`entry` 为 null）。都认不出（Linux 的包）时 null。
 */
export function ownCliCommand(
  platform: NodeJS.Platform = process.platform,
  from: string = path.dirname(fileURLToPath(import.meta.url)),
  node: NodeInfo = currentNode(),
): { command: string; args: string[]; entry: string | null } | null {
  const own = packagedApps({}, platform, from).find((app) => app.own);
  if (own) {
    const entry = packagedResourceEnv(own.resources, platform).BAOCUT_CLI_ENTRY;
    return entry ? { command: entry, args: [], entry } : null;
  }
  const root = repoRoot(from);
  const main = root && path.join(root, 'apps', 'cli', 'src', 'main.ts');
  return main && fs.existsSync(main) ? { command: process.execPath, args: nodeArgs(main, node), entry: null } : null;
}

/** 装好的 BaoCut 应用可能在的位置（Windows 的 NSIS 按用户安装、macOS 的 Applications）。 */
export function packagedApps(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  from = path.dirname(fileURLToPath(import.meta.url)),
): { executable: string; resources: string; own?: boolean }[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // In app.asar/out/main, prefer the app containing this CLI over another installed version.
  const archive = paths.resolve(from, '..', '..');
  const own = paths.basename(archive) === 'app.asar' && (platform === 'darwin' || platform === 'win32')
    ? [{
        executable: platform === 'darwin'
          ? paths.resolve(archive, '..', '..', 'MacOS', 'BaoCut')
          : paths.resolve(archive, '..', '..', 'BaoCut.exe'),
        resources: paths.dirname(archive),
        own: true,
      }]
    : [];
  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'BaoCut'),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'BaoCut'),
    ];
    return [...own, ...roots
      .filter((root): root is string => Boolean(root))
      .map((root) => ({ executable: path.win32.join(root, 'BaoCut.exe'), resources: path.win32.join(root, 'resources') }))];
  }
  if (platform === 'darwin') {
    return [...own, ...['/Applications', path.posix.join(os.homedir().replaceAll('\\', '/'), 'Applications')].map((dir) => ({
      executable: path.posix.join(dir, 'BaoCut.app', 'Contents', 'MacOS', 'BaoCut'),
      resources: path.posix.join(dir, 'BaoCut.app', 'Contents', 'Resources'),
    }))];
  }
  return [];
}

/**
 * 打包后的 Runtime 按路径读的东西：与桌面端 `apps/desktop/src/main/packaged-resources.ts` 的 `packagedResourceEnv` 相同
 * （CLI 不依赖桌面端的包；`connection.test.ts` 核对两边一致）。
 */
export function packagedResourceEnv(resources: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  return {
    BAOCUT_BIN_DIR: path.join(resources, 'bin'),
    BAOCUT_TEMPLATES_DIR: path.join(resources, 'templates'),
    BAOCUT_STICKERS_DIR: path.join(resources, 'stickers'),
    BAOCUT_SKILLS_DIR: path.join(resources, 'skills', 'baocut', 'built-in-skills'),
    BAOCUT_AGENT_SKILLS_DIR: path.join(resources, 'skills'),
    BAOCUT_AGENT_SKILL_DIR: path.join(resources, 'agent-skill', 'baocut'),
    ...(platform === 'darwin' ? { BAOCUT_CLI_ENTRY: path.join(path.dirname(resources), 'MacOS', 'baocut-cli') } : {}),
    ...(platform === 'win32' ? { BAOCUT_CLI_ENTRY: path.join(path.dirname(resources), 'baocut.cmd') } : {}),
    BAOCUT_MODEL_ASSETS_DIR: path.join(resources, 'model-assets'),
    BAOCUT_WEB_DIST: path.join(resources, 'web'),
    BAOCUT_SLIDES_EDITOR_DIST: path.join(resources, 'slides-editor'),
    BAOCUT_DESIGN_EDITOR_DIST: path.join(resources, 'design-editor'),
    BAOCUT_DESIGN_SYSTEM_EDITOR_DIST: path.join(resources, 'design-system-editor'),
    BAOCUT_DOCS_EDITOR_DIST: path.join(resources, 'docs-editor'),
    ...(platform === 'darwin' ? { PMETAL_METALLIB_PATH: path.join(resources, 'bin', 'mlx.metallib') } : {}),
  };
}

/** 往上找仓库根（`package.json` 的 name 是 `baocut`）。 */
function repoNodeRange(root: string): { nodeRange?: string } {
  try {
    const range = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { engines?: { node?: unknown } }).engines?.node;
    return typeof range === 'string' ? { nodeRange: range } : {};
  } catch {
    return {};
  }
}

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
      if (child.error) throw new CliError('RUNTIME_START_FAILED', M.runtimeStartFailed(child.error.message, log), { log, next: DOCTOR });
      const discovery = await findRuntime(home);
      if (discovery && (discovery.pid === child.pid || child.exitCode === 3)) return { discovery, started: discovery.pid === child.pid };
      if (child.exitCode !== undefined && child.exitCode !== 3) {
        throw new CliError('RUNTIME_START_FAILED', M.runtimeStartFailed(M.exitedWith(child.exitCode), log), {
          log,
          tail: tail(log),
          next: DOCTOR,
        });
      }
      if (Date.now() >= deadline) {
        throw new CliError('RUNTIME_START_FAILED', M.runtimeStartTimeout(Math.round(timeoutMs / 1000), log), {
          log,
          tail: tail(log),
          next: DOCTOR,
        });
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
  const running = await findRuntime(home);
  if (running) return { discovery: running, started: false };
  const spec = resolveRuntimeLaunch(options.env);
  if (!options.start) {
    // 说明 `runtime ensure` 会拉起哪一个（CLI 独立使用与发布 §8.2）：哪个入口、哪个主目录、密钥放哪。
    const launch = spec ? { entry: launchEntry(spec), credentialStore: launchCredentialStore(spec) } : {};
    const next = spec ? M.runtimeEnsureNext(launchEntry(spec), launchCredentialStore(spec)) : DOCTOR;
    throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeNotRunning(home), { home, ...launch, next });
  }
  if (!spec) throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeNoEntry, { home, next: DOCTOR });
  checkRuntimeNode(spec);
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
export async function connectRuntime(options: { home: string; start: boolean; env?: NodeJS.ProcessEnv }): Promise<Session> {
  const { home, start, env } = options;
  const first = await ensureRuntime(home, { start, env });
  // 只有能拉起、拉起的又是这个 CLI 自己那份安装时才替换：换成别处的 Runtime 版本照样不对。
  const replace = start && Boolean(resolveRuntimeLaunch(env)?.own);
  try {
    return await openSession(first, { home, replace, env });
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'RUNTIME_UNAVAILABLE' || !withdrawn(home, first.discovery)) throw error;
    return openSession(await ensureRuntime(home, { start, env }), { home, replace: false, env });
  }
}

/** CLI 自己的版本：比的是接口版本（§4.2）。 */
const OWN_IDENTITY = { runtimeVersion: RUNTIME_VERSION, protocolVersion: PROTOCOL_VERSION, interfaceVersion: MCP_INTERFACE_VERSION, build: null };
/** 请旧的 Runtime 停下之后等它放开实例锁的上限：它的停止顺序有 15 秒的兜底。 */
const REPLACE_TIMEOUT_MS = 20_000;

async function openSession(
  { discovery, started }: { discovery: RuntimeDiscovery; started: boolean },
  options: { home: string; replace: boolean; env?: NodeJS.ProcessEnv },
): Promise<Session> {
  const { client, info } = await openClient(discovery);
  try {
    let catalog: CatalogListResult;
    try {
      catalog = await client.request('catalog.list', {});
    } catch (error) {
      if (client.state.status === 'connected') throw error;
      throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeLost(error instanceof Error ? error.message : String(error)));
    }
    if (catalog.interfaceVersion === MCP_INTERFACE_VERSION) return { client, info, started, catalog };
    // 接口版本不同（§4.2）：问它忙不忙。CLI 拉起的、除了这条连接没人在用、没有任务时请它停下，换成自己的。
    const status = await client.request('runtime.status', {}).catch(() => null);
    const decision = decideRuntimeReuse({
      seeker: 'cli',
      own: OWN_IDENTITY,
      found: { ...info, interfaceVersion: catalog.interfaceVersion },
      activity: status,
    });
    if (decision.action === 'replace' && options.replace) {
      const stopped = await client.request('runtime.stop', {}).then(
        () => true,
        () => false,
      );
      client.close();
      if (stopped && (await released(options.home, discovery))) {
        const next = await ensureRuntime(options.home, { start: true, env: options.env });
        return await openSession(next, { ...options, replace: false });
      }
      // 停不下（刚好有人连上）或等不到它退出：照版本门报。
    }
    // 空闲却没替换（`--no-start`，或这个 CLI 拉起的会是别处的 Runtime）：只报版本门本身。
    if (decision.action === 'replace') throw interfaceMismatch(catalog.interfaceVersion, MCP_INTERFACE_VERSION);
    const busy = status ? { activeJobs: status.activeJobs, connections: { ...status.connections, cli: Math.max(0, status.connections.cli - 1) } } : {};
    throw interfaceMismatch(catalog.interfaceVersion, MCP_INTERFACE_VERSION, { launchedBy: info.launchedBy, ...busy });
  } catch (error) {
    client.close();
    throw error;
  }
}

/** 请停下的那个 Runtime 放开了实例锁、撤掉了发现文件（或换成了别人刚拉起的）。 */
async function released(home: string, discovery: RuntimeDiscovery, timeoutMs = REPLACE_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = readDiscovery(home);
    if ((!current || current.instanceId !== discovery.instanceId) && !(lockHolderAlive(home) && !current)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

/** 这个 Runtime 已经不在，或正在退出（发现文件不再指向它）。 */
export function withdrawn(home: string, discovery: RuntimeDiscovery): boolean {
  return !isRecordedProcessAlive(discovery.pid, discovery.startedAt) || readDiscovery(home)?.instanceId !== discovery.instanceId;
}

/** 接口版本门（§5.6）：说明哪一边要更新。 */
export function checkInterfaceVersion(runtimeVersion: string, cliVersion: string = MCP_INTERFACE_VERSION): void {
  if (runtimeVersion !== cliVersion) throw interfaceMismatch(runtimeVersion, cliVersion);
}

/**
 * 接口版本不同而没有替换（§4.2）：说明哪一边要更新；知道对方是谁拉起的、手上有什么时一并写上，CLI 拉起的再说明它空闲后再运行会
 * 自动替换。
 */
export function interfaceMismatch(
  runtimeVersion: string,
  cliVersion: string,
  other: { launchedBy?: RuntimeInfo['launchedBy']; activeJobs?: number; connections?: { desktop: number; cli: number; agent: number } } = {},
): CliError {
  const update = Number(runtimeVersion) > Number(cliVersion) ? 'cli' : 'runtime';
  const known = other.launchedBy !== undefined;
  const busy =
    other.activeJobs !== undefined ? M.runtimeBusyDetail(other.activeJobs, other.connections?.desktop ?? 0, other.connections?.cli ?? 0) : null;
  const detail = !known ? '' : other.launchedBy === 'cli' ? M.replaceWhenIdle(busy) : M.notCliLaunched;
  return new CliError('INTERFACE_VERSION_MISMATCH', `${M.interfaceMismatch(cliVersion, runtimeVersion, update)}${detail ? ` ${detail}` : ''}`, {
    cli: cliVersion,
    runtime: runtimeVersion,
    update,
    ...(known ? { launchedBy: other.launchedBy } : {}),
    ...(other.activeJobs !== undefined ? { activeJobs: other.activeJobs } : {}),
    ...(other.connections ? { connections: other.connections } : {}),
  });
}
