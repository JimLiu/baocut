import path from 'node:path';
import type { AppUpdateFailure, AppUpdateFormat, AppUpdateInfo, AppUpdateState } from '@baocut/ui';

/*
 * 应用自动更新的判据（架构设计 §2.6，设计稿 §17.7 与 model-app-update.js）：schema-1 清单的解析、何时启用、
 * 自动检查的节奏、分批推送、状态机、检查之后接着做什么、进度节流，以及 macOS 换包脚本与几段命令输出的解析。
 * 全是纯函数；拉清单、下载、校验与换包在 app-update-service.ts / app-update-install.ts，接线在 app-update-ipc.ts。
 * 口径从 BaoCut 的 Rust 实现（apps/baocut/src/host/app_update.rs）移植；状态机照设计稿的 `reduce`。
 */

/** 覆盖更新源的环境变量：`https://…`、`file:///…` 或绝对路径（演练与测试用；开发构建设了它也启用更新）。 */
export const APPCAST_ENV = 'BAOCUT_UPDATE_APPCAST';
/** 正式包的 bundle 标识。新包的 `CFBundleIdentifier` 必须恰为它；Windows 安装包的 appId 也是它（打包脚本从这里取）。 */
export const BUNDLE_ID = 'com.baocut.app';
/** 产品名：Windows 上可执行文件与 NSIS 卸载程序的文件名都由它得出（打包脚本从这里取）。 */
export const PRODUCT_NAME = 'BaoCut';
/** electron-builder 的 NSIS 安装器放在 exe 旁边的卸载程序（模板 common.nsh 的 `UNINSTALL_FILENAME`）。有它才是安装版。 */
export const NSIS_UNINSTALLER = `Uninstall ${PRODUCT_NAME}.exe`;
/** 标准版的变体名（打包脚本的 `--variant cpu`）；它的更新源文件名不带后缀。 */
export const STANDARD_VARIANT = 'cpu';
/** 下载页：自动安装走不通时打开它。 */
export const DOWNLOAD_PAGE = 'https://github.com/jimliu/baocut/releases';
/** 启动后多久做第一次自动检查（秒）。 */
export const FIRST_CHECK_DELAY_S = 15;
/** 两次自动检查的间隔（秒）。 */
export const CHECK_INTERVAL_S = 6 * 3600;
/** 节拍器的周期（秒）：每一拍看是否到期。拍子比间隔短，睡眠唤醒或刚打开自动检查时不必再等满 6 小时。 */
export const TICK_S = 30 * 60;
/** 退出即安装最多等多久（毫秒）：只剩写换包脚本、记下安装器这类便宜的事，超时就照常退出，不让退出卡住。 */
export const QUIT_INSTALL_DEADLINE_MS = 5000;

// ---- 更新源 ----

export type FeedTarget = 'aarch64-apple-darwin' | 'x86_64-pc-windows-msvc';

/** 本构建读哪一份更新源；没有发布物的平台返回 null（等同开发构建）。 */
export function feedTarget(platform: string, arch: string): FeedTarget | null {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  return null;
}

/**
 * 更新源的文件名：`appcast-<target>.json`；Windows 的 CUDA、Vulkan 版各有一份（`appcast-<target>-<变体>.json`），
 * 三个安装包共用一个 appId，读错了就会把别的变体装上来。变体名不合规时按标准版。
 */
export function feedFileName(target: FeedTarget, variant: string | null): string {
  const suffix = variant && variant !== STANDARD_VARIANT && /^[a-z0-9]+$/.test(variant) ? `-${variant}` : '';
  return `appcast-${target}${suffix}.json`;
}

