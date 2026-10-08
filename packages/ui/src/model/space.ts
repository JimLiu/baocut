import { intlLocale, live, type FileTarget, type Id, type SpaceEntry, type SpaceEntryKind, type SpaceEntryStatus } from '@baocut/protocol';
import { documentPreview } from './file-preview.ts';
import { formatClock } from './format.ts';
import { M } from './space-copy.ts';

/**
 * Space 列表区的纯函数（产品设计 §4.3–§4.4）：分类、计数、筛选、搜索、排序与几列文字。
 * 条目来自 Runtime 的 Space 目录；这里只决定怎么看。
 */

export const KIND_LABEL: Record<SpaceEntryKind, string> = live(() => M.kind);

/** 分类侧栏的顺序。视频是带 video.db 的子目录（0.4 起）；项目目录里的视频文件单列「视频素材」。 */
const KIND_ORDER: SpaceEntryKind[] = ['video', 'export', 'video-file', 'image', 'audio', 'subtitle', 'document', 'template', 'package'];

export type SpaceCategory = 'all' | SpaceEntryKind | 'favorite' | 'trash';

export const SPACE_CATEGORIES: { key: SpaceCategory; label: string; group: 'kinds' | 'mine' }[] = [
  {
    key: 'all',
    get label() {
      return M.categoryAll;
    },
    group: 'kinds',
  },
  ...KIND_ORDER.map((kind) => ({
    key: kind,
    get label() {
      return KIND_LABEL[kind];
    },
    group: 'kinds' as const,
  })),
  {
    key: 'favorite',
    get label() {
      return M.favorite;
    },
    group: 'mine',
  },
  {
    key: 'trash',
    get label() {
      return M.trash;
    },
    group: 'mine',
  },
];

export type SpaceSort = 'recent' | 'name' | 'kind';

export const SPACE_SORTS: readonly { readonly key: SpaceSort; readonly label: string }[] = (['recent', 'name', 'kind'] as const).map((key) => ({
  key,
  get label() {
    return M.sort[key];
  },
}));

/** 回收站只收已移入的；其余分类都不含回收站里的。 */
export function inCategory(entry: SpaceEntry, category: SpaceCategory): boolean {
  if (category === 'trash') return entry.user.trashedAt !== null;
  if (entry.user.trashedAt !== null) return false;
  if (category === 'all') return true;
  if (category === 'favorite') return entry.user.favorite;
  return entry.kind === category;
}

export function countByCategory(entries: readonly SpaceEntry[]): Record<SpaceCategory, number> {
  const counts = Object.fromEntries(SPACE_CATEGORIES.map((c) => [c.key, 0])) as Record<SpaceCategory, number>;
  for (const entry of entries) {
    for (const { key } of SPACE_CATEGORIES) if (inCategory(entry, key)) counts[key]++;
  }
  return counts;
}

/** 有条目的类型才在侧栏里出现；全部、收藏、回收站总在。 */
export function visibleCategories(counts: Record<SpaceCategory, number>) {
  return SPACE_CATEGORIES.filter((c) => c.group === 'mine' || c.key === 'all' || counts[c.key] > 0);
}

/** 状态（产品设计 §4.4、原型 model-space.js 的 STATUS）：字与 StatusLight 的色调。 */
type StatusTone = 'informative' | 'notice' | 'positive' | 'negative';
const status = (key: SpaceEntryStatus, tone: StatusTone) => ({
  get label() {
    return M.status[key];
  },
  tone,
});
export const SPACE_STATUS: Record<SpaceEntryStatus, { label: string; tone: StatusTone }> = {
  generating: status('generating', 'informative'),
  candidate: status('candidate', 'notice'),
  applied: status('applied', 'positive'),
  published: status('published', 'positive'),
  'source-changed': status('source-changed', 'notice'),
  missing: status('missing', 'negative'),
  failed: status('failed', 'negative'),
};

/** 「状态」筛选（原型 page-space.jsx）：全部状态、每一种状态、无状态。 */
export type SpaceStatusFilter = 'any' | SpaceEntryStatus | 'none';
export const SPACE_STATUS_FILTERS: { key: SpaceStatusFilter; label: string }[] = [
  {
    key: 'any',
    get label() {
      return M.statusAny;
    },
  },
  ...(Object.keys(SPACE_STATUS) as SpaceEntryStatus[]).map((key) => ({
    key,
    get label() {
      return SPACE_STATUS[key].label;
    },
  })),
  {
    key: 'none',
    get label() {
      return M.statusNone;
    },
  },
];

/** 状态那一列与卡片角上的字：生成中带进度（原型 statusText）；没有状态时 null。 */
export function statusText(entry: Pick<SpaceEntry, 'status' | 'statusDetail'>): string | null {
  if (!entry.status) return null;
  const label = SPACE_STATUS[entry.status].label;
  const progress = entry.status === 'generating' ? entry.statusDetail?.progress : undefined;
  if (progress && progress.total) return `${label} · ${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`;
  return label;
}

