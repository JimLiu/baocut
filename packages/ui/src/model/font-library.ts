import type {
  DownloadedFontFace,
  FontCategory,
  FontFamilyState,
  FontFamilyStatus,
  FontLicence,
  FontScript,
  FontUsageFamily,
  JobRecord,
  JobWarning,
} from '@baocut/protocol';
import { defineMessages, intlLocale, live, localizeText, onLocaleChange } from '@baocut/protocol';
import { jobLive } from './task-list.ts';
import { zhHans } from './font-library.zh-Hans.ts';
import { zhHant } from './font-library.zh-Hant.ts';
import { ja } from './font-library.ja.ts';
import { ko } from './font-library.ko.ts';
import { es } from './font-library.es.ts';
import { fr } from './font-library.fr.ts';
import { de } from './font-library.de.ts';
import { nl } from './font-library.nl.ts';
import { ptBR } from './font-library.pt-BR.ts';
import { it } from './font-library.it.ts';
import { ru } from './font-library.ru.ts';
import { pl } from './font-library.pl.ts';
import { tr } from './font-library.tr.ts';
import { vi } from './font-library.vi.ts';

const fontsN = (n: number) => (n === 1 ? '1 font' : `${n} fonts`);
const familiesN = (n: number) => (n === 1 ? '1 family' : `${n} families`);

