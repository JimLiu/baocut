import { live, type Id, type SpaceEntry, type SpaceEntryReference, type SpaceReference } from '@baocut/protocol';
import { KIND_LABEL, kindOfFileName } from './space.ts';
import { M } from './space-actions-copy.ts';

/**
 * Space 条目上的动作能不能做、做不了时为什么（产品设计 §4.6、§4.7、§4.9；架构设计 §5.5、§5.7）。
 * 做不了的按钮置灰并写一句真实原因（照 tools-gallery 的 plannedReason），不假装做了。
 */

/**
 * 二次编辑的去处（产品设计 §4.6、原型 model-space.js 的 editRoute）：
 * 视频直接进编辑器；有来源视频的成片与产物回到来源视频；成片或视频素材没有来源视频时以它为素材新建视频；
 * 字幕、文档改文字；图片、音频、模板另存一份再改。视频包（便携包）没有二次编辑。
 * 只是按条目猜的去处，真正去哪里由 `space.openForEdit` 回答。
 */
export type EditRoute = 'video' | 'source-video' | 'new-video' | 'text' | 'version';

export function editRoute(entry: Pick<SpaceEntry, 'kind' | 'origin'>): EditRoute | null {
  if (entry.kind === 'video') return 'video';
  if (entry.origin?.videoId) return 'source-video';
  if (entry.kind === 'export' || entry.kind === 'video-file') return 'new-video';
  if (entry.kind === 'subtitle' || entry.kind === 'document') return 'text';
  if (entry.kind === 'image' || entry.kind === 'audio' || entry.kind === 'template') return 'version';
  return null;
}

export const EDIT_LABEL: Record<EditRoute, string> = live(() => M.edit);

/** 失败的生成占位：没有文件，只能清除（`space.purge` 直接清掉）。 */
export function isFailedPlaceholder(entry: Pick<SpaceEntry, 'status' | 'ref'>): boolean {
  return entry.status === 'failed' && !!entry.ref && 'jobId' in entry.ref;
}

/** 条目对应的任务：占位的任务，或生成、导出它的任务（任务页按 jobId 也能定位）。 */
export function entryJobId(entry: Pick<SpaceEntry, 'ref' | 'origin'>): Id | null {
  if (entry.ref && 'jobId' in entry.ref) return entry.ref.jobId;
  return entry.origin?.jobId ?? null;
}

/** 条目来自哪个会话：bytes 在会话工作目录里的看来源，产物看 `origin`。 */
export function entryConversationId(entry: Pick<SpaceEntry, 'source' | 'origin'>): Id | null {
  return entry.source.conversationId ?? entry.origin?.conversationId ?? null;
}

/** 状态挡住的编辑：回收站、生成中、缺失、失败。没挡住时 null。 */
function stateBlock(entry: Pick<SpaceEntry, 'status' | 'user'>): string | null {
  if (entry.user.trashedAt) return M.trashed;
  if (entry.status === 'generating') return M.editGenerating;
  if (entry.status === 'missing') return M.editMissing;
  if (entry.status === 'failed') return M.editFailed;
  return null;
}

/**
 * 二次编辑为什么做不了；能做时 null。`path` 是条目在磁盘上的绝对路径（只有来源目录里的文件才知道）。
 * - 字幕、文档：Runtime 还没有保存新版本的命令（产物不可变，不能覆盖原条目）。
 * - 图片、音频、模板：手工修改还没有开放（模型辅助修改是 P1）。
 * - 以它为素材新建视频：要导入文件的路径；不在项目或会话目录里的产物（Artifact Store、目录之外的导出）界面拿不到路径。
 */
export function editBlock(entry: Pick<SpaceEntry, 'kind' | 'origin' | 'status' | 'user' | 'source'>, path: string | null): string | null {
  const route = editRoute(entry);
  if (!route) return M.editPackage;
  const blocked = stateBlock(entry);
  if (blocked) return blocked;
  if (route === 'text') return M.editText;
  if (route === 'version') return M.editVersion;
  if (route === 'new-video' && (!path || (!entry.source.projectId && !entry.source.conversationId))) {
    return M.newVideoOutside;
  }
  return null;
}

/**
 * 便携包「打开成新视频」为什么做不了（架构设计 §5.8 `videos.importPackage`）；能做时 null。
 * 新视频建在包所在的项目或会话工作目录里，所以要知道包在磁盘上的路径和它属于哪个目录。
 */
export function packageBlock(entry: Pick<SpaceEntry, 'status' | 'user' | 'source'>, path: string | null): string | null {
  if (entry.user.trashedAt) return M.trashed;
  if (entry.status === 'generating') return M.packageGenerating;
  if (entry.status === 'missing') return M.packageMissing;
  if (entry.status === 'failed') return M.packageFailed;
  if (!path || (!entry.source.projectId && !entry.source.conversationId)) return M.packageOutside;
  return null;
}

