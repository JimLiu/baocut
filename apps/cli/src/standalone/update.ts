import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  STANDALONE_FEED_ENV,
  parseStandaloneFeed,
  standaloneFeedUrl,
  standaloneLayout,
  standaloneVersionDir,
  type CliEntryState,
  type StandaloneFeedEntry,
} from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { isProcessAlive, readDiscovery, standalonePackageAt, type StandalonePackage } from '../runtime/connection.ts';
import { compareVersionDirs, isVersionDir, runCommand, type CommandRunner, type StandaloneInstaller } from './install.ts';
import { S } from './standalone-copy.ts';

/**
 * `baocut update`（CLI 独立使用与发布 §9.3、§9.5）：读与 App 相同的更新源，取其中的 `cli` 条目，下载、校验、解开成新的版本目录，
 * 记成当前版本并切换入口；上一版留着回滚（`--rollback`）。还有 Runtime 在用的版本不删（发现信息的 `entry`），其余旧版本删掉。
 *
 * 校验：大小与 sha256 必须与更新源一致；解开后的包清单的版本、build、目标与变体与更新源和本包一致。macOS 再照 App 的自动更新
 * 验签名（`codesign --verify --deep --strict`）、Team ID 与本包相同、`spctl` 认可公证；本包没有 Team ID（未签名的开发构建）时
 * 只在 `BAOCUT_UPDATE_APPCAST` 指定了更新源（演练）时跳过签名检查，否则拒绝。Windows 与 App 一样只核对 sha256。
 */

export interface UpdateDeps {
  installer: StandaloneInstaller;
  /** 当前 CLI 所在的独立包。 */
  own: StandalonePackage;
  env?: NodeJS.ProcessEnv;
  /** Runtime Home：看有没有 Runtime 还在用旧版本。 */
  home: string;
  fetch?: typeof fetch;
  run?: CommandRunner;
  /** macOS 的系统版本（`sw_vers -productVersion`）；读不到为 null。 */
  systemVersion?: () => Promise<string | null>;
  log?: (line: string) => void;
}

export interface UpdateResult {
  /** 更新前的当前版本（版本目录名）。 */
  current: string;
  /** 更新源里的版本。 */
  latest: string;
  available: boolean;
  updated: boolean;
  /** 只检查（`--check`）时没有下面这些。 */
  entry?: { path: string; state: CliEntryState; switched: boolean };
  removed?: string[];
  /** 有 Runtime 在跑：它还是旧版本，停下后下一条命令拉起新的。 */
  runtime?: { pid: number } | null;
}

export interface RollbackResult {
  from: string;
  to: string;
  entry: { path: string; state: CliEntryState; switched: boolean };
  runtime: { pid: number } | null;
}

const FEED_TIMEOUT_MS = 30_000;

/** 本机现在的版本：记录里的当前版本（还在时），否则本包。 */
export function currentVersion(installer: StandaloneInstaller, own: StandalonePackage): string {
  const state = installer.readState();
  if (state.current && installer.packageAt(state.current)) return state.current;
  return installer.versionOf(own) ?? standaloneVersionDir(own.manifest);
}

export async function updateStandalone(deps: UpdateDeps, options: { check: boolean }): Promise<UpdateResult> {
  const { installer, own } = deps;
  const env = deps.env ?? process.env;
  const run = deps.run ?? runCommand;
  const release = await withLock(installer, async () => {
    const current = currentVersion(installer, own);
    const currentBuild = installer.packageAt(current)?.manifest.build ?? own.manifest.build;
    const { feed, overridden } = await readFeed(own, env, deps.fetch ?? fetch);
    const latest = `${feed.version}-build.${feed.build}`;
    const available = feed.build > currentBuild;
    if (options.check || !available) return { current, latest, available, updated: false } satisfies UpdateResult;

    if (installer.platform === 'darwin' && feed.minimumSystemVersion) {
      const system = await (deps.systemVersion ?? (() => macSystemVersion(run)))();
      if (system && compareDotted(system, feed.minimumSystemVersion) < 0) {
        throw new CliError('UPDATE_SYSTEM_TOO_OLD', S.systemTooOld(feed.minimumSystemVersion, system));
      }
    }
    const name = latest;
    if (!installer.packageAt(name) || installer.packageAt(name)!.manifest.build !== feed.build) {
      deps.log?.(S.downloading(feed.version, feed.build, Math.round(feed.cli.size / 1_000_000)));
      await fetchPackage(deps, feed.cli, name, { version: feed.version, build: feed.build }, overridden, run);
    }
    const previous = current === name ? installer.readState().previous : current;
    installer.writeState({ current: name, previous });
    const entry = await switchEntry(installer, current, name);
    const removed = collectGarbage(installer, [name, previous, installer.versionOf(own)], deps.home);
    return { current, latest, available, updated: true, entry, removed, runtime: runningRuntime(deps.home) } satisfies UpdateResult;
  });
  return release;
}

