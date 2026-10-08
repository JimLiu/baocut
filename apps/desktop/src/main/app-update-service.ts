import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppUpdateFailure, AppUpdateInfo, AppUpdateNotice, AppUpdatePrefs, AppUpdateSnapshot, AppUpdateState } from '@baocut/ui';
import {
  FIRST_CHECK_DELAY_S,
  QUIT_INSTALL_DEADLINE_MS,
  TICK_S,
  bucketFromId,
  checkPending,
  fileName,
  fileUrlPath,
  followup,
  isFileUrl,
  isInstallationId,
  isNewer,
  mayAutoCheck,
  parseManifest,
  percent,
  progressDue,
  reduce,
  rolloutAdmits,
  rolloutFraction,
  shouldAutoCheck,
  stateInfo,
  systemRequirementUnmet,
  type CheckReport,
  type FeedTarget,
  type Origin,
  type Rollout,
  type UpdateEvent,
} from './app-update-rules.ts';

/*
 * 应用自动更新的主进程服务（架构设计 §2.6）：拉清单、流式下载并边收边算 SHA-256、校验、缓存与清理、
 * 节拍器、安装的分派。判据在 app-update-rules.ts；平台的换包在 app-update-install.ts；Electron 的接线在
 * app-update-ipc.ts。这里不引 Electron：外部世界（网络、时钟、定时器、访达、退出）都经依赖注入，单测用临时目录、
 * file:// 清单与假的网络。
 *
 * 下载好之后先过校验段（平台的校验与就位，macOS 在这里解开并验签），通过了才算「已下载」；「已下载」时照常静默检查，
 * 更新的 build 作废旧下载。从不替用户重启：「重启并更新」只在界面过完停止屏障、调了 `install` 之后才起，换包程序起好后
 * 由应用正常退出（`before-quit` 里停 Runtime，走 §2.4 的正常停止）；用户自己退出应用时，Runtime 停下之后
 * `installOnQuit` 把就位的新包交给换包程序，换完不重新打开。
 */

/** 一段字节流（本地文件的读流，或网络响应体）。 */
export type ByteSource = AsyncIterable<Uint8Array>;

export type DownloadResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; failure: AppUpdateFailure; detail: string };

const CANCELLED: DownloadResult = { ok: false, cancelled: true };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface DownloadOptions {
  signal: AbortSignal;
  /** 0–100，调用方自己节流。 */
  onProgress(pct: number): void;
  /** 打开 https 安装包的字节流（本地文件不经它）。 */
  openRemote(url: string, signal: AbortSignal): Promise<ByteSource>;
}

/**
 * 流式下载到 `dir/<文件名>.part`，边写边算 SHA-256；大小、摘要都对才改名成正式文件名。超出清单大小立即中止，
 * `signal` 一停即中止。任何失败都删掉 `.part`；成功后清掉缓存目录里别的安装包。
 */
