import type { Id } from './domain.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 按需下载的字体（架构设计 §9.1）：随应用发布一份 Google Fonts 的字体目录（只有元数据），排字点了名、随内核与本机都没有
 * 的族，按目录里这个族实际有的字重下载到 Runtime Home 的字体缓存，预览与成片导出用同一个文件。
 *
 * 规则：
 * - 解析顺序：随内核发布的字体 → 本机已装的字体 → 下载缓存 → 下载。本机有这个族时不下载（同族只认本机的）。
 * - 请求只带族名、字重与斜体（公开的 CSS 接口，不要 API key，不发别的信息）；文件只从配置的文件主机（https）取。
 * - 下载的文件按字体解析核对（族名对得上、大小在上限内）之后才放进缓存；缓存按「族、face、内容摘要」命名，写入是
 *   先写临时文件再改名。缓存的索引记族、字重、斜体、许可、摘要、大小与下载时间，不记下载地址。
 * - 下载是任务（`kind: 'fontDownload'`，进度经 `jobs` 主题，`jobs.cancel` 取消）；同一个 face 同时只下载一次。
 */

/** 字体的许可：SIL Open Font License 1.1、Apache License 2.0、Ubuntu Font Licence 1.0。 */
export type FontLicence = 'OFL-1.1' | 'Apache-2.0' | 'UFL-1.0';

/** 字体目录的分类。 */
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

export const FONT_CATEGORIES: readonly FontCategory[] = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'];

/**
 * 选字时按文字筛：每一类对应目录里的哪些字符子集（`subsets`）。不在这里的子集归 `other`。
 */
export const FONT_SCRIPT_SUBSETS = {
  chinese: ['chinese-simplified', 'chinese-traditional', 'chinese-hongkong'],
  japanese: ['japanese'],
  korean: ['korean'],
  latin: ['latin', 'latin-ext'],
  cyrillic: ['cyrillic', 'cyrillic-ext'],
  greek: ['greek', 'greek-ext'],
  vietnamese: ['vietnamese'],
  arabic: ['arabic'],
  hebrew: ['hebrew'],
  thai: ['thai'],
  devanagari: ['devanagari'],
} as const satisfies Record<string, readonly string[]>;

export type FontScript = keyof typeof FONT_SCRIPT_SUBSETS | 'other';

export const FONT_SCRIPTS: readonly FontScript[] = [...(Object.keys(FONT_SCRIPT_SUBSETS) as FontScript[]), 'other'];

/** 一组字符子集属于哪几类文字（按 `FONT_SCRIPTS` 的次序）。 */
export function fontScriptsOf(subsets: readonly string[]): FontScript[] {
  const scripts = new Set<FontScript>();
  for (const subset of subsets) {
    const found = (Object.entries(FONT_SCRIPT_SUBSETS) as [FontScript, readonly string[]][]).find(([, list]) => list.includes(subset));
    scripts.add(found ? found[0] : 'other');
  }
  return FONT_SCRIPTS.filter((script) => scripts.has(script));
}

/**
 * 一个族此刻的状态：
 * - `built-in`：随渲染内核发布（不下载，下载了也不会用）；
 * - `installed`：本机已装（同族只认本机的，不下载）；
 * - `downloaded`：下载缓存里有它的 face（`downloaded` 列出哪些）；
 * - `downloadable`：在字体目录里、还没下载过；
 * - `downloading`：有下载任务在跑（`job`）；
 * - `failed`：最近一次下载失败（`error`），可以再下载；
 * - `unavailable`：哪里都没有（只在按名字查的时候出现）。
 */
export type FontFamilyState = 'built-in' | 'installed' | 'downloaded' | 'downloadable' | 'downloading' | 'failed' | 'unavailable';

/** 一个字重与是否斜体。 */
export interface FontFaceStyle {
  weight: number;
  italic: boolean;
}

/** 下载缓存里的一个 face（`fonts.downloaded`）。不记下载地址。 */
export interface DownloadedFontFace extends FontFaceStyle {
  family: string;
  licence: FontLicence;
  /** 文件内容的 sha256（十六进制）。 */
  sha256: string;
  sizeBytes: number;
  downloadedAt: string;
}

/** 下载失败的错误码（任务的 `error.code`，也是 `failed` 状态里的 `error.code`）。 */
export type FontDownloadErrorCode =
  /** 连不上、断开、超时（离线时也是它）。 */
  | 'FONT_DOWNLOAD_NETWORK'
  /** 字体服务返回了不成功的 HTTP 状态（`details.status`）或回应里没有这个 face 的文件。 */
  | 'FONT_DOWNLOAD_SOURCE'
  /** 下载的不是能用的字体、族名对不上或超过大小上限：坏的文件已删除。 */
  | 'FONT_DOWNLOAD_INTEGRITY'
  /** 写缓存时磁盘满了。 */
  | 'FONT_DOWNLOAD_NO_SPACE';