/**
 * 条目归哪个项目：下载转录以显式项目归属为准，独立于保存路径。其他 bytes 在项目目录里的看来源；不在来源目录里的产物与占位（来源两项都是 null）看 `origin.projectId`
 * （架构设计 §5.7；`space.list` 的 `projectId` 筛选同样看两处）。不属于任何项目时 null。
 */
export function entryProjectId(entry: Pick<SpaceEntry, 'source' | 'origin'>): Id | null {
  return (entry.origin?.capability === 'link-import' ? entry.origin.projectId : entry.source.projectId ?? entry.origin?.projectId) ?? null;
}

export interface SpaceQuery {
  category: SpaceCategory;
  /** 项目 id；'none' 表示不属于任何项目。 */
  projectId: Id | 'none' | null;
  search: string;
  sort: SpaceSort;
  /** 状态筛选；不给时不按状态筛。 */
  status?: SpaceStatusFilter;
}

export function viewEntries(entries: readonly SpaceEntry[], query: SpaceQuery): SpaceEntry[] {
  const q = query.search.trim().toLowerCase();
  const status = query.status ?? 'any';
  const rows = entries.filter((entry) => {
    const project = entryProjectId(entry);
    return (
      inCategory(entry, query.category) &&
      (query.projectId === null || (query.projectId === 'none' ? project === null : project === query.projectId)) &&
      (status === 'any' || (status === 'none' ? entry.status === null : entry.status === status)) &&
      (!q || entry.name.toLowerCase().includes(q) || entry.relPath.toLowerCase().includes(q))
    );
  });
  const recent = (a: SpaceEntry, b: SpaceEntry) => b.lastActivityAt.localeCompare(a.lastActivityAt);
  return rows.sort((a, b) => {
    if (query.sort === 'name') return a.name.localeCompare(b.name, intlLocale()) || recent(a, b);
    if (query.sort === 'kind') return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || recent(a, b);
    return recent(a, b);
  });
}