export function feedUrl(target: FeedTarget, variant: string | null = null): string {
  return `https://raw.githubusercontent.com/jimliu/baocut/main/apps/desktop/releases/${feedFileName(target, variant)}`;
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** 本地文件：`file://…`、绝对路径或 Windows 的盘符路径。只有更新源被环境变量覆盖时，清单里的安装包地址才允许是它。 */
export function isFileUrl(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('/') || WINDOWS_DRIVE_PATH.test(url);
}

/** `file:///a/b`、`/a/b`、`file:///C:/a`、`C:\a` → 本地路径（`file://` 的百分号解码）；别的返回 null。 */
export function fileUrlPath(url: string): string | null {
  if (url.startsWith('file://')) {
    const decoded = percentDecode(url.slice('file://'.length));
    // `file:///C:/a` 去掉盘符前的 `/`。
    return /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded;
  }
  return url.startsWith('/') || WINDOWS_DRIVE_PATH.test(url) ? url : null;
}

/** 按字节解百分号转义；不成形的 `%` 原样保留。 */
function percentDecode(text: string): string {
  const src = new TextEncoder().encode(text);
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const byte = src[i]!;
    if (byte === 0x25 && i + 2 < src.length) {
      const hex = String.fromCharCode(src[i + 1]!, src[i + 2]!);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(out));
}

/** 这个 target 认哪些安装包形态：macOS 认 ZIP（主路径）与 DMG（兼容），Windows 只认安装器。 */
export function acceptedFormats(target: string): AppUpdateFormat[] {
  if (target.endsWith('-apple-darwin')) return ['zip', 'dmg'];
  if (target.includes('-windows-')) return ['exe'];
  return [];
}

// ---- 清单 ----

export type ManifestError = 'decode' | 'schema' | 'release' | 'artifact' | 'target';

/** 分批推送：从 `releasedAt`（unix 毫秒）起 `hours` 小时内，放开的比例从 0 线性涨到 1。 */
export interface Rollout {
  hours: number;
  releasedAt: number;
}

export type ManifestResult =
  { ok: true; info: AppUpdateInfo; rollout: Rollout | null } | { ok: false; error: ManifestError; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown): value is string | undefined | null => value == null || typeof value === 'string';

/**
 * 解析 schema-1 清单。`target` 是本构建的 target，决定认哪些 `format`；清单自己写了 `target` 时必须一致，
 * 写了 `variant` 时必须是本构建的变体（`variant` 为 null 按标准版；没写的清单不比，旧版的清单照读）。
 * 缺 `format` 按 v1 读成 `dmg`。`sha256` 必须是 64 位十六进制（转小写），安装包地址必须是 https（`allowFileUrl` 时
 * 也可以是本地文件），大小与 build 必须大于 0。未知键一律忽略。
 *
 * 可选的 `rolloutHours`（大于 0 的有限数）与 `releasedAt`（带时区的 ISO 8601 时刻）合起来是分批推送；两者缺一或不成形时
 * 当作不分批，清单照读。这与别的可选字段不同（类型不对就拒绝整份清单）：分批字段写错了宁可全量推，也不让所有人收不到更新。
 */
export function parseManifest(text: string, target: string, allowFileUrl: boolean, variant: string | null = null): ManifestResult {
  const fail = (error: ManifestError, detail: string): ManifestResult => ({ ok: false, error, detail });
  let wire: unknown;
  try {
    wire = JSON.parse(text);
  } catch (error) {
    return fail('decode', String(error));
  }
  if (!isRecord(wire)) return fail('decode', 'manifest is not an object');
  const {
    schema,
    target: declaredTarget,
    variant: declaredVariant,
    version,
    build,
    date,
    minimumSystemVersion,
    notes,
    notesLocalized,
    app,
    rolloutHours,
    releasedAt,
  } = wire;
  if (typeof schema !== 'number' || typeof version !== 'string' || typeof build !== 'number' || !Number.isInteger(build)) {
    return fail('decode', 'schema, version or build has the wrong type');
  }
  if (
    !optionalString(declaredTarget) ||
    !optionalString(declaredVariant) ||
    !optionalString(date) ||
    !optionalString(minimumSystemVersion) ||
    !optionalString(notes)
  ) {
    return fail('decode', 'a text field has the wrong type');
  }
  if (notesLocalized != null && (!isRecord(notesLocalized) || Object.values(notesLocalized).some((v) => typeof v !== 'string'))) {
    return fail('decode', 'notesLocalized has the wrong type');
  }
  if (schema !== 1) return fail('schema', `unsupported manifest schema ${schema}`);
  const declared = declaredTarget?.trim();
  if (declared && declared !== target) return fail('target', `manifest is for ${declared}`);
  const declaredFlavor = declaredVariant?.trim();
  if (declaredFlavor && declaredFlavor !== (variant ?? STANDARD_VARIANT))
    return fail('target', `manifest is for the ${declaredFlavor} variant`);
  if (!version.trim() || build <= 0) return fail('release', 'manifest version or build is invalid');
  if (!isRecord(app)) return fail('artifact', 'manifest has no app');
  const { url, size, sha256, format: rawFormat } = app;
  if (typeof url !== 'string' || typeof size !== 'number' || typeof sha256 !== 'string' || !optionalString(rawFormat)) {
    return fail('artifact', 'app fields have the wrong type');
  }
  const format = rawFormat == null ? 'dmg' : rawFormat.trim().toLowerCase();
  if (!(acceptedFormats(target) as string[]).includes(format)) return fail('artifact', `format ${format} is not for ${target}`);
  const schemeOk = url.toLowerCase().startsWith('https://') || (allowFileUrl && isFileUrl(url));
  if (!Number.isInteger(size) || size <= 0 || !/^[0-9a-fA-F]{64}$/.test(sha256) || !schemeOk) {
    return fail('artifact', 'manifest artifact is invalid');
  }
  return {
    ok: true,
    info: {
      version: version.trim(),
      build,
      date: date ?? '',
      minimumSystemVersion: minimumSystemVersion?.trim() ? minimumSystemVersion : null,
      notes: notes ?? '',
      notesLocalized: { ...((notesLocalized as Record<string, string> | null | undefined) ?? {}) },
      format: format as AppUpdateFormat,
      url,
      size,
      sha256: sha256.toLowerCase(),
    },
    rollout: parseRollout(rolloutHours, releasedAt),
  };
}

/** 带时区（`Z` 或 `±hh:mm`）的 ISO 8601 时刻；只有日期、不带时区的不认（各地读出来不一样）。 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

function parseRollout(hours: unknown, releasedAt: unknown): Rollout | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null;
  if (typeof releasedAt !== 'string' || !ISO_INSTANT.test(releasedAt.trim())) return null;
  const at = Date.parse(releasedAt.trim());
  return Number.isFinite(at) ? { hours, releasedAt: at } : null;
}

/** 发布一版要写进更新源的事实（打包脚本按产物算出来）。 */
export interface ReleaseFacts {
  target: FeedTarget;
  /** 变体；标准版写 `STANDARD_VARIANT`。 */
  variant: string;
  version: string;
  build: number;
  /** `YYYY-MM-DD`。 */
  date: string;
  format: AppUpdateFormat;
  /** 安装包的 https 地址。 */
  url: string;
  size: number;
  sha256: string;
  /** 分批推送的时长（小时）；不给不分批。 */
  rolloutHours?: number;
  /** 分批的起点：带时区的 ISO 8601 时刻（给了 `rolloutHours` 才有意义）。 */
  releasedAt?: string;
}

/**
 * 一份 schema-1 清单（`parseManifest` 读的就是它）：Windows 的打包脚本拿安装器的大小与摘要生成
 * `appcast-<target>[-<变体>].json`。说明（`notes`）留空，发布时再填。分批的两个键只在给了时写。
 */
export function releaseManifest(facts: ReleaseFacts): Record<string, unknown> {
  return {
    schema: 1,
    target: facts.target,
    variant: facts.variant,
    version: facts.version,
    build: facts.build,
    date: facts.date,
    notes: '',
    notesLocalized: {},
    app: { format: facts.format, url: facts.url, size: facts.size, sha256: facts.sha256.toLowerCase() },
    ...(facts.rolloutHours !== undefined ? { rolloutHours: facts.rolloutHours } : {}),
    ...(facts.releasedAt !== undefined ? { releasedAt: facts.releasedAt } : {}),
  };
}

/**
 * 下载到缓存目录时的文件名：取地址的最后一段；含路径分隔符、以点开头、带控制字符或为空的一律改用
 * `BaoCut-<build>.<ext>`，不让清单决定写到哪个目录。
 */
export function fileName(info: Pick<AppUpdateInfo, 'url' | 'build' | 'format'>): string {
  const last = percentDecode((info.url.split(/[?#]/)[0] ?? '').split('/').pop() ?? '');
  const safe = last !== '' && !last.startsWith('.') && !/[/\\:]/.test(last) && !/[\u0000-\u001f\u007f-\u009f]/.test(last);
  return safe ? last : `BaoCut-${info.build}.${info.format}`;
}

/** 点分版本号比较（`14.0` < `14.2.1`，缺的段当 0，读不懂的段当 0）：小于、等于、大于分别返回 -1、0、1。 */
export function compareVersions(left: string, right: string): number {
  const parts = (text: string) =>
    text
      .trim()
      .split('.')
      .map((part) => (/^\d+$/.test(part.trim()) ? Number(part.trim()) : 0));
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 新版本要求的系统比这台机器高：只在 macOS 上比（Windows 的最低版本是内核号，交给安装器自己拦）。
 * 清单没写、或读不到本机版本时不拦。返回要求的版本，界面写「需要 macOS X」。
 */
export function systemRequirementUnmet(info: Pick<AppUpdateInfo, 'minimumSystemVersion'>, currentSystem: string | null, macos: boolean): string | null {
  if (!macos) return null;
  const required = info.minimumSystemVersion;
  if (!required || !currentSystem?.trim()) return null;
  return compareVersions(currentSystem, required) < 0 ? required : null;
}

/** 清单比本机新才算有更新：只比 build。 */
export function isNewer(info: Pick<AppUpdateInfo, 'build'>, currentBuild: number): boolean {
  return info.build > currentBuild;
}

// ---- 何时启用 ----

export interface UpdateEnvironment {
  /** Mac App Store 渠道（BaoCut 只经官网分发，现在总是 false；留着与设计稿的「App Store 版本」文案对应）。 */
  appStore: boolean;
  /** 本构建的 build 号（打包时写入应用的 package.json；没写是 0）。 */
  build: number;
  /** 设了 `BAOCUT_UPDATE_APPCAST`：开发构建也启用。 */
  feedOverride: boolean;
  /** 本构建有发布物（`feedTarget` 非空）。 */
  hasFeedTarget: boolean;
  /** 打包过的正式构建（Electron 的 `app.isPackaged`）。 */
  packaged: boolean;
  windows: boolean;
  /** macOS 上运行中的包的 `CFBundleIdentifier`；读不到时 null。 */
  bundleId: string | null;
  /** 可执行文件在 `<X>.app/Contents/MacOS/` 里。 */
  exeInAppBundle: boolean;
}

/**
 * 为什么不检查更新；启用时返回 null。没写 build 号的包（CI 的试验包）不是发布版：任何一版都比它新，
 * 装上之后还是 0，会一直更新下去，所以与开发构建一样不检查（设了更新源覆盖时照常检查，演练用）。
 */
export function availability(env: UpdateEnvironment): 'dev' | 'appStore' | null {
  if (env.appStore) return 'appStore';
  if (env.feedOverride) return null;
  if (!env.hasFeedTarget || !env.packaged || env.build <= 0) return 'dev';
  if (env.windows) return null;
  return env.bundleId === BUNDLE_ID && env.exeInAppBundle ? null : 'dev';
}

/** 可执行文件的路径是不是 `<X>.app/Contents/MacOS/<exe>`。 */
export function exeInAppBundle(executable: string): boolean {
  const macos = path.dirname(executable);
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  return path.basename(macos) === 'MacOS' && path.basename(contents) === 'Contents' && path.extname(bundle).toLowerCase() === '.app';
}

/** 可执行文件所在的 `.app`（最近的一层）；不在包里时 null。 */
export function appBundleFromExecutable(executable: string): string | null {
  let current = executable;
  for (;;) {
    if (path.extname(current).toLowerCase() === '.app') return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 更新缓存目录：macOS `~/Library/Caches/BaoCut/Updates`，Windows `%LOCALAPPDATA%\BaoCut\Updates`，其余 `~/.cache/BaoCut/Updates`。 */
export function cacheDirectory(platform: string, home: string, env: Readonly<Record<string, string | undefined>>): string | null {
  if (!home) return null;
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'BaoCut', 'Updates');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'BaoCut', 'Updates');
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'BaoCut', 'Updates');
}

// ---- 节奏 ----

/**
 * 这一拍要不要自动检查（时刻都是 unix 秒）：启动后的第一拍总是查，之后从没检查过或距上次满 6 小时才查。
 * 时钟回拨（上次检查在未来）当作到期，免得一次回拨让自动检查停摆。
 */
export function shouldAutoCheck(firstTick: boolean, lastCheck: number | null, now: number): boolean {
  if (firstTick || lastCheck === null || lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_S;
}

// ---- 分批推送 ----

/**
 * 现在放开了多少（0–1）：不分批时 1；`releasedAt` 之前 0；之后按经过的时间线性涨到 1。
 */
export function rolloutFraction(rollout: Rollout | null, nowMs: number): number {
  if (!rollout) return 1;
  const elapsed = nowMs - rollout.releasedAt;
  if (elapsed <= 0) return 0;
  return Math.min(1, elapsed / (rollout.hours * 3600 * 1000));
}

/** 本机的位置 `bucket`（[0, 1)，每台安装固定）落在已放开的部分里才推。 */
export function rolloutAdmits(fraction: number, bucket: number): boolean {
  return bucket < fraction;
}

/** 本机的安装标识：随机 UUID，存在用户数据目录里。 */
export function isInstallationId(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

/** 安装标识 → 位置：开头 8 位十六进制（UUID v4 的这 32 位全是随机的）除以 2^32，落在 [0, 1)。 */
export function bucketFromId(id: string): number {
  return parseInt(id.slice(0, 8), 16) / 2 ** 32;
}

// ---- 状态机（设计稿 model-app-update.js `reduce`） ----

export type UpdateEvent =
  | { type: 'check'; auto?: boolean }
  /** 检查发现了新版本。`systemUnmet`：本机系统不够；`cached`：同一 build 已下载且重新核对过摘要的文件（还要校验、就位）。 */
  | { type: 'found'; info: AppUpdateInfo; systemUnmet?: string | null; cached?: string | null }
  /** 更新源里没有比本机新的。`heldBack`：有，但分批推送这次没轮到本机。 */
  | { type: 'none'; heldBack?: boolean }
  | { type: 'fail'; failure: AppUpdateFailure }
  | { type: 'download' }
  | { type: 'progress'; pct: number }
  | { type: 'downloaded'; path: string }
  | { type: 'cancel' }
  | { type: 'install' };

const BUSY = new Set<AppUpdateState['k']>(['checking', 'downloading', 'installing']);

/** 状态带的那一版信息。 */
export function stateInfo(st: AppUpdateState): AppUpdateInfo | null {
  return 'info' in st ? st.info : null;
}

/** 静默检查的起点：有新版本、已下载。显示态不变，只挂 `bg`。 */
function quietStart(st: AppUpdateState): st is Extract<AppUpdateState, { k: 'available' | 'ready' }> {
  return st.k === 'available' || st.k === 'ready';
}

/** 在途的静默检查：自动检查发起时已有新版本或已下载，显示态不变，只挂上 `bg`。 */
function quietInFlight(st: AppUpdateState): st is Extract<AppUpdateState, { k: 'available' | 'ready' }> {
  return quietStart(st) && st.bg === true;
}

/** 去掉静默检查的在途标记。 */
function settle(st: Extract<AppUpdateState, { k: 'available' | 'ready' }>): AppUpdateState {
  const { bg: _bg, ...settled } = st;
  return settled;
}

/** 节拍器这一拍能不能发起自动检查：不检查更新、正在查 / 下 / 装、已有静默检查在途时都不查。 */
export function mayAutoCheck(st: AppUpdateState): boolean {
  return st.k !== 'unsupported' && !BUSY.has(st.k) && !quietInFlight(st);
}

/**
 * 有一次检查在等结果：手动检查的 `checking`，或静默检查挂着 `bg` 的「有新版本」「已下载」。别的态下（用户在这期间开了
 * 下载、点了重启等）晚到的检查结果作废，免得一次检查失败把在飞的下载冲成出错态。
 */
export function checkPending(st: AppUpdateState): boolean {
  return st.k === 'checking' || quietInFlight(st);
}

/**
 * 状态转移。自动检查在「有新版本」「已下载」时是静默的（挂 `bg`，显示态不变）；静默检查失败保持原态，一次网络抖动
 * 不冲掉已找到 / 已下载的更新。手动检查照旧进 `checking`。
 *
 * 「已下载」时的静默检查（2026-10-05）：同一个 build → 留在已下载；更新的 build 但本机系统不够 → 留在已下载（手里这版
 * 已校验、能装，也比正在跑的新）；别的 build（更新的，或比已下载的旧、但仍比正在跑的新，即已下载的那版被撤了）→ 旧下载
 * 作废，换成「有新版本」；没有比正在跑的新的 → 已是最新，不装已撤回的版本（服务随后删掉已下载的包）。
 *
 * 分批推送这次没轮到本机（`none` 带 `heldBack`）时，静默检查的起点（手里已有比正在跑的新的一版）保持原态，只去掉 `bg`；
 * 别的起点照常到已是最新。
 *
 * 比设计稿多一处：`found` 带着缓存里完好的同一 build 时直接进下载到 100% 之后的校验段，校验、就位完了才到已下载。
 */
export function reduce(st: AppUpdateState, ev: UpdateEvent): AppUpdateState {
  if (st.k === 'unsupported') return st;
  switch (ev.type) {
    case 'check':
      if (ev.auto) {
        if (!mayAutoCheck(st)) return st;
        if (quietStart(st)) return { ...st, bg: true };
      }
      return BUSY.has(st.k) ? st : { k: 'checking' };
    case 'found':
      if (!checkPending(st)) return st;
      if (st.k === 'ready') {
        const same = ev.info.build === st.info.build;
        if (same || (ev.systemUnmet && ev.info.build > st.info.build)) return settle(st);
      }
      if (ev.systemUnmet) return { k: 'available', info: ev.info, systemUnmet: ev.systemUnmet };
      if (ev.cached) return { k: 'downloading', info: ev.info, pct: 100 };
      return { k: 'available', info: ev.info };
    case 'none':
      if (ev.heldBack && quietInFlight(st)) return settle(st);
      return checkPending(st) ? { k: 'upToDate' } : st;
    case 'fail':
      if (quietInFlight(st)) return settle(st);
      return { k: 'error', failure: ev.failure, info: stateInfo(st) };
    case 'download':
      if (st.k === 'available' && !st.systemUnmet) return { k: 'downloading', info: st.info, pct: 0 };
      if (st.k === 'error' && st.info) return { k: 'downloading', info: st.info, pct: 0 };
      return st;
    case 'progress': {
      if (st.k !== 'downloading') return st;
      const pct = Math.max(0, Math.min(100, Math.round(ev.pct)));
      return pct === st.pct ? st : { ...st, pct };
    }
    case 'downloaded':
      return st.k === 'downloading' ? { k: 'ready', info: st.info, path: ev.path } : st;
    case 'cancel':
      return st.k === 'downloading' ? { k: 'available', info: st.info } : st;
    case 'install':
      return st.k === 'ready' ? { k: 'installing', info: st.info } : st;
  }
}

/** 下载到 100% 之后、进「已下载」之前的校验段（界面写「正在校验」）。 */
export function verifying(st: AppUpdateState): boolean {
  return st.k === 'downloading' && st.pct >= 100;
}

// ---- 检查之后 ----

export type Origin = 'auto' | 'manual';

export interface CheckReport {
  /** 比本机新的那一版；null 是没有（或这次没轮到本机，见 `heldBack`）。 */
  info: AppUpdateInfo | null;
  /** 更新源里有比本机新的，但分批推送这次没轮到本机（只在自动检查时）。 */
  heldBack: boolean;
  /** 同一 build 已下载且重新核对过摘要的文件。 */
  cached: string | null;
  /** 这台机器能不能不经用户手动地换包。 */
  canAutoInstall: boolean;
  /** 新版本要求、本机达不到的 macOS 版本：停在「有新版本」，不下载、不提醒。 */
  systemUnmet: string | null;
}

export type Followup = 'none' | 'verify' | 'download' | 'toastAvailable';

/**
 * 检查结果落地（`next` 是落地后的状态）之后接着做什么（设计稿 `afterCheck`）：缓存里已有这一版、进了校验段时校验它
 * （自动检查的校验完提醒「已下载」）；自动检查落到能下载的「有新版本」时，自动下载开着且能自动换包就在后台下载，否则
 * 提醒「可以更新了」。留在已下载、系统版本不够、手动检查都不跟进。
 */
export function followup(origin: Origin, autoDownload: boolean, report: CheckReport, next: AppUpdateState): Followup {
  if (report.cached && verifying(next)) return 'verify';
  if (origin === 'manual' || next.k !== 'available' || next.systemUnmet) return 'none';
  return autoDownload && report.canAutoInstall ? 'download' : 'toastAvailable';
}

/** 下载进度要不要推：百分比变了且距上次 ≥ 250 ms，或者到了 100。 */
export function progressDue(lastPct: number | null, pct: number, sinceLastMs: number): boolean {
  if (lastPct === null) return true;
  if (pct === lastPct) return false;
  if (pct >= 100) return true;
  return sinceLastMs >= 250;
}

/** 已收字节 → 百分比（0–100，向下取整）。 */
export function percent(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((Math.min(received, total) * 100) / total);
}

// ---- 命令输出与换包脚本（macOS） ----

/** `codesign -dv --verbose=2` 的输出（在 stderr）→ Team ID。`not set`（ad-hoc 签名）与空值都算没有。 */
export function teamIdentifier(codesignStderr: string): string | null {
  for (const line of codesignStderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TeamIdentifier=')) continue;
    const value = trimmed.slice('TeamIdentifier='.length).trim();
    return value && value.toLowerCase() !== 'not set' ? value : null;
  }
  return null;
}

/** `hdiutil attach` 的输出 → 挂载点：最后一个以 `/Volumes/` 开头的 tab 分隔列（挂载点可以带空格）。 */
export function mountPath(output: string): string | null {
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    const column = (line.split('\t').pop() ?? '').trim();
    if (column.startsWith('/Volumes/')) return column;
  }
  return null;
}

/** 单引号转义：`'` → `'\''`，整体包一层单引号。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export interface InstallerPlan {
  pid: number;
  /** 校验过的新 `.app`（ZIP 解出来的目录里，或 DMG 挂载点里）。 */
  newApp: string;
  /** 正在运行的 `.app`（要被替换的那个）。 */
  target: string;
  /** DMG 的挂载点；ZIP 没有。 */
  mount: string | null;
  /** 下载下来的安装包，换完删掉。 */
  archive: string;
  /** ZIP 解出来的临时目录，换完删掉。 */
  unpacked: string | null;
  /** 脚本自己，跑完删掉。 */
  script: string;
  /** 换完（或回滚后）要不要打开应用：「重启并更新」开，退出即安装不开（用户是要退出）。 */
  relaunch: boolean;
}

/**
 * 换包脚本：等应用退出 → ditto 到 `.<name>.incoming` → 去掉隔离属性 → 旧包挪到 `.<name>.previous` → 新包就位
 * （失败回滚）→ 打开新应用。`relaunch` 为假（退出即安装）时成功、回滚都不打开。拒绝目标不是 `.app`、父目录是 `/`、
 * 不是绝对路径的。所有路径单引号转义。
 */
export function installerScript(plan: InstallerPlan): { ok: true; script: string } | { ok: false; error: string } {
  const target = plan.target;
  const parent = path.dirname(target);
  const name = path.basename(target);
  if (!name || !name.toLowerCase().endsWith('.app') || parent === '/' || !parent || parent === target || !path.isAbsolute(target)) {
    return { ok: false, error: `unsafe replacement target: ${target}` };
  }
  const staging = path.join(parent, `.${name}.incoming`);
  const backup = path.join(parent, `.${name}.previous`);
  const detach = plan.mount !== null ? '/usr/bin/hdiutil detach "$MOUNT" -quiet 2>/dev/null\n' : '';
  const cleanup = plan.unpacked !== null ? '/bin/rm -rf "$UNPACKED" 2>/dev/null\n' : '';
  const reopen = plan.relaunch ? '/usr/bin/open "$TARGET"; ' : '';
  let vars =
    `PID=${Math.trunc(plan.pid)}\nNEW_APP=${shellQuote(plan.newApp)}\nTARGET=${shellQuote(target)}\nSTAGING=${shellQuote(staging)}\n` +
    `BACKUP=${shellQuote(backup)}\nARCHIVE=${shellQuote(plan.archive)}\nSELF=${shellQuote(plan.script)}\n`;
  if (plan.mount !== null) vars += `MOUNT=${shellQuote(plan.mount)}\n`;
  if (plan.unpacked !== null) vars += `UNPACKED=${shellQuote(plan.unpacked)}\n`;
  const script = `#!/bin/bash
set +e
${vars}for _ in $(seq 1 200); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
sleep 0.4
/bin/rm -rf "$STAGING"
if ! /usr/bin/ditto "$NEW_APP" "$STAGING"; then
  /bin/rm -rf "$STAGING"
  ${detach}${cleanup}  ${reopen}exit 1
fi
/usr/bin/xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null
/bin/rm -rf "$BACKUP"
if ! /bin/mv "$TARGET" "$BACKUP"; then
  /bin/rm -rf "$STAGING"
  ${detach}${cleanup}  ${reopen}exit 1
fi
if /bin/mv "$STAGING" "$TARGET"; then
  /bin/rm -rf "$BACKUP"
else
  /bin/mv "$BACKUP" "$TARGET"
  ${detach}${cleanup}  ${reopen}exit 1
fi
${detach}${cleanup}/bin/rm -f "$ARCHIVE" 2>/dev/null
${plan.relaunch ? '/usr/bin/open "$TARGET"\n' : ''}/bin/rm -f "$SELF" 2>/dev/null
`;
  return { ok: true, script };
}