export async function downloadTo(info: AppUpdateInfo, dir: string, options: DownloadOptions): Promise<DownloadResult> {
  const name = fileName(info);
  const destination = path.join(dir, name);
  const part = path.join(dir, `${name}.part`);
  const failed = (failure: AppUpdateFailure, detail: string): DownloadResult => ({ ok: false, cancelled: false, failure, detail });
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    return failed('download', errorText(error));
  }
  const open: { handle: FileHandle | null } = { handle: null };
  const result = await (async (): Promise<DownloadResult> => {
    let source: ByteSource;
    try {
      const local = isFileUrl(info.url) ? fileUrlPath(info.url) : null;
      source = local !== null ? createReadStream(local) : await options.openRemote(info.url, options.signal);
      open.handle = await fs.open(part, 'w');
    } catch (error) {
      return options.signal.aborted ? CANCELLED : failed('download', errorText(error));
    }
    const hash = createHash('sha256');
    let received = 0;
    options.onProgress(0);
    try {
      for await (const chunk of source) {
        if (options.signal.aborted) return CANCELLED;
        received += chunk.byteLength;
        if (received > info.size) return failed('verify', `larger than the manifest size ${info.size}`);
        hash.update(chunk);
        await open.handle.write(chunk);
        options.onProgress(percent(received, info.size));
      }
    } catch (error) {
      return options.signal.aborted ? CANCELLED : failed('download', errorText(error));
    }
    if (options.signal.aborted) return CANCELLED;
    try {
      await open.handle.sync();
      await open.handle.close();
      open.handle = null;
    } catch (error) {
      return failed('download', errorText(error));
    }
    if (received !== info.size) return failed('verify', `size ${received} != ${info.size}`);
    const actual = hash.digest('hex');
    if (actual !== info.sha256) return failed('verify', `sha256 ${actual} != ${info.sha256}`);
    try {
      await fs.rm(destination, { force: true });
      await fs.rename(part, destination);
    } catch (error) {
      return failed('download', errorText(error));
    }
    return { ok: true, path: destination };
  })();
  await open.handle?.close().catch(() => undefined);
  if (result.ok) await prune(dir, destination);
  else await fs.rm(part, { force: true }).catch(() => undefined);
  return result;
}

/**
 * 新包下好后清掉缓存目录里别的安装包、残留的 `.part` 与解开过的包（`unpack-*`，旧版本动辄上百 MB）。新包自己的
 * 解开目录在这之后的校验段里重新建。
 */
async function prune(dir: string, keep: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.startsWith('unpack-')) await fs.rm(file, { recursive: true, force: true }).catch(() => undefined);
    if (!entry.isFile() || file === keep) continue;
    if (/\.(zip|dmg|exe|part)$/i.test(entry.name)) await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

/**
 * 清掉缓存目录里早于 `before`（毫秒）的安装包与 `.part`：Windows 的安装器装完重新打开应用后，它自己留在缓存目录里
 * （macOS 的换包脚本换完就删）。只删早于这次启动的，免得删掉这次启动之后才下好的新一版。删不掉的（安装器还没退出）留着。
 */
export async function discardStaleDownloads(dir: string, before: number): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(zip|dmg|exe|part)$/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < before) await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

/** 文件存在，且大小、摘要都与清单一致。 */
export async function verifyFile(file: string, info: Pick<AppUpdateInfo, 'size' | 'sha256'>): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size !== info.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest('hex') === info.sha256;
  } catch {
    return false;
  }
}

/** 缓存目录里同一 build 已下载且仍然完好的文件（重新算一遍摘要）。 */
export async function cachedDownload(info: AppUpdateInfo, dir: string): Promise<string | null> {
  const file = path.join(dir, fileName(info));
  return (await verifyFile(file, info)) ? file : null;
}

/**
 * 本机在分批推送里的位置（[0, 1)）：取 `file` 里的安装标识；没有或读不懂时新生成一个并尽量写回。写不进去也照用，
 * 只是下次启动会换一个位置。
 */