/** 字体库的文案（英文是键与类型的来源，译文在 `font-library.zh-Hans.ts`）。族名、许可名、Google Fonts 不翻。 */
const en = {
  state: {
    'built-in': 'Built-in',
    installed: 'Installed',
    downloaded: 'Downloaded',
    downloadable: 'Available to download',
    downloading: 'Downloading',
    failed: 'Failed',
    unavailable: 'Font not found',
  } as Record<FontFamilyState, string>,
  source: {
    'built-in': 'Ships with the app',
    local: 'Installed on this computer',
    'google-fonts': 'Google Fonts',
  } as Record<FontFamilyStatus['source'], string>,
  categories: {
    'sans-serif': 'Sans serif',
    serif: 'Serif',
    display: 'Display',
    handwriting: 'Handwriting',
    monospace: 'Monospace',
  } as Record<FontCategory, string>,
  scripts: {
    chinese: 'Chinese',
    japanese: 'Japanese',
    korean: 'Korean',
    latin: 'Latin',
    cyrillic: 'Cyrillic',
    greek: 'Greek',
    vietnamese: 'Vietnamese',
    arabic: 'Arabic',
    hebrew: 'Hebrew',
    thai: 'Thai',
    devanagari: 'Devanagari',
  } as Record<Exclude<FontScript, 'other'>, string>,
  privacyNote: 'Downloaded from Google Fonts; only the family name and weights are sent. Stored in app data, not in the video folder.',
  offlineNote: 'You’re offline · Downloadable fonts need a network connection to download',
  strictOfflineNote: 'Strict offline mode is on · Fonts aren’t downloaded; downloadable fonts are shown in a fallback font',
  waiting: 'Waiting',
  sections: { search: 'Search results', video: 'Used in this video', recent: 'Recently used', all: 'All fonts' } as Record<
    'search' | 'video' | 'recent' | 'all',
    string
  >,
  cancelled: 'Cancelled',
  downloadFailed: 'Download failed',
  pickToast: (family: string, fallback: string) => `“${family}” is shown in “${fallback}” until it’s downloaded, then switches automatically`,
  alreadyDownloaded: (family: string) => `“${family}” is already downloaded`,
  detail: { status: 'Status', source: 'Source', category: 'Category', weights: 'Weights', size: 'Size', licence: 'License' },
  scriptJoin: (labels: readonly string[]) => labels.join(', '),
  withItalics: ' (with italics)',
  downloadedSize: (size: string) => `${size} downloaded`,
  unknownLicence: 'Unknown (a font on this computer; check for yourself whether it can be used for publishing)',
  mirrorInvalid: 'Not a valid address',
  mirrorHttps: 'Only addresses starting with https:// are accepted',
  mirrorCredentials: 'The address can’t include a username or password',
  mirrorQuery: 'The address can’t include query parameters or #',
  italic: ' italic',
  cleared: (removed: number, freed: string, kept: number) =>
    `Cleared ${familiesN(removed)} and freed ${freed}${kept ? ` · ${kept} in use by exports ${kept === 1 ? 'was' : 'were'} kept` : ''}`,
  clearConfirm: (count: number, size: string, inUse: boolean) =>
    `Delete ${familiesN(count)}, ${size} in total. Videos that use them show a fallback font until they’re downloaded again when needed.` +
    (inUse ? ' Fonts in use by unfinished exports will be kept.' : ''),
  barOff: (total: number) => `This video uses ${fontsN(total)} that ${total === 1 ? 'isn’t' : 'aren’t'} downloaded; showing a fallback font`,
  autoOff: 'Auto-download is off',
  barRunning: 'Downloading fonts used in this video',
  barReady: (total: number) => (total === 1 ? 'The font used in this video is ready' : `All ${total} fonts used in this video are ready`),
  barMissed: (n: number) => `${fontsN(n)} couldn’t be fetched; showing a fallback font`,
  skipped: 'Skipped',
  notDownloaded: 'Not downloaded',
  /** 一串族名（导出那几句里）。 */
  quoteList: (names: readonly string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(names.map((n) => `“${n}”`)),
  exportPending: (names: string, n: number) =>
    `${names} ${n === 1 ? 'is' : 'are'} still downloading · Export waits for ${n === 1 ? 'it' : 'them'} before rendering`,
  exportFailed: (names: string, fallbacks: string) => `${names} didn’t download · ${fallbacks} will be used instead in the export`,
  exportMissingAuto: (names: string, n: number) =>
    `${names} ${n === 1 ? 'isn’t' : 'aren’t'} downloaded yet · ${n === 1 ? 'It’s' : 'They’re'} downloaded when export starts; if that fails, a fallback font is used`,
  exportMissingOff: (names: string, n: number) =>
    `${names} ${n === 1 ? 'isn’t' : 'aren’t'} downloaded (auto-download is off) · The export will use a fallback font`,
  actionRetry: 'Try again',
  actionDownloadNow: 'Download now',
  actionDownload: 'Download',
  exportFallback: (family: string, fallback: string, reason: string) => `“${family}” replaced with “${fallback}” · ${reason}`,
  exportFallbackSeparator: '; ',
  exportPhase: (detail: string | null) => (detail ? `Downloading fonts · ${detail}` : 'Downloading fonts'),
  systemFont: 'System font',
  errorFallback: 'The operation didn’t complete',
  removed: (family: string) => `Deleted the downloaded files for “${family}”`,
  removeInUse: (family: string) => `An unfinished export is using “${family}” · Delete it after the export finishes`,
};
export type FontLibraryMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 按需下载的字体在界面上的读法（产品设计 §5.9「字体」、§7.6；架构设计 §9.1；原型 model-font-library.js）。
 *
 * 选字框、编辑器顶上的字体条、导出面板与设置 › 字体读同一份状态：每个族一条 `FontFamilyStatus`（`fonts.catalogue`），
 * 在跑的下载叠上 `jobs` 主题里 `fontDownload` 任务的字节进度（`modelId` 是族名）。这里只做「算」：合表、排序、筛选、
 * 分段、每一行末尾放什么、进度怎么念、镜像地址是否合规、打开视频与导出时要说什么。状态的推进在 state/font-library-store.ts。
 *
 * 与原型的差别（真实数据决定）：
 * - 字体目录不带文件大小：下载钮的提示不写「约 X」，详情只在下载之后写大小；选中时给不给「取消下载」按文字判断
 *   （中日韩字体一个字重就有几 MB，拉丁字体一两百 KB）。
 * - 回退字体是渲染内核的回退族（`fonts.usage` 的 `fallback`，随内核的思源黑体），不按分类示意。
 * - 样张只画族名（`fonts.sample` 只带族名里的字），不补「永和九年」这类本文字的字。
 */

export const FONT_STATE_LABEL: Record<FontFamilyState, string> = live(() => M.state);

export const FONT_SOURCE_LABEL: Record<FontFamilyStatus['source'], string> = live(() => M.source);

export const FONT_LICENCE_LABEL: Record<FontLicence, string> = {
  'OFL-1.1': 'SIL Open Font License 1.1',
  'Apache-2.0': 'Apache License 2.0',
  'UFL-1.0': 'Ubuntu Font Licence 1.0',
};

export const FONT_CATEGORIES: readonly { key: FontCategory; label: string }[] = (['sans-serif', 'serif', 'display', 'handwriting', 'monospace'] as const).map(
  (key) => ({
    key,
    get label() {
      return M.categories[key];
    },
  }),
);

export const FONT_SCRIPTS: readonly { key: FontScript; label: string }[] = (
  ['chinese', 'japanese', 'korean', 'latin', 'cyrillic', 'greek', 'vietnamese', 'arabic', 'hebrew', 'thai', 'devanagari'] as const
).map((key) => ({
  key,
  get label() {
    return M.scripts[key];
  },
}));

/**
 * 渲染内核的回退族：`fonts.usage` 报的是权威的那一个（Render Worker 给的）；还没清点时（选字框里刚选的族）用同一个值。
 */
export const KERNEL_FALLBACK = 'Noto Sans SC';

/** 「系统字体」：文字没有指定字体时的取值（渲染内核用缺省字体），不在字体目录里。 */
export const SYSTEM_FONT = 'system';

/** 隐私说明（详情页，原型原文）。 */
export let FONT_PRIVACY_NOTE: string = M.privacyNote;
export let FONT_OFFLINE_NOTE: string = M.offlineNote;
/** 严格离线模式开着时（原型没有这一种：真实应用的 Runtime 这时不下载字体，也不取样张）。 */
export let FONT_STRICT_OFFLINE_NOTE: string = M.strictOfflineNote;
onLocaleChange(() => {
  FONT_PRIVACY_NOTE = M.privacyNote;
  FONT_OFFLINE_NOTE = M.offlineNote;
  FONT_STRICT_OFFLINE_NOTE = M.strictOfflineNote;
});

export interface FontProgress {
  done: number;
  total: number | null;
}

/** 一行：Runtime 的状态，叠上在跑的下载任务的进度。 */
export interface FontRow extends FontFamilyStatus {
  progress: FontProgress | null;
  /** 下载任务排在同时下载的上限后面、还没开始（任务记录的 `wait.reason === 'concurrency'`）。 */
  waiting: boolean;
}

/** 下载中的一行此刻念什么：排在上限后面的念「等待中」；开始了的念进度，还没收到字节、也不知道总大小时念「下载中」。 */
export function downloadingLabel(f: Pick<FontRow, 'progress' | 'waiting'>): string {
  if (f.waiting) return M.waiting;
  return progressText(f.progress) || FONT_STATE_LABEL.downloading;
}

export function fmtBytes(n: number): string {
  const b = Math.max(0, Number(n) || 0);
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** 进度怎么念：知道总数时是百分比，不知道时只念收到了多少。 */
export function progressText(p: FontProgress | null): string {
  if (!p) return '';
  if (p.total) return `${Math.min(100, Math.floor((p.done / p.total) * 100))}%`;
  // 还没收到字节也不知道总大小：不念「0 B」（行尾与字体条念「下载中」，见 downloadingLabel）。
  return p.done > 0 ? fmtBytes(p.done) : '';
}

export function progressValue(p: FontProgress | null): number | null {
  return p && p.total ? Math.min(100, (p.done / p.total) * 100) : null;
}

/** 族名的比较键。 */
export const familyKey = (family: string) => family.trim().toLowerCase();

/** 在跑的 `fontDownload` 任务，按族（`modelId`）。 */
export function liveFontJobs(jobs: readonly JobRecord[]): Map<string, JobRecord> {
  const out = new Map<string, JobRecord>();
  for (const job of jobs) if (job.kind === 'fontDownload' && jobLive(job)) out.set(familyKey(job.modelId), job);
  return out;
}

/**
 * 叠上在跑的任务：任务在跑就是下载中（进度用任务的字节进度，比列表的快照新）；Runtime 说在下载（导出任务里的下载，
 * 不是 `fontDownload` 任务）时用状态里的字节数。
 *
 * 「等待中」只给真的排在同时下载的上限后面的任务（Runtime 同时下两个，排着的任务记录带 `wait`）。刚提交、马上就开始的任务
 * 先发一条不带 `wait` 的 `queued`，接着是 `running`：这一下照下载中念，不闪「等待中」。
 */
export function liveRow(status: FontFamilyStatus, job: JobRecord | undefined): FontRow {
  if (job && job.state !== 'queued' && job.progress?.unit === 'bytes') {
    return {
      ...status,
      state: 'downloading',
      error: null,
      progress: { done: job.progress.done, total: job.progress.total },
      waiting: false,
    };
  }
  if (job) {
    const waiting = job.state === 'queued' && job.wait?.reason === 'concurrency';
    return { ...status, state: 'downloading', error: null, progress: waiting ? null : { done: 0, total: null }, waiting };
  }
  if (status.state === 'downloading') {
    return { ...status, progress: { done: status.job?.doneBytes ?? 0, total: status.job?.totalBytes ?? null }, waiting: false };
  }
  return { ...status, progress: null, waiting: false };
}

/** 能不能下载（选中时开始下载、行尾给下载或重试）。 */
export const canDownload = (f: Pick<FontFamilyStatus, 'state'>) => f.state === 'downloadable' || f.state === 'failed';

/** 一个族是否画得出来（随内核、本机或下载缓存里有）。 */
export const isReady = (f: Pick<FontFamilyStatus, 'state' | 'downloaded'>) =>
  f.state === 'built-in' || f.state === 'installed' || f.state === 'downloaded' || f.downloaded.length > 0;

/** 选字框里排好的次序，记成 族名 → 序号：打开着的选字框用它排，下载完成不挪行（表外的族排在后面）。 */
export function orderKey(rows: readonly Pick<FontFamilyStatus, 'family'>[]): Map<string, number> {
  return new Map(rows.map((f, i) => [familyKey(f.family), i]));
}

function sortRows<T extends Pick<FontFamilyStatus, 'family'>>(rows: readonly T[], frozen?: ReadonlyMap<string, number>): T[] {
  if (!frozen) return [...rows];
  const at = (f: T) => frozen.get(familyKey(f.family)) ?? Infinity;
  return [...rows].sort((a, b) => at(a) - at(b) || a.family.localeCompare(b.family, 'en'));
}

export interface FontQuery {
  query?: string;
  category?: FontCategory | null;
  script?: FontScript | null;
}

/** 按族名（包含、不分大小写）、分类与文字筛。 */
export function filterRows<T extends FontFamilyStatus>(rows: readonly T[], q: FontQuery): T[] {
  const query = (q.query ?? '').trim().toLowerCase();
  return rows.filter(
    (f) => (!query || f.family.toLowerCase().includes(query)) && (!q.category || f.category === q.category) && (!q.script || f.scripts.includes(q.script)),
  );
}

export interface FontSection<T> {
  key: 'search' | 'video' | 'recent' | 'all';
  title: string;
  rows: T[];
}

/**
 * 选字框的分段：「这个视频里用到」「最近用过」，然后是全部字体（同一张表的不同取法，不去重）。有检索词或筛选时合成一条
 * 「搜索结果」。原型的「品牌字体」一段没有：品牌库的字体还不能在字体框里选（library-brand.ts）。
 */
export function fontSections<T extends FontFamilyStatus>(
  rows: readonly T[],
  opts: FontQuery & { inVideo?: readonly string[]; recent?: readonly string[]; frozen?: ReadonlyMap<string, number> },
): FontSection<T>[] {
  if ((opts.query ?? '').trim() || opts.category || opts.script) {
    return [{ key: 'search', title: M.sections.search, rows: sortRows(filterRows(rows, opts), opts.frozen) }];
  }
  const byName = new Map(rows.map((f) => [familyKey(f.family), f]));
  const pick = (names: readonly string[] | undefined) => [...new Set((names ?? []).map(familyKey))].map((n) => byName.get(n)).filter((f): f is T => !!f);
  const out: FontSection<T>[] = [];
  const used = pick(opts.inVideo);
  if (used.length) out.push({ key: 'video', title: M.sections.video, rows: used });
  const recent = pick(opts.recent).slice(0, 5);
  if (recent.length) out.push({ key: 'recent', title: M.sections.recent, rows: recent });
  out.push({ key: 'all', title: M.sections.all, rows: sortRows(rows, opts.frozen) });
  return out;
}

/** 列表头「全部字体 · 可下载 N 个」的 N：字体目录里的族（随内核、本机已装的目录字体也算）。 */
export const catalogueCount = (rows: readonly FontFamilyStatus[]) => rows.filter((f) => f.category !== null).length;

export type RowEnd =
  | { kind: 'badge'; label: string; tone?: 'positive' }
  | { kind: 'download' }
  | { kind: 'progress'; label: string; value: number | null }
  | { kind: 'retry'; label: string; message: string }
  | { kind: 'none' };

/** 每一行末尾放什么。 */
export function rowEnd(f: FontRow): RowEnd {
  switch (f.state) {
    case 'built-in':
    case 'installed':
      return { kind: 'badge', label: FONT_STATE_LABEL[f.state] };
    case 'downloaded':
      return { kind: 'badge', label: M.state.downloaded, tone: 'positive' };
    case 'downloading':
      return { kind: 'progress', label: downloadingLabel(f), value: progressValue(f.progress) };
    case 'failed': {
      const cancelled = f.error?.code === 'CANCELLED';
      return { kind: 'retry', label: cancelled ? M.cancelled : M.state.failed, message: cancelled ? M.cancelled : (localizeText(f.error?.message, f.error?.messageRef) ?? M.downloadFailed) };
    }
    case 'downloadable':
      return { kind: 'download' };
    case 'unavailable':
      return { kind: 'badge', label: FONT_STATE_LABEL.unavailable };
    default:
      return { kind: 'none' };
  }
}

/** 中日韩字体：一个字重就有几 MB，下载要一阵子。 */
export const isLargeFont = (f: Pick<FontFamilyStatus, 'scripts'>) => f.scripts.some((s) => s === 'chinese' || s === 'japanese' || s === 'korean');

/**
 * 选中一个还没下载的族时的提示：立即生效，先用回退字体显示，下载好后自动换上。大的（中日韩）给「取消下载」，
 * 小的一两秒就到，提示自己消失。
 */
export function pickToast(f: Pick<FontFamilyStatus, 'family' | 'scripts'>, fallback = KERNEL_FALLBACK): { text: string; cancellable: boolean } {
  return { text: M.pickToast(f.family, fallback), cancellable: isLargeFont(f) };
}

export const alreadyDownloadedText = (family: string) => M.alreadyDownloaded(family);

/** 详情页的几行。 */
export function detailRows(f: FontRow): [string, string][] {
  const end = rowEnd(f);
  const category = FONT_CATEGORIES.find((c) => c.key === f.category)?.label;
  const scripts = M.scriptJoin(f.scripts.map((k) => FONT_SCRIPTS.find((s) => s.key === k)?.label).filter((s): s is string => !!s));
  const size = f.downloaded.reduce((s, d) => s + d.sizeBytes, 0);
  const state =
    FONT_STATE_LABEL[f.state] +
    (end.kind === 'progress' && end.label !== FONT_STATE_LABEL.downloading ? ` · ${end.label}` : '') +
    (end.kind === 'retry' && end.message !== M.cancelled ? ` · ${end.message}` : end.kind === 'retry' ? ` · ${M.cancelled}` : '');
  const rows: ([string, string] | null)[] = [
    [M.detail.status, state],
    [M.detail.source, FONT_SOURCE_LABEL[f.source]],
    category || scripts ? [M.detail.category, [category, scripts].filter(Boolean).join(' · ')] : null,
    f.weights.length ? [M.detail.weights, f.weights.join(' · ') + (f.italics.length ? M.withItalics : '')] : null,
    f.source === 'google-fonts' && f.downloaded.length ? [M.detail.size, M.downloadedSize(fmtBytes(size))] : null,
    [M.detail.licence, f.licence ? FONT_LICENCE_LABEL[f.licence] : M.unknownLicence],
  ];
  return rows.filter((r): r is [string, string] => r !== null);
}

/** 镜像地址：空 = 用默认；否则必须是 https、没有账号、查询参数与片段。返回错误文案或 null。 */
export function mirrorError(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return M.mirrorInvalid;
  }
  if (u.protocol !== 'https:') return M.mirrorHttps;
  if (u.username || u.password) return M.mirrorCredentials;
  if (u.search || u.hash || v.includes('?') || v.includes('#')) return M.mirrorQuery;
  return null;
}

export interface DownloadedRow {
  family: string;
  weights: string;
  sizeBytes: number;
  licence: string;
  /** 最近一次下载的时间（ISO）。 */
  at: string;
  inUse: boolean;
}

/** 设置里的已下载列表：每个族一行（字重、大小、许可、下载时间、是否有导出在用），以及总大小。 */
export function downloadedList(faces: readonly DownloadedFontFace[], inUse: readonly string[]): { rows: DownloadedRow[]; totalBytes: number } {
  const busy = new Set(inUse.map(familyKey));
  const groups = new Map<string, DownloadedFontFace[]>();
  for (const face of faces) {
    const key = familyKey(face.family);
    groups.set(key, [...(groups.get(key) ?? []), face]);
  }
  const rows = [...groups.values()]
    .map((list) => {
      const first = list[0]!;
      const weights = [...list].sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
      return {
        family: first.family,
        weights: weights.map((f) => `${f.weight}${f.italic ? M.italic : ''}`).join(' · '),
        sizeBytes: list.reduce((s, f) => s + f.sizeBytes, 0),
        licence: first.licence,
        at: list
          .map((f) => f.downloadedAt)
          .sort()
          .at(-1)!,
        inUse: busy.has(familyKey(first.family)),
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family, 'en'));
  return { rows, totalBytes: rows.reduce((s, r) => s + r.sizeBytes, 0) };
}

/** 「已清空 3 个族，释放 12.4 MB · 导出在用的 1 个留下」。 */
export function clearedText(removed: readonly { family: string }[], freedBytes: number, kept: readonly { family: string }[]): string {
  const families = (list: readonly { family: string }[]) => new Set(list.map((f) => familyKey(f.family))).size;
  const k = families(kept);
  return M.cleared(families(removed), fmtBytes(freedBytes), k);
}

export function clearConfirmBody(rows: readonly DownloadedRow[], totalBytes: number): string {
  return M.clearConfirm(
    rows.length,
    fmtBytes(totalBytes),
    rows.some((r) => r.inUse),
  );
}

// ---- 打开视频时的字体条 ----

/** 打开视频的那一批：用到的族里要下载的（`fonts.usage` 时还没画得出来、字体目录里有的）。 */
export interface FontBatch {
  videoId: string;
  families: string[];
  /** 自动下载开着（这一批由 Runtime 开始下载）或关着（等用户点「下载」）。 */
  mode: 'auto' | 'off';
  /** 用户点了「跳过这个」的族（取消记为 `CANCELLED`，条上念「已跳过」）。 */
  skipped: string[];
  dismissed: boolean;
}

/** 打开视频时这一批里有哪些族：字体目录里有、此刻画不出来的（不在目录里的族下载不了，内核照回退字体画并提示）。 */
export function batchFamilies(usage: readonly FontUsageFamily[]): string[] {
  return usage.filter((f) => f.fallback !== null && f.status.source === 'google-fonts' && f.status.state !== 'unavailable').map((f) => f.family);
}

export type FontBar =
  | { kind: 'running'; title: string; count: string; current: string; progress: string; value: number | null }
  | { kind: 'ready'; title: string }
  | { kind: 'missed'; title: string; rows: FontBarRow[] }
  | { kind: 'off'; title: string; rows: FontBarRow[] };

export interface FontBarRow {
  family: string;
  fallback: string;
  reason: string;
}

type Outcome = 'ok' | 'pending' | 'failed' | 'cancelled' | 'skipped' | 'idle';

function outcomeOf(f: FontRow | undefined, batch: FontBatch): Outcome {
  if (!f) return 'idle';
  if (isReady(f) && f.state !== 'downloading') return 'ok';
  if (f.state === 'downloading') return 'pending';
  if (f.state === 'failed') {
    if (f.error?.code !== 'CANCELLED') return 'failed';
    return batch.skipped.some((n) => familyKey(n) === familyKey(f.family)) ? 'skipped' : 'cancelled';
  }
  return 'idle';
}

function reasonOf(outcome: Outcome, f: FontRow | undefined): string {
  if (outcome === 'skipped') return M.skipped;
  if (outcome === 'cancelled') return M.cancelled;
  if (outcome === 'failed') return localizeText(f?.error?.message, f?.error?.messageRef) || M.downloadFailed;
  return M.notDownloaded;
}

/**
 * 字体条画什么（null 不画）。Runtime 并行下载（同时两个），条上照原型一个一个念：第几个、在下哪一个与它的进度。
 * - 进行中：「正在下载这个视频用到的字体 · 1/3 · 族名 42%」，可以跳过当前这个或全部取消；
 * - 全部到了：一句「已就绪」，3 秒后自己收起；
 * - 有没取到的：「2 个字体没取到，正在用回退字体显示」，展开是 族 → 回退字体 · 原因，每个可以重试；
 * - 自动下载关着：「这个视频用到 2 个没下载的字体，正在用回退字体显示」，可以一次下载，或去设置。
 */
export function fontBar(batch: FontBatch | null, byName: ReadonlyMap<string, FontRow>, fallbackOf: (family: string) => string): FontBar | null {
  if (!batch || batch.dismissed || batch.families.length === 0) return null;
  const total = batch.families.length;
  const get = (n: string) => byName.get(familyKey(n));
  const outcomes = batch.families.map((n) => [n, outcomeOf(get(n), batch)] as const);
  if (batch.mode === 'off' && outcomes.every(([, o]) => o === 'idle' || o === 'failed' || o === 'cancelled')) {
    return {
      kind: 'off',
      title: M.barOff(total),
      rows: batch.families.map((n) => ({ family: n, fallback: fallbackOf(n), reason: M.autoOff })),
    };
  }
  const current = outcomes.find(([, o]) => o === 'pending');
  if (current) {
    const settled = outcomes.filter(([, o]) => o !== 'pending').length;
    const f = get(current[0])!;
    return {
      kind: 'running',
      title: M.barRunning,
      count: `${settled + 1}/${total}`,
      current: f.family,
      progress: downloadingLabel(f),
      value: progressValue(f.progress),
    };
  }
  const missed = outcomes.filter(([, o]) => o !== 'ok');
  if (!missed.length) return { kind: 'ready', title: M.barReady(total) };
  return {
    kind: 'missed',
    title: M.barMissed(missed.length),
    rows: missed.map(([n, o]) => ({ family: get(n)?.family ?? n, fallback: fallbackOf(n), reason: reasonOf(o, get(n)) })),
  };
}

// ---- 导出 ----

export interface ExportFontLine {
  tone: 'info' | 'notice';
  families: string[];
  text: string;
  /** 行尾那个链接的字（点了都是下载这几个族）。 */
  action?: string;
}

/**
 * 导出面板（视频页）关于字体的几句：用到的族里还在下载的、失败的、没下载的（自动下载开着 / 关着）。导出会先等在下载的；
 * 没取到的照回退字体画，导出结果里有一条警告（`FONT_NOT_DOWNLOADED`）。不拦导出，也不要先选替代字体。
 */
export function exportFontNote(usage: readonly FontUsageFamily[], byName: ReadonlyMap<string, FontRow>, autoDownload: boolean): ExportFontLine[] {
  const used = usage
    .filter((u) => u.status.source === 'google-fonts')
    .map((u) => ({ row: byName.get(familyKey(u.family)) ?? liveRow(u.status, undefined), fallback: u.fallback }));
  const names = (list: typeof used) => M.quoteList(list.map((f) => f.row.family));
  const pending = used.filter((f) => f.row.state === 'downloading');
  const failed = used.filter((f) => f.row.state === 'failed');
  const missing = used.filter((f) => f.row.state === 'downloadable');
  const lines: ExportFontLine[] = [];
  const families = (list: typeof used) => list.map((f) => f.row.family);
  if (pending.length) lines.push({ tone: 'info', families: families(pending), text: M.exportPending(names(pending), pending.length) });
  if (failed.length) {
    const fallbacks = M.quoteList([...new Set(failed.map((f) => f.fallback ?? KERNEL_FALLBACK))]);
    lines.push({
      tone: 'notice',
      families: families(failed),
      action: M.actionRetry,
      text: M.exportFailed(names(failed), fallbacks),
    });
  }
  if (missing.length && autoDownload) {
    lines.push({
      tone: 'info',
      families: families(missing),
      action: M.actionDownloadNow,
      text: M.exportMissingAuto(names(missing), missing.length),
    });
  } else if (missing.length) {
    lines.push({
      tone: 'notice',
      families: families(missing),
      action: M.actionDownload,
      text: M.exportMissingOff(names(missing), missing.length),
    });
  }
  return lines;
}

/** 导出完成时的一句：没取到、照回退字体画的族（`FONT_NOT_DOWNLOADED` 警告，一个族说一次）。 */
export function exportFontFallbacks(warnings: readonly JobWarning[]): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const w of warnings) {
    if (w.code !== 'FONT_NOT_DOWNLOADED') continue;
    if (w.font) {
      const key = familyKey(w.font.family);
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(M.exportFallback(w.font.family, w.font.fallback, w.font.reason));
    } else if (w.detail) parts.push(localizeText(w.detail, w.detailRef));
  }
  return parts.length ? parts.join(M.exportFallbackSeparator) : null;
}

