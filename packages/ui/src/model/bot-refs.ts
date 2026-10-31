import type { ArtifactRef, FileTarget, Id, ResourceRef, SpaceEntry } from '@baocut/protocol';
import type { ConversationOutput } from './conversation-outputs.ts';
import { formatClock } from './format.ts';
import { kindOfFileName, videoTargetOf } from './space.ts';
import { entryOfTarget } from './workspace.ts';

/**
 * 任务的产物与资源画成卡片（BOT-VE-03、需求 §11.6 第 4 条）：把 `ResourceRef` / `ArtifactRef` 对到 Space 条目，换成会话产物卡
 * （`OutputCard`）认的 `ConversationOutput`。视频与视频片段是视频卡（缩略图、时长、状态，点了在功能区打开）；文件与 Space 条目
 * （导出的成片、生成的素材）是文件卡，在功能区的单文件标签里打开。消息、任务、文档 id 这几种不画卡，界面照旧写一行字。
 */

export interface RefDirs {
  projects: readonly { id: Id; path: string }[];
  conversations: readonly { id: Id; cwd: string }[];
}

/** Space 里这部视频的条目（按 videoId；回收站里的不算）。 */
export function videoEntryOf(entries: readonly SpaceEntry[], videoId: Id): SpaceEntry | undefined {
  return entries.find((e) => e.kind === 'video' && !e.user.trashedAt && !!e.ref && 'videoId' in e.ref && e.ref.videoId === videoId);
}

const isAbsolute = (path: string) => path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path);
const slashes = (path: string) => path.replace(/\\/g, '/');
const baseName = (path: string) => slashes(path).replace(/\/+$/, '').split('/').pop() || path;

/** `path` 在 `root` 下的相对路径（`/` 分隔）；不在它下面时 null。盘符路径不分大小写。 */
function under(root: string, path: string): string | null {
  const prefix = `${slashes(root).replace(/\/+$/, '')}/`;
  const file = slashes(path);
  const fold = /^[A-Za-z]:\//.test(prefix);
  const inside = fold ? file.toLowerCase().startsWith(prefix.toLowerCase()) : file.startsWith(prefix);
  return inside && file.length > prefix.length ? file.slice(prefix.length) : null;
}

/**
 * 文件资源的定位（技术方案 `ResourceRef.file`：绝对路径，或频道文件目录下的相对路径）。相对路径落在线程（没有线程时频道）会话的
 * 工作目录，也就是频道文件目录；绝对路径在这条会话或某个项目的目录里就相对它，否则找发布到保存位置的 Space 条目，
 * 再不行原样交给会话，由 Runtime 检查是不是在工作目录里。没有会话也对不上时 null。
 */
export function fileRefTarget(path: string, entries: readonly SpaceEntry[], dirs: RefDirs, conversationId: Id | null): FileTarget | null {
  if (!isAbsolute(path)) return conversationId ? { conversationId, path: slashes(path).replace(/^\.\//, '') } : null;
  const cwd = conversationId ? dirs.conversations.find((c) => c.id === conversationId)?.cwd : undefined;
  const local = cwd ? under(cwd, path) : null;
  if (conversationId && local) return { conversationId, path: local };
  for (const project of dirs.projects) {
    const rel = under(project.path, path);
    if (rel) return { projectId: project.id, path: rel };
  }
  const published = entries.find((e) => !e.user.trashedAt && e.file?.path === path);
  if (published) return { entryId: published.id };
  return conversationId ? { conversationId, path } : null;
}

/** 条目所在来源目录里的定位；只在索引文件夹里的没有（幻灯片、设计稿这些目录打不开）。 */
function sourceTarget(entry: SpaceEntry): FileTarget | null {
  if (entry.source.projectId) return { projectId: entry.source.projectId, path: entry.relPath };
  if (entry.source.conversationId) return { conversationId: entry.source.conversationId, path: entry.relPath };
  return null;
}

/** Space 条目画成什么卡：视频是视频卡；幻灯片、设计稿、设计系统、协作文档在各自的标签里打开；其余在单文件标签里打开。 */
function entryOutput(entry: SpaceEntry, label: string | null, target: FileTarget | null): ConversationOutput | null {
  const base = { kind: entry.kind, name: label ?? entry.name, video: null, entry, durationSeconds: null, at: '', taskId: null };
  const dir = sourceTarget(entry);
  switch (entry.kind) {
    case 'video': {
      const videoId = entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : entry.id;
      return { ...base, id: videoId, video: videoTargetOf(entry), durationSeconds: entry.media?.durationSec ?? null };
    }
    case 'slides':
      return dir ? { ...base, id: entry.id, slides: { target: dir, slideCount: null } } : null;
    case 'design':
      return dir ? { ...base, id: entry.id, design: { target: dir, boardCount: null } } : null;
    case 'design-system':
      return dir ? { ...base, id: entry.id, designSystem: { target: dir } } : null;
    case 'docs':
      return dir ? { ...base, id: entry.id, docs: { target: dir, tabCount: null } } : null;
    default:
      return { ...base, id: entry.id, file: { target: target ?? { entryId: entry.id } } };
  }
}

/**
 * 一条资源或产物画成的卡；不画卡的（消息、任务、文档 id，对不上位置的文件）返回 null。视频的名字依次取产物的 `label`、Space 条目名、
 * `untitled`；Space 里还没有这部视频时 `video` 为 null，卡上的画面与「打开编辑器」置灰。视频片段在名字后面写出起止时刻。
 */
export function refOutput(
  ref: ResourceRef | ArtifactRef,
  entries: readonly SpaceEntry[],
  dirs: RefDirs,
  conversationId: Id | null,
  untitled: string,
): ConversationOutput | null {
  const label = 'label' in ref && ref.label ? ref.label : null;
  switch (ref.kind) {
    case 'video':
    case 'video-range': {
      const entry = videoEntryOf(entries, ref.videoId) ?? null;
      const name = label ?? entry?.name ?? untitled;
      return {
        id: ref.videoId,
        kind: 'video',
        name: ref.kind === 'video-range' ? `${name} · ${formatClock(ref.startMs / 1000)}–${formatClock(ref.endMs / 1000)}` : name,
        video: entry ? videoTargetOf(entry) : null,
        entry,
        durationSeconds: entry?.media?.durationSec ?? null,
        at: '',
        taskId: null,
      };
    }
    case 'space': {
      const entry = entries.find((e) => e.id === ref.entryId && !e.user.trashedAt);
      return entry ? entryOutput(entry, label, null) : null;
    }
    case 'file': {
      const target = fileRefTarget(ref.path, entries, dirs, conversationId);
      if (!target) return null;
      const entry = entryOfTarget(entries, target);
      if (entry && !entry.user.trashedAt) return entryOutput(entry, label, target);
      const name = baseName(ref.path);
      return {
        id: ref.path,
        kind: kindOfFileName(name) ?? 'document',
        name: label ?? name,
        video: null,
        entry: null,
        durationSeconds: null,
        file: { target },
        at: '',
        taskId: null,
      };
    }
    default:
      return null;
  }
}