/** 包所在的目录：新视频建在这里（`videos.importPackage` 要 projectId 或 conversationId 其中一个）。 */
export function packageScope(entry: Pick<SpaceEntry, 'source'>): { projectId: Id } | { conversationId: Id } | null {
  if (entry.source.projectId) return { projectId: entry.source.projectId };
  if (entry.source.conversationId) return { conversationId: entry.source.conversationId };
  return null;
}

/** 「在会话中继续」为什么做不了（产品设计 §4.7：回收站里的条目要先恢复才能带入）。 */
export function continueBlock(entry: Pick<SpaceEntry, 'user'>): string | null {
  return entry.user.trashedAt ? M.continueTrashed : null;
}

/**
 * 「彻底删除」为什么做不了（架构设计 §5.5）：只删回收站里的条目；失败的占位直接清除；生成中的先取消任务。
 * 被引用时 Runtime 拒绝并列出引用，那要等调用之后才知道。
 */
export function purgeBlock(entry: Pick<SpaceEntry, 'status' | 'user' | 'ref'>): string | null {
  if (entry.status === 'generating') return M.purgeGenerating;
  if (isFailedPlaceholder(entry)) return null;
  if (!entry.user.trashedAt) return M.purgeNotTrashed;
  return null;
}

/** 阻止删除的引用的种类（架构设计 §5.5 的引用图）。 */
export const REFERENCE_KIND_LABEL: Record<SpaceReference['kind'], string> = live(() => M.referenceKind);

/** 删除视频时一起列出的条目（产品设计 §4.9）：由它导出、生成的条目留在 Space 里。 */
export function relatedEntries(entries: readonly SpaceEntry[], videoId: Id): SpaceEntry[] {
  return entries.filter((entry) => entry.kind !== 'video' && entry.origin?.videoId === videoId && !entry.user.trashedAt);
}

/** 视频条目的 videoId；不是视频或还没打开过（没有 ref）时 null。 */
export function videoIdOf(entry: Pick<SpaceEntry, 'ref'>): Id | null {
  return entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : null;
}

/** 导入素材后的一句话：几个成功（几个复制进了 imports/）、几个失败。 */
export function importSummary(results: readonly ({ ok: true; copied: boolean } | { ok: false; error: string })[]): {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
} {
  const ok = results.filter((r): r is { ok: true; copied: boolean } => r.ok);
  const failed = results.length - ok.length;
  const copied = ok.filter((r) => r.copied).length;
  if (!ok.length) {
    const first = results.find((r): r is { ok: false; error: string } => !r.ok);
    return { text: failed > 1 ? M.importAllFailed(failed, first?.error ?? '') : M.importFailed(first?.error ?? ''), tone: 'negative' };
  }
  const parts = [M.imported(ok.length)];
  if (copied) parts.push(copied === ok.length ? M.copiedAll : M.copiedSome(copied));
  if (failed) parts.push(M.notImported(failed));
  return { text: parts.join(' · '), tone: failed ? 'neutral' : 'positive' };
}

/** 放上时间线用的素材种类（`importAndPlace` 的 kind）：按扩展名分视频、音频、图片；别的文件放不上时间线时 null。 */
export function placeKindOf(fileName: string): 'video' | 'audio' | 'image' | null {
  const kind = kindOfFileName(fileName);
  return kind === 'video-file' ? 'video' : kind === 'audio' || kind === 'image' ? kind : null;
}

/**
 * 随消息带上的 Space 条目（架构设计 §5.7「从条目继续会话」）写成一行：已发消息下面那一行用。最多写出前两个名字。
 */
export function referencesText(refs: readonly Pick<SpaceEntryReference, 'name'>[]): string {
  return M.references(
    refs.slice(0, 2).map((ref) => ref.name),
    refs.length,
  );
}

/** 一个引用的说明（输入框上方标签的提示）：类型与位置；不在来源目录里的产物写「产物」。 */
export function referenceDescription(ref: Pick<SpaceEntryReference, 'kind' | 'relPath'>): string {
  return `${KIND_LABEL[ref.kind]} · ${ref.relPath ?? M.referenceOutput}`;
}

/** 路径里的文件名去掉扩展名：从文件新建视频时用作视频名。 */
export function videoNameOf(path: string): string {
  const file = path.split(/[\\/]/).pop() || path;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Space 列表与卡片的集合依赖键：react-aria 集合按条目对象缓存每项的渲染，条目没变时不重渲染。菜单里随别的数据变的部分
 * （转录动作看后到的候选与 `jobs`，「在文件夹中显示」看保存位置，表格的来源列看保存位置与视频名）写成一个字符串，变了才让缓存失效，不是每次渲染都失效。
 */
export function entryMenuKey(
  entries: readonly SpaceEntry[],
  canReveal: (entry: SpaceEntry) => boolean,
  transcribeAction: (entry: SpaceEntry) => string | null,
  sourceOf?: (entry: SpaceEntry) => string,
): string {
  return entries.map((e) => `${transcribeAction(e) ?? '-'}${canReveal(e) ? 'r' : ''}${sourceOf ? `:${sourceOf(e)}` : ''}`).join('\n');
}