export async function rollbackStandalone(deps: Pick<UpdateDeps, 'installer' | 'own' | 'home'>): Promise<RollbackResult> {
  const { installer, own } = deps;
  return withLock(installer, async () => {
    const current = currentVersion(installer, own);
    const { previous } = installer.readState();
    if (!previous || previous === current || !installer.packageAt(previous)) throw new CliError('UPDATE_NO_PREVIOUS', S.noPrevious(installer.places.versions));
    installer.writeState({ current: previous, previous: current });
    const entry = await switchEntry(installer, current, previous);
    return { from: current, to: previous, entry, runtime: runningRuntime(deps.home) };
  });
}

/** 入口还指向本机装的独立包时改指向 `next`；没有入口、指向 App 或别的东西时不动（用户自己选的）。 */
async function switchEntry(installer: StandaloneInstaller, current: string, next: string): Promise<{ path: string; state: CliEntryState; switched: boolean }> {
  const found = installer.inspect(current);
  if (!found.ours) return { path: installer.places.entry, state: found.state, switched: false };
  await installer.point(next);
  return { path: installer.places.entry, state: installer.inspect(next).state, switched: true };
}

// ---- 更新源 ----

async function readFeed(own: StandalonePackage, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  const override = env[STANDALONE_FEED_ENV]?.trim();
  const url = override || standaloneFeedUrl(own.manifest.target, own.manifest.variant);
  let text: string;
  try {
    const local = localPath(url);
    if (local) {
      if (!override) throw new Error('file feeds need BAOCUT_UPDATE_APPCAST');
      text = fs.readFileSync(local, 'utf8');
    } else {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    }
  } catch (error) {
    throw new CliError('UPDATE_FEED_FAILED', S.feedFailed(url, errorText(error)), { url });
  }
  const parsed = parseStandaloneFeed(text, own.manifest.target, own.manifest.variant, Boolean(override));
  if (!parsed.ok) {
    if (parsed.error === 'missing') throw new CliError('UPDATE_NOT_PUBLISHED', S.feedMissing(url), { url });
    throw new CliError('UPDATE_FEED_FAILED', S.feedFailed(url, parsed.detail), { url });
  }
  return { feed: parsed, overridden: Boolean(override) };
}

function localPath(url: string): string | null {
  if (url.startsWith('file://')) return fileURLToPath(url);
  if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) return url;
  return null;
}

// ---- 下载、解开与校验 ----