/**
 * 导出结果里其余的提醒：去掉 `FONT_NOT_DOWNLOADED`（单独列在上面），也去掉渲染内核对同一个族报的缺字体提示
 * （`EXPORT_RENDER_NOTE`「…字体 "X" 在当前字体库中不可用…」），免得一个族说两遍。别的族的缺字体提示照留。
 */
export function exportOtherWarnings(warnings: readonly JobWarning[]): JobWarning[] {
  const covered = new Set(warnings.flatMap((w) => (w.code === 'FONT_NOT_DOWNLOADED' && w.font ? [familyKey(w.font.family)] : [])));
  return warnings.filter((w) => {
    if (w.code === 'FONT_NOT_DOWNLOADED') return false;
    if (w.code !== 'EXPORT_RENDER_NOTE' || !w.detail) return true;
    // i18n-ignore: 匹配渲染内核报来的原话（数据，不是界面文案）
    const family = /字体 "((?:[^"\\]|\\.)*)" 在当前字体库中不可用/.exec(w.detail)?.[1];
    return family === undefined || !covered.has(familyKey(family.replace(/\\(.)/g, '$1')));
  });
}

/** 导出准备阶段下载字体时：「下载字体 · Ma Shan Zheng 42%」（百分比是导出任务等的全部字体的字节进度）。 */
export function exportFontPhase(job: Pick<JobRecord, 'phase' | 'progress' | 'state'>, downloading: readonly Pick<FontFamilyStatus, 'family'>[]): string | null {
  if (job.state !== 'running' || job.phase !== 'downloading') return null;
  const p = job.progress?.unit === 'bytes' ? job.progress : null;
  const pct = p ? progressText({ done: p.done, total: p.total }) : '';
  const parts = [downloading[0]?.family, pct].filter(Boolean);
  return M.exportPhase(parts.length ? parts.join(' ') : null);
}