/** `fonts.catalogue` 的一项：目录里的族、随内核的族与本机的族合在一起。 */
export interface FontFamilyStatus {
  family: string;
  state: FontFamilyState;
  /** 字体目录里的分类；不在目录里的为 null。 */
  category: FontCategory | null;
  /** 字符子集（目录里的；不在目录里的为空）。 */
  subsets: string[];
  scripts: FontScript[];
  /** 目录里有正体的字重、有斜体的字重（不在目录里的为空）。 */
  weights: number[];
  italics: number[];
  variable: boolean;
  /** 许可；本机的族不知道时为 null。 */
  licence: FontLicence | null;
  /** 这个族从哪里来：随内核发布、本机、Google Fonts 字体目录。 */
  source: 'built-in' | 'local' | 'google-fonts';
  /** 下载缓存里有的 face。 */
  downloaded: (FontFaceStyle & { sizeBytes: number })[];
  /** 在跑的下载任务与目前的进度（字节；总数未知时为 null）。 */
  job: { jobId: Id; doneBytes: number; totalBytes: number | null } | null;
  /** 最近一次下载失败：错误码与说明（再次下载或下载成功之后清掉）。 */
  error: {
    code: FontDownloadErrorCode | 'CANCELLED';
    message: string;
    /** `message` 是 Runtime 的文案时的消息引用（message-ref.ts）：界面与 CLI 按当前语言重新生成。 */
    messageRef?: MessageRef;
    at: string;
  } | null;
}

export interface FontsCatalogueParams {
  /** 按族名找（不分大小写，包含即可）。 */
  query?: string;
  category?: FontCategory;
  script?: FontScript;
  /** 只要这些族（按名字精确找，不分大小写；找不到的给 `unavailable`），给了时不分页。 */
  families?: string[];
  /** 只要某些状态。 */
  states?: FontFamilyState[];
  offset?: number;
  /** 一页多少个（默认 100，最多 500）。 */
  limit?: number;
}

export interface FontsCatalogueResult {
  /** 符合条件的总数（分页之前）。 */
  total: number;
  families: FontFamilyStatus[];
  /** 字体目录的生成日期。 */
  catalogueDate: string;
}

/** `fonts.download` 的结果：要下载的 face 与任务；都已经下载好（或已经在下载）时 `jobId` 是在跑的任务或 null。 */
export interface FontDownloadResult {
  family: string;
  /** 按目录对好的 face（请求的字重对到这个族实际有的字重）。 */
  faces: FontFaceStyle[];
  jobId: Id | null;
  status: FontFamilyStatus;
}

/** `fonts.remove` / `fonts.clear` 的结果。 */
export interface FontRemoveResult {
  removed: DownloadedFontFace[];
  freedBytes: number;
  /** 还没结束的导出用着、这次没删的 face（`fonts.clear`）。 */
  kept: DownloadedFontFace[];
}

/** 样张的字体格式（按文件头认，不信 CSS 里写的）。 */
export type FontSampleFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

/**
 * `fonts.sample` 的结果：只含族名里那几个字的字体子集，界面用它把族名画成这个族自己的样子。拿不到时 `data` 为 null
 * （`reason` 说明：严格离线、不在字体目录里），界面照界面字体写族名。
 */
export interface FontSampleResult {
  family: string;
  /** 子集里的字（族名去掉重复的字）。 */
  text: string;
  /** 字体文件（base64）。 */
  data: string | null;
  format: FontSampleFormat | null;
  reason?: 'offline-strict' | 'not-in-catalogue';
}

/** `fonts.usage` 的一个族：用到的 face、此刻的状态，与渲染内核此刻用什么画它。 */
export interface FontUsageFamily {
  family: string;
  /** 排字点了名的字重与斜体。 */
  faces: FontFaceStyle[];
  status: FontFamilyStatus;
  /**
   * 此刻画不了这个族时由哪个族代替（内核的回退族）；随内核、本机已装或下载缓存里有这个族时为 null。
   * 下载缓存里只有别的字重时也是 null（引擎就近挑字重）。
   */
  fallback: string | null;
}

export interface FontsUsageResult {
  /** 视频用到的族（按族名）。 */
  families: FontUsageFamily[];
  /** 渲染内核的回退族（缺的字都由它画）。 */
  fallback: string;
  /** `download: true` 时这次开始下载的族（自动下载开着、不是严格离线、最近没失败过）。 */
  started: string[];
}