async function fetchPackage(
  deps: UpdateDeps,
  entry: StandaloneFeedEntry,
  name: string,
  expected: { version: string; build: number },
  overridden: boolean,
  run: CommandRunner,
): Promise<void> {
  const { installer, own } = deps;
  const archive = path.join(installer.places.versions, `.download-${process.pid}-${Date.now()}.zip`);
  const staging = installer.stagingDir('update');
  try {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    await download(entry, archive, deps.fetch ?? fetch);
    const unpacked =
      installer.platform === 'win32'
        ? await run(path.win32.join(deps.env?.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', staging], { timeoutMs: 600_000 })
        : await run('/usr/bin/ditto', ['-x', '-k', archive, staging], { timeoutMs: 600_000 });
    if (!unpacked.ok) throw new CliError('UPDATE_VERIFY_FAILED', S.verifyFailed(`unpack: ${unpacked.stderr.trim() || 'failed'}`));
    const pkg = standalonePackageAt(staging, installer.platform);
    const problem = !pkg
      ? 'the archive is not a standalone command line package'
      : pkg.manifest.version !== expected.version || pkg.manifest.build !== expected.build
        ? `package ${pkg.manifest.version} (${pkg.manifest.build}) does not match the feed`
        : pkg.manifest.target !== own.manifest.target || pkg.manifest.variant !== own.manifest.variant
          ? `package is for ${pkg.manifest.target} ${pkg.manifest.variant}`
          : null;
    if (problem) throw new CliError('UPDATE_VERIFY_FAILED', S.verifyFailed(problem));
    if (installer.platform === 'darwin') await verifyMac(staging, own, overridden, run);
    installer.moveInto(staging, name);
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** 下载到 `file`，边写边算 sha256；大小或 sha256 不对时删掉并报错。 */
export async function download(entry: StandaloneFeedEntry, file: string, fetchImpl: typeof fetch): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > entry.size) return callback(new Error(`larger than the ${entry.size} bytes in the feed`));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const local = localPath(entry.url);
    let source: NodeJS.ReadableStream;
    if (local) source = fs.createReadStream(local);
    else {
      const response = await fetchImpl(entry.url, { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      source = Readable.fromWeb(response.body as never);
    }
    await pipeline(source, counter, fs.createWriteStream(file));
    if (size !== entry.size) throw new Error(`got ${size} bytes, the feed says ${entry.size}`);
    const digest = hash.digest('hex');
    if (digest !== entry.sha256) throw new Error(`sha256 ${digest} does not match the feed`);
  } catch (error) {
    fs.rmSync(file, { force: true });
    if (error instanceof CliError) throw error;
    throw new CliError('UPDATE_DOWNLOAD_FAILED', S.downloadFailed(entry.url, errorText(error)), { url: entry.url });
  }
}

/** macOS：签名完整、Team ID 与本包相同、公证认可；本包未签名时只在演练（指定了更新源）时放行。 */
async function verifyMac(staging: string, own: StandalonePackage, overridden: boolean, run: CommandRunner): Promise<void> {
  const bundle = (root: string) => path.join(root, standaloneLayout('darwin')!.top[0]!);
  const ownTeam = await teamOf(bundle(own.root), run);
  if (!ownTeam) {
    if (overridden) return;
    throw new CliError('UPDATE_UNSIGNED', S.unsignedBuild);
  }
  const app = bundle(staging);
  const verified = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeoutMs: 300_000 });
  if (!verified.ok) throw new CliError('UPDATE_VERIFY_FAILED', S.verifyFailed(`signature: ${verified.stderr.trim()}`));
  const team = await teamOf(app, run);
  if (team !== ownTeam) throw new CliError('UPDATE_VERIFY_FAILED', S.verifyFailed(`team ${team ?? 'none'} != ${ownTeam}`));
  const assessed = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', app], { timeoutMs: 120_000 });
  if (!assessed.ok) throw new CliError('UPDATE_VERIFY_FAILED', S.verifyFailed(`notarization: ${assessed.stderr.trim()}`));
}

/** `codesign -dv --verbose=2` 的 Team ID（在 stderr；未签名时这条命令返回非 0，不看退出码）。 */
async function teamOf(bundle: string, run: CommandRunner): Promise<string | null> {
  const result = await run('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeoutMs: 60_000 });
  for (const line of result.stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TeamIdentifier=')) continue;
    const value = trimmed.slice('TeamIdentifier='.length).trim();
    return value && value.toLowerCase() !== 'not set' ? value : null;
  }
  return null;
}

async function macSystemVersion(run: CommandRunner): Promise<string | null> {
  const result = await run('/usr/bin/sw_vers', ['-productVersion'], { timeoutMs: 10_000 });
  return result.ok ? result.stdout.trim() || null : null;
}

// ---- 清理与锁 ----

/**
 * 删掉不再要的版本目录：留下 `keep`（当前、上一版、本包）与还有 Runtime 在用的版本。有 Runtime 在跑而发现信息里没有 `entry`
 * （旧版 Runtime）时这次不删。也删掉已退出进程留下的临时目录。返回删掉的版本。
 */
export function collectGarbage(installer: StandaloneInstaller, keep: readonly (string | null)[], home: string): string[] {
  const discovery = readDiscovery(home);
  const keeps = new Set(keep.filter((name): name is string => !!name));
  if (discovery && isProcessAlive(discovery.pid)) {
    const entry = (discovery as { entry?: unknown }).entry;
    if (typeof entry !== 'string') return [];
    const used = versionContaining(installer, entry);
    if (used) keeps.add(used);
  }
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(installer.places.versions);
  } catch {
    return [];
  }
  for (const name of names) {
    const full = installer.versionPath(name);
    const staging = /^\.(?:install|update|download)-(\d+)-/.exec(name);
    if (staging) {
      if (Number(staging[1]) !== process.pid && !isProcessAlive(Number(staging[1]))) fs.rmSync(full, { recursive: true, force: true });
      continue;
    }
    if (!isVersionDir(name) || keeps.has(name)) continue;
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(name);
  }
  return removed.sort(compareVersionDirs);
}

function versionContaining(installer: StandaloneInstaller, file: string): string | null {
  const p = installer.platform === 'win32' ? path.win32 : path.posix;
  const relative = p.relative(installer.places.versions, file);
  if (!relative || relative.startsWith('..') || p.isAbsolute(relative)) return null;
  const first = relative.split(/[\\/]/)[0]!;
  return isVersionDir(first) ? first : null;
}

function runningRuntime(home: string): { pid: number } | null {
  const discovery = readDiscovery(home);
  return discovery && isProcessAlive(discovery.pid) ? { pid: discovery.pid } : null;
}

/** 同一时间只有一个 `baocut update`：`versions/.update.lock` 记着进程号，那个进程还在时拒绝。 */
async function withLock<T>(installer: StandaloneInstaller, body: () => Promise<T>): Promise<T> {
  const lock = path.join(installer.places.versions, '.update.lock');
  fs.mkdirSync(installer.places.versions, { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
      const holder = Number(fs.readFileSync(lock, 'utf8').trim());
      if (Number.isSafeInteger(holder) && holder > 0 && holder !== process.pid && isProcessAlive(holder)) {
        throw new CliError('UPDATE_IN_PROGRESS', S.inProgress(holder), { pid: holder });
      }
      fs.rmSync(lock, { force: true });
    }
  }
  try {
    return await body();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function compareDotted(left: string, right: string): number {
  const parts = (text: string) => text.trim().split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