/** 「项目」筛选的选项：条目里出现过的项目（按名称），有不属于项目的条目时末尾加一项。 */
export function projectOptions(entries: readonly SpaceEntry[], projects: readonly { id: Id; name: string }[]) {
  const seen = new Set(entries.map(entryProjectId));
  const options = projects
    .filter((p) => seen.has(p.id))
    .map((p) => ({ key: p.id as string, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label, intlLocale()));
  if (seen.has(null)) options.push({ key: 'none', label: M.noProject });
  return options;
}

/**
 * 「时长或尺寸」一列（原型 sizeText）：视频类写时长与画面尺寸，音频写时长，图片写尺寸。Runtime 没给媒体信息时为 null，
 * 界面退回写文件大小。
 */
export function measureText(entry: Pick<SpaceEntry, 'kind' | 'media'>): string | null {
  const media = entry.media;
  if (!media) return null;
  const duration = media.durationSec && media.durationSec > 0 ? formatClock(media.durationSec) : null;
  const frame = media.width && media.height ? `${media.width}×${media.height}` : null;
  const parts = entry.kind === 'audio' ? [duration] : entry.kind === 'image' ? [frame] : [duration, frame];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/** 文件大小：「512 B」「1.2 MB」。 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** 预览方式：媒体元素、纯文本，或在 BaoCut 里还不能预览。 */
export function previewKind(entry: Pick<SpaceEntry, 'kind' | 'fileName'>): 'image' | 'video' | 'audio' | 'text' | 'markdown' | 'pdf' | 'html' | 'table' | 'json' | null {
  const ext = entry.fileName.slice(entry.fileName.lastIndexOf('.') + 1).toLowerCase();
  if (entry.kind === 'image') return ext === 'heic' ? null : 'image';
  if (entry.kind === 'video-file') return ext === 'mkv' || ext === 'avi' ? null : 'video';
  if (entry.kind === 'audio') return 'audio';
  if (entry.kind === 'subtitle') return 'text';
  if (entry.kind === 'document') return documentPreview(entry.fileName) ?? (isPlainText(entry.fileName) || ext === 'txt' ? 'text' : null);
  return null;
}

/** 用播放器打开的文件：视频与音频。AVI 浏览器放不了；MKV 能不能放看编码，放不了时播放器如实说。 */
export function isPlayable(fileName: string): boolean {
  const kind = kindOfFileName(fileName);
  return kind === 'audio' || (kind === 'video-file' && !/\.avi$/i.test(fileName));
}

const KIND_BY_EXT: Record<string, SpaceEntryKind> = {};
for (const [kind, exts] of [
  ['video-file', ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'avif']],
  ['audio', ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']],
  ['subtitle', ['srt', 'vtt', 'ass', 'ssa']],
  ['document', ['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'html', 'htm', 'csv', 'tsv', 'json']],
] as [SpaceEntryKind, string[]][]) {
  for (const ext of exts) KIND_BY_EXT[ext] = kind;
}

/** 与 Runtime 的 Space 分类同一张表；会话里改过的文件也按它决定怎么预览。 */
export function kindOfFileName(fileName: string): SpaceEntryKind | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (KIND_BY_EXT[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

/** 不在 Space 分类里的文本文件（代码、配置）在会话的文件查看器里按纯文本看。 */
const TEXT_EXTS = new Set([
  'json',
  'txt', 'md', 'markdown', 'tsv', 'htm', 'c', 'h', 'cpp', 'hpp', 'java', 'kt', 'swift', 'sql', 'ini', 'conf', 'scss', 'vue', 'svelte', 'rb', 'php', 'ipynb',
  'js',
  'ts',
  'tsx',
  'jsx',
  'css',
  'html',
  'py',
  'sh',
  'yml',
  'yaml',
  'toml',
  'csv',
  'xml',
  'log',
  'rs',
  'go',
]);
export function isPlainText(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 && TEXT_EXTS.has(fileName.slice(dot + 1).toLowerCase());
}

type SourceDirs = {
  projects: readonly { id: Id; name: string; path: string }[];
  conversations: readonly { id: Id; title: string; cwd: string }[];
};

/**
 * 条目在磁盘上的位置：来源目录（项目目录或会话工作目录）加相对路径；不在来源目录里时是结果写到的文件（`entry.file`，
 * 保存位置里的发布文件与副本）。都没有时为 null。
 */
export function entryPath(entry: SpaceEntry, dirs: SourceDirs): string | null {
  const { projectId, conversationId } = entry.source;
  const root = projectId
    ? dirs.projects.find((p) => p.id === projectId)?.path
    : conversationId
      ? dirs.conversations.find((c) => c.id === conversationId)?.cwd
      : undefined;
  return root ? `${root.replace(/\/+$/, '')}/${entry.relPath}` : (entry.file?.path ?? null);
}

/**
 * 「来源」一列（原型 sourceText：项目 · 视频）：项目名，或不属于项目的那个会话；文件不在来源目录顶层时带上子目录。
 * 不在来源目录里的产物与占位按 `origin` 写：所属项目（或产生它的会话）与产生它的视频（`videoNames` 里有时）。
 */
export function sourceLabel(entry: SpaceEntry, dirs: SourceDirs, untitled: string, videoNames?: ReadonlyMap<Id, string>): string {
  const { projectId, conversationId } = entry.source;
  const projectName = (id: Id) => dirs.projects.find((p) => p.id === id)?.name ?? M.removedProject;
  const conversationName = (id: Id | null | undefined) => M.conversation(dirs.conversations.find((c) => c.id === id)?.title || untitled);
  if (!projectId && !conversationId) {
    const origin = entry.origin;
    const owner = origin?.projectId
      ? projectName(origin.projectId)
      : origin?.conversationId
        ? conversationName(origin.conversationId)
        : M.noProject;
    const video = origin?.videoId ? videoNames?.get(origin.videoId) : undefined;
    return video ? `${owner} · ${video}` : owner;
  }
  const owner = projectId ? projectName(projectId) : conversationName(conversationId);
  const slash = entry.relPath.lastIndexOf('/');
  return slash > 0 ? `${owner} · ${entry.relPath.slice(0, slash)}` : owner;
}

/** 视频条目的名字，按 videoId 查（「来源」一列写产物来自哪个视频）。 */
export function videoNamesOf(entries: readonly SpaceEntry[]): Map<Id, string> {
  const names = new Map<Id, string>();
  for (const entry of entries) if (entry.ref && 'videoId' in entry.ref) names.set(entry.ref.videoId, entry.name);
  return names;
}

/** Space 里的视频条目用来打开它的定位：所在来源目录里的相对路径（与新建视频后的定位一致）。 */
export function videoTargetOf(entry: SpaceEntry): FileTarget {
  return entry.source.projectId
    ? { projectId: entry.source.projectId, path: entry.relPath }
    : { conversationId: entry.source.conversationId!, path: entry.relPath };
}

/**
 * 起始页「+ › 最近的视频」（原型 composer-insert-menu.jsx、BC_SPACE.recentMovies）：最近活动的几部视频，新的在前。
 * 只列放在项目目录里的（会话就建在那个项目里，智能体才能读写它）；回收站里的与缺失的不列。`projects` 是还能选的项目。
 */
export function recentVideos(entries: readonly SpaceEntry[], projects: readonly Id[], max = 8): SpaceEntry[] {
  const open = new Set(projects);
  return entries
    .filter(
      (e) =>
        e.kind === 'video' &&
        !e.user.trashedAt &&
        e.status !== 'missing' &&
        !!e.ref &&
        'videoId' in e.ref &&
        !!e.source.projectId &&
        open.has(e.source.projectId),
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, max);
}