// ---- 最近用过 ----

export function pushRecent(recent: readonly string[], family: string, limit = 8): string[] {
  return [family, ...recent.filter((n) => familyKey(n) !== familyKey(family))].slice(0, limit);
}

// ---- 选字框的整表 ----

/** 字体框里显示的名字：「系统字体」之外就是族名本身。 */
export const fontLabel = (family: string) => (family === SYSTEM_FONT ? M.systemFont : family);

function placeholderStatus(family: string, state: FontFamilyState): FontFamilyStatus {
  return {
    family,
    state,
    category: null,
    subsets: [],
    scripts: [],
    weights: [],
    italics: [],
    variable: false,
    licence: null,
    source: 'local',
    downloaded: [],
    job: null,
    error: null,
  };
}

/**
 * 选字框的整表：Runtime 给的次序，最前面是「系统字体」（文字原来的缺省值，留着可选）；当前值不在表里（字体目录与本机都没有）
 * 时补在最后一行，标「没有这个字体」，免得字体框里看不到现值。
 */
export function pickerRows(statuses: Readonly<Record<string, FontFamilyStatus>>, order: readonly string[], current: string): FontFamilyStatus[] {
  const rows: FontFamilyStatus[] = [placeholderStatus(SYSTEM_FONT, 'built-in')];
  for (const key of order) {
    const status = statuses[key];
    if (status) rows.push(status);
  }
  const want = familyKey(current);
  if (current && !rows.some((f) => familyKey(f.family) === want)) rows.push(statuses[want] ?? placeholderStatus(current, 'unavailable'));
  return rows;
}

// ---- 删除与错误 ----

/** Runtime 拒绝时的错误码（`details.code`）与说明。 */
export function fontError(error: unknown): { code: string | null; message: string } {
  const e = error as { message?: unknown; details?: { code?: unknown } } | null;
  const code = typeof e?.details?.code === 'string' ? e.details.code : null;
  return { code, message: typeof e?.message === 'string' && e.message ? e.message : M.errorFallback };
}

/** 删除一个族下载的文件之后的提示：还没结束的导出在用（`FONT_IN_USE`）时说什么时候能删（原型原文）。 */
export function removeToast(family: string, error: unknown | null): { text: string; tone: 'neutral' | 'notice' } {
  if (error === null) return { text: M.removed(family), tone: 'neutral' };
  const { code, message } = fontError(error);
  if (code === 'FONT_IN_USE') return { text: M.removeInUse(family), tone: 'notice' };
  return { text: message, tone: 'notice' };
}