export async function installationBucket(file: string): Promise<number> {
  const stored = await fs.readFile(file, 'utf8').then(
    (text) => text.trim(),
    () => '',
  );
  if (isInstallationId(stored)) return bucketFromId(stored);
  const id = randomUUID();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${id}\n`);
  } catch {
    // 用这次生成的。
  }
  return bucketFromId(id);
}

// ---- 服务 ----

/** 平台换包的结果：换包程序起来了（应用该退出了）、这台机器不能自己换包（走手动）、失败。 */
export type InstallOutcome = { type: 'launched' } | { type: 'fallback' } | { type: 'failed'; failure: AppUpdateFailure; detail: string };

/** 就位的新包：macOS 解开、校验过的 `.app` 与它所在的目录（缓存目录里的 `unpack-<build>`）。 */
export interface StagedApp {
  app: string;
  dir: string;
}

/** 下载之后、进「已下载」之前的校验与就位：就位了、不用就位（Windows、不能自己换包的机器）、失败。 */
export type Prepared =
  | { type: 'staged'; staged: StagedApp }
  | { type: 'none' }
  | { type: 'failed'; failure: AppUpdateFailure; detail: string };

export interface AppUpdateDeps {
  /** 为什么不检查更新；启用时 null（`availability` 的结果）。 */
  unsupported: 'dev' | 'appStore' | null;
  target: FeedTarget | null;
  /** 本构建的变体（Windows 的 cpu / cuda / vulkan，打包时写入）；清单写了 `variant` 时必须与它一致。null 按标准版。 */
  variant: string | null;
  /** 读哪份清单；`allowFileUrl` 只在更新源被环境变量覆盖成本地文件时为真。 */
  feed: { url: string; allowFileUrl: boolean } | null;
  current: { version: string; build: number };
  /** 本机系统版本（macOS 才比较）。 */
  systemVersion: string | null;
  macos: boolean;
  cacheDir: string | null;
  /** 取 https 清单的正文（本地文件不经它）。 */
  fetchText(url: string): Promise<string>;
  openRemote(url: string, signal: AbortSignal): Promise<ByteSource>;
  /** 这台机器能不能不经用户手动地换包。 */
  canAutoInstall(): Promise<boolean>;
  /** 下载（或在缓存里找到）、核对过摘要之后的校验与就位（macOS 解开并验签）。`signal` 停了就结束。 */
  prepare(info: AppUpdateInfo, archive: string, signal: AbortSignal): Promise<Prepared>;
  /**
   * 平台换包。`staged` 是就位的新包（没有时：Windows 照常；macOS 的「重启并更新」从头解开校验，退出即安装不装）；
   * `relaunch` 换完要不要重新打开应用（退出即安装不开）。
   */
  installPackage(info: AppUpdateInfo, archive: string, options: { staged: StagedApp | null; relaunch: boolean }): Promise<InstallOutcome>;
  /** 在访达 / 资源管理器里显示文件。 */
  reveal(file: string): void;
  openDownloadPage(): void;
  /** 应用正常退出（`before-quit` 里停 Runtime）。 */
  quit(): void;
  /** 本机在分批推送里的位置（[0, 1)，每台安装固定）；只在清单分批、自动检查时才读。 */
  rolloutBucket(): Promise<number>;
  /** 现在（毫秒）。 */
  now(): number;
  /** 定时器；返回取消。 */
  schedule(run: () => void, ms: number): () => void;
  log(message: string): void;
}

export interface AppUpdateService {
  snapshot(): AppUpdateSnapshot;
  /** 起节拍器：启动 15 秒后第一拍，之后每 30 分钟一拍。 */
  start(): void;
  dispose(): void;
  /** 更新偏好（Runtime 持有）。收到之前不做自动检查；打开自动检查时到点了就立刻补一拍。 */
  configure(prefs: AppUpdatePrefs): void;
  check(origin: Origin): Promise<void>;
  download(): void;
  cancel(): void;
  /** 「重启并更新」：换完重新打开。 */
  install(): Promise<void>;
  /**
   * 退出即安装：应用正常退出、Runtime 已经停下之后调。只在「已下载」（含静默检查在途）、这台机器能自己换包时把就位的
   * 新包交给换包程序，换完不重新打开；别的情况什么都不做。有时限，从不抛。
   */
  installOnQuit(): Promise<void>;
  openDownloadPage(): void;
  onState(listener: (snapshot: AppUpdateSnapshot) => void): () => void;
  onNotice(listener: (notice: AppUpdateNotice) => void): () => void;
}

export function createAppUpdateService(deps: AppUpdateDeps): AppUpdateService {
  let state: AppUpdateState = deps.unsupported ? { k: 'unsupported', why: deps.unsupported } : { k: 'idle' };
  let lastCheckAt: number | null = null;
  let prefs: AppUpdatePrefs | null = null;
  /** 启动 15 秒的第一拍到点了。 */
  let firstTickDue = false;
  /** 第一拍已经用掉（真的轮到过一次自动检查）。 */
  let firstTickUsed = false;
  /** 有一次检查在飞：静默检查不进 `checking`，看状态看不出来，靠它防重复。 */
  let checkInFlight = false;
  /** 在飞的下载（含校验段）；取消或新一轮下载时代际加一，晚到的结果对不上就丢。 */
  let generation = 0;
  let active: { generation: number; controller: AbortController; origin: Origin } | null = null;
  /** 「已下载」那一版过校验段的结果：哪个 build、哪个文件、就位的新包（不用就位的为 null）。 */
  let prepared: { build: number; path: string; staged: StagedApp | null } | null = null;
  /** 校验段一次只跑一个：取消后被停下的那次收完尾，下一次才开始解开（两次用的是同一个 `unpack-<build>`）。 */
  let stagingLock: Promise<void> = Promise.resolve();
  /** 退出即安装只做一次。 */
  let quitInstallStarted = false;
  /** 本次运行已提醒过「已下载」的 build（每个 build 只提醒一次）。 */
  let toastedBuild: number | null = null;
  let stopTimer: (() => void) | null = null;
  let disposed = false;
  let bucket: Promise<number> | null = null;
  const stateListeners = new Set<(snapshot: AppUpdateSnapshot) => void>();
  const noticeListeners = new Set<(notice: AppUpdateNotice) => void>();

  const nowS = () => Math.floor(deps.now() / 1000);
  const current = (): AppUpdateState => state;
  const snapshot = (): AppUpdateSnapshot => ({ state, lastCheckAt, current: deps.current });
  const emit = () => {
    const current = snapshot();
    for (const listener of stateListeners) listener(current);
  };
  /** 转移状态；变了就推一份。返回变没变。 */
  const dispatch = (event: UpdateEvent): boolean => {
    const next = reduce(state, event);
    if (next === state) return false;
    state = next;
    emit();
    return true;
  };
  const notify = (notice: AppUpdateNotice) => {
    for (const listener of noticeListeners) listener(notice);
  };
  const notifyReady = (info: AppUpdateInfo) => {
    if (toastedBuild === info.build) return;
    toastedBuild = info.build;
    notify({ kind: 'ready', info });
  };

  /** 「已下载」的那一版就位的新包。 */
  const preparedFor = (info: AppUpdateInfo, archive: string) =>
    prepared?.build === info.build && prepared.path === archive ? prepared : null;

  /** 作废一份已下载的包：删掉安装包与解开的目录（作废的那一版被新 build 取代、被撤回，或校验、安装时不过）。 */
  async function discardDownload(archive: string, build: number): Promise<void> {
    const staged = prepared?.build === build ? prepared.staged : null;
    if (prepared?.build === build) prepared = null;
    await fs.rm(archive, { force: true }).catch(() => undefined);
    if (staged) await fs.rm(staged.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * 分批推送（只管自动检查）：手动检查、清单不分批、或检查前的状态已经带着同一 build（手动检查找到过、下载过）时照推，
   * 不把用户已经拿到的更新收回去；否则本机的位置落在已放开的部分里才推。
   */
  async function admitted(origin: Origin, info: AppUpdateInfo, rollout: Rollout | null, prior: AppUpdateInfo | null): Promise<boolean> {
    if (origin === 'manual' || !rollout || prior?.build === info.build) return true;
    const fraction = rolloutFraction(rollout, deps.now());
    if (fraction >= 1) return true;
    bucket ??= deps.rolloutBucket().catch(() => Math.random());
    const mine = await bucket;
    if (rolloutAdmits(fraction, mine)) return true;
    // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
    deps.log(`分批推送：build ${info.build} 暂不推给本机（已放开 ${(fraction * 100).toFixed(1)}%，本机位置 ${(mine * 100).toFixed(1)}%）`);
    return false;
  }

  async function runCheck(origin: Origin, prior: AppUpdateState): Promise<CheckReport> {
    if (!deps.target || !deps.feed) throw new Error('no update feed for this platform');
    const { url, allowFileUrl } = deps.feed;
    const local = isFileUrl(url) ? fileUrlPath(url) : null;
    const text = local !== null ? await fs.readFile(local, 'utf8') : await deps.fetchText(url);
    const parsed = parseManifest(text, deps.target, allowFileUrl, deps.variant);
    if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`);
    const { info, rollout } = parsed;
    const nothing: CheckReport = { info: null, heldBack: false, cached: null, canAutoInstall: false, systemUnmet: null };
    if (!isNewer(info, deps.current.build)) return nothing;
    if (!(await admitted(origin, info, rollout, stateInfo(prior)))) return { ...nothing, heldBack: true };
    // 已下载的就是这一版：结果只会是留在已下载，不必每 6 小时重算一遍上百 MB 的摘要。
    const kept = prior.k === 'ready' && prior.info.build === info.build;
    return {
      info,
      heldBack: false,
      systemUnmet: systemRequirementUnmet(info, deps.systemVersion, deps.macos),
      cached: deps.cacheDir && !kept ? await cachedDownload(info, deps.cacheDir) : null,
      canAutoInstall: await deps.canAutoInstall(),
    };
  }

  async function check(origin: Origin): Promise<void> {
    if (disposed || state.k === 'unsupported' || checkInFlight) return;
    if (origin === 'auto' && !mayAutoCheck(state)) return;
    // 自动检查从「出错（带着版本）」进「正在检查」时版本就丢了，先记下来给分批推送比。
    const prior = state;
    dispatch({ type: 'check', auto: origin === 'auto' });
    if (!checkPending(state)) return;
    checkInFlight = true;
    let report: CheckReport | null = null;
    try {
      report = await runCheck(origin, prior);
    } catch (error) {
      // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
      deps.log(`检查更新失败（${origin}）：${errorText(error)}`);
    }
    checkInFlight = false;
    lastCheckAt = nowS();
    if (disposed) return;
    if (!checkPending(state)) {
      // 静默检查期间用户已经开了下载、点了重启等：结果作废，只记检查时间。
      emit();
      return;
    }
    const before = state;
    const info = report?.info ?? null;
    const changed = !report
      ? dispatch({ type: 'fail', failure: 'check' })
      : !info
        ? dispatch({ type: 'none', heldBack: report.heldBack })
        : dispatch({ type: 'found', info, systemUnmet: report.systemUnmet, cached: report.cached });
    if (!changed) emit();
    if (report && info) {
      const next = followup(origin, prefs?.autoDownload ?? false, report, state);
      if (next === 'verify' && report.cached) startDownload(origin, report.cached);
      else if (next === 'download') startDownload('auto');
      else if (next === 'toastAvailable') notify({ kind: 'available', info });
    }
    // 已下载的那一版被新 build 取代或被撤回：删掉它（与新一版的文件、解开目录都不同名，不碰刚开始的下载或校验）。
    const now = current();
    if (before.k === 'ready' && (now.k !== 'ready' || now.path !== before.path)) await discardDownload(before.path, before.info.build);
    // 已是最新：缓存里的包都用不上了（例如 Windows 退出时安装后留下的安装器：不带 `--updated` 重新打开，启动时不清）。
    else if (report && !info && !report.heldBack && now.k === 'upToDate' && deps.cacheDir) await prune(deps.cacheDir, '');
  }

  /**
   * 下载并校验：下载（`cached` 给了就跳过，状态已在校验段）→ 校验段（pct 100，平台的校验与就位）→ 已下载。
   * 校验段里取消：结束在跑的命令，丢掉下载好的包与解开的目录。
   */
  function startDownload(origin: Origin, cached: string | null = null): void {
    if (cached === null) dispatch({ type: 'download' });
    if (state.k !== 'downloading') return;
    const info = state.info;
    const mine = ++generation;
    const controller = new AbortController();
    active = { generation: mine, controller, origin };
    void (async () => {
      let last: { pct: number; at: number } | null = null;
      const result: DownloadResult =
        cached !== null
          ? { ok: true, path: cached }
          : deps.cacheDir
            ? await downloadTo(info, deps.cacheDir, {
                signal: controller.signal,
                openRemote: deps.openRemote,
                onProgress: (pct) => {
                  if (mine !== generation) return;
                  const at = deps.now();
                  if (!progressDue(last?.pct ?? null, pct, last ? at - last.at : Number.POSITIVE_INFINITY)) return;
                  last = { pct, at };
                  dispatch({ type: 'progress', pct });
                },
              })
            : { ok: false, cancelled: false, failure: 'download', detail: 'no cache directory' };
      // 取消过、或已经开了新一轮：晚到的结果不再碰状态。
      if (disposed || mine !== generation) return;
      if (!result.ok) {
        active = null;
        if (!result.cancelled) {
          // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
          deps.log(`下载更新失败（${result.failure}）：${result.detail}`);
          dispatch({ type: 'fail', failure: result.failure });
        }
        return;
      }
      dispatch({ type: 'progress', pct: 100 });
      const run = stagingLock.then(() => verifyAndStage(origin, info, result.path, mine, controller.signal));
      stagingLock = run.catch(() => undefined);
      await run;
    })();
  }

  /** 校验段（在 `stagingLock` 里跑）：就位了进已下载；失败丢掉安装包并报告；取消了收尾。 */
  async function verifyAndStage(origin: Origin, info: AppUpdateInfo, archive: string, mine: number, signal: AbortSignal): Promise<void> {
    let outcome: Prepared;
    try {
      outcome = signal.aborted ? { type: 'none' } : await deps.prepare(info, archive, signal);
    } catch (error) {
      outcome = { type: 'failed', failure: 'verify', detail: errorText(error) };
    }
    // 退出途中：不删，下次启动在缓存里找到它再校验一遍。
    if (disposed) return;
    if (mine !== generation) {
      // 校验段里取消了：丢掉解开的目录；又开了一轮下载时安装包由它覆盖，不删。
      if (outcome.type === 'staged') await fs.rm(outcome.staged.dir, { recursive: true, force: true }).catch(() => undefined);
      if (!active) await fs.rm(archive, { force: true }).catch(() => undefined);
      return;
    }
    active = null;
    if (outcome.type === 'failed') {
      // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
      deps.log(`校验更新失败（${outcome.failure}）：${outcome.detail}`);
      await fs.rm(archive, { force: true }).catch(() => undefined);
      dispatch({ type: 'fail', failure: outcome.failure });
      return;
    }
    prepared = { build: info.build, path: archive, staged: outcome.type === 'staged' ? outcome.staged : null };
    dispatch({ type: 'downloaded', path: archive });
    if (origin === 'auto') notifyReady(info);
  }

  function cancel(): void {
    if (state.k !== 'downloading') return;
    generation++;
    active?.controller.abort();
    active = null;
    dispatch({ type: 'cancel' });
  }

  async function install(): Promise<void> {
    if (disposed || state.k !== 'ready') return;
    const { info, path: archive } = state;
    const staged = preparedFor(info, archive)?.staged ?? null;
    dispatch({ type: 'install' });
    let outcome: InstallOutcome;
    try {
      // 就位过的新包已经校验过，只做便宜的核对；没就位的（Windows、不能自己换包的机器）重新核对安装包的摘要。
      if (staged || (await verifyFile(archive, info))) {
        outcome = await deps.installPackage(info, archive, { staged, relaunch: true });
      } else {
        outcome = { type: 'failed', failure: 'verify', detail: `${archive} no longer matches the manifest` };
      }
    } catch (error) {
      outcome = { type: 'failed', failure: 'install', detail: errorText(error) };
    }
    // 与下载时同一口径：校验不过的包删掉（出错文案写的是「已经删掉」）。
    if (outcome.type === 'failed' && outcome.failure === 'verify') await discardDownload(archive, info.build);
    // 安装期间状态可能被别处改过（TS 看不出 dispatch 改了它，所以经 `current()` 读）。
    if (disposed || current().k !== 'installing') return;
    if (outcome.type === 'launched') {
      // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
      deps.log('换包程序已起，应用退出');
      deps.quit();
    } else if (outcome.type === 'fallback') {
      deps.reveal(archive);
      deps.openDownloadPage();
      dispatch({ type: 'fail', failure: 'manual' });
    } else {
      // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
      deps.log(`安装更新失败（${outcome.failure}）：${outcome.detail}`);
      dispatch({ type: 'fail', failure: outcome.failure });
    }
  }

  async function installOnQuit(): Promise<void> {
    // 「重启并更新」退出时已经在安装中，这里不再装一次。
    if (disposed || quitInstallStarted || state.k !== 'ready') return;
    quitInstallStarted = true;
    const { info, path: archive } = state;
    const ready = preparedFor(info, archive);
    if (!ready) return;
    const attempt = (async () => {
      if (!(await deps.canAutoInstall())) return;
      // 没就位的（Windows 的安装器）只看文件还在、大小对得上：退出途中不重算摘要。
      if (!ready.staged && !(await sizeMatches(archive, info.size))) {
        // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
        deps.log(`退出时没有安装更新：${archive} 不在了或大小不对`);
        return;
      }
      const outcome = await deps.installPackage(info, archive, { staged: ready.staged, relaunch: false });
      if (outcome.type === 'launched') {
        dispatch({ type: 'install' });
        // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
        deps.log(`退出时安装 ${info.version}（build ${info.build}），装完不重新打开`);
      } else {
        // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
        deps.log(`退出时没有安装更新：${outcome.type === 'failed' ? `${outcome.failure} ${outcome.detail}` : '这台机器不能自己换包'}`);
      }
    // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
    })().catch((error: unknown) => deps.log(`退出时安装更新出错：${errorText(error)}`));
    await new Promise<void>((resolve) => {
      const stop = deps.schedule(() => {
        // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
        deps.log(`退出时安装更新超过 ${QUIT_INSTALL_DEADLINE_MS} ms，照常退出`);
        resolve();
      }, QUIT_INSTALL_DEADLINE_MS);
      void attempt.then(() => {
        stop();
        resolve();
      });
    });
  }

  /** 一拍：偏好没到或自动检查关着时不用掉第一拍，等打开时补。 */
  function autoTick(): void {
    if (disposed || !prefs?.autoCheck) return;
    const first = !firstTickUsed;
    firstTickUsed = true;
    if (shouldAutoCheck(first, lastCheckAt, nowS())) void check('auto');
  }

  function tick(): void {
    stopTimer = deps.schedule(tick, TICK_S * 1000);
    autoTick();
  }

  return {
    snapshot,
    start() {
      if (state.k === 'unsupported' || stopTimer || disposed) return;
      stopTimer = deps.schedule(() => {
        firstTickDue = true;
        tick();
      }, FIRST_CHECK_DELAY_S * 1000);
    },
    dispose() {
      disposed = true;
      stopTimer?.();
      stopTimer = null;
      active?.controller.abort();
      active = null;
      stateListeners.clear();
      noticeListeners.clear();
    },
    configure(next) {
      const wasOn = prefs?.autoCheck === true;
      prefs = { autoCheck: next.autoCheck, autoDownload: next.autoDownload };
      if (firstTickDue && next.autoCheck && !wasOn) autoTick();
    },
    check,
    download() {
      if (disposed) return;
      if ((state.k === 'available' && !state.systemUnmet) || (state.k === 'error' && state.info)) startDownload('manual');
    },
    cancel,
    install,
    installOnQuit,
    openDownloadPage: () => deps.openDownloadPage(),
    onState(listener) {
      stateListeners.add(listener);
      return () => void stateListeners.delete(listener);
    },
    onNotice(listener) {
      noticeListeners.add(listener);
      return () => void noticeListeners.delete(listener);
    },
  };
}

/** 文件还在、大小与清单一致（退出即安装时的便宜核对）。 */
async function sizeMatches(file: string, size: number): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  return !!stat?.isFile() && stat.size === size;
}
