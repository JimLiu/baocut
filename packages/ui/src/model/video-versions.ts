import {
  RpcError,
  intlLocale,
  isEngineErrorBody,
  localizeText,
  type DocumentRecord,
  type Id,
  type VideoSnapshotState,
  type VideoSnapshotStatus,
  type VideoVersion,
  type VideoVersionAction,
  type VideoVersionFile,
  type VideoVersionKind,
  type VideoVersionList,
} from '@baocut/protocol';
import { VIDEO_VERSIONS_COPY as C } from '../components/editor/video-versions-copy.ts';

/**
 * 视频的版本记录（视频格式规范 §9、版本记录设计 §6，原型 model-video-versions.js）：列表行、能不能回到、事先能看出的
 * 「回到之后没有改动」、执行者与文件的显示名、diff 的切分。纯函数，对话框在 components/editor/video-versions.tsx。
 *
 * 版本从 `videos.versions.list` 来（新的在前）；读不出头部的版本文件只给序号（`unreadable`）。回到版本要从最新一版逆着走过
 * 比目标新的每一版，路上读不出的、或上次回到时引擎报出的断点（`VERSION_CHAIN_BROKEN` 的 `brokenAt`）都挡路。
 */

export type VersionRow =
  | { version: number; unreadable: true; top: boolean; blocked: true }
  | { version: number; unreadable: false; item: VideoVersion; top: boolean; blocked: boolean };

export type Reach = { ok: true } | { ok: false; reason: 'not-found' | 'unreadable' | 'broken'; at: number };

/** 列表行：版本与读不出的序号按序号合在一起，新的在前。两种回到都走不通的标成回不去。 */
export function versionRows(list: VideoVersionList, brokenAt: number | null): VersionRow[] {
  const rows: VersionRow[] = [
    ...list.versions.map((item) => {
      const blocked = !reach(list, brokenAt, item.version, false).ok && !reach(list, brokenAt, item.version, true).ok;
      return { version: item.version, unreadable: false as const, item, top: false, blocked };
    }),
    ...list.unreadable.map((version) => ({ version, unreadable: true as const, top: false, blocked: true as const })),
  ];
  rows.sort((a, b) => b.version - a.version);
  if (rows[0]) rows[0].top = true;
  return rows;
}

/** 回到版本 `version` 结束时（`before` 为真时是开始之前）走不走得通（§9.5）。 */
export function reach(list: VideoVersionList, brokenAt: number | null, version: number, before: boolean): Reach {
  const unreadable = list.unreadable;
  if (!list.versions.some((v) => v.version === version) && !unreadable.includes(version)) return { ok: false, reason: 'not-found', at: version };
  if (!before && unreadable.includes(version)) return { ok: false, reason: 'unreadable', at: version };
  const blockers = brokenAt === null ? unreadable : [...unreadable, brokenAt];
  const hits = blockers.filter((k) => (before ? k >= version : k > version));
  if (!hits.length) return { ok: true };
  const at = Math.max(...hits);
  return { ok: false, reason: unreadable.includes(at) ? 'unreadable' : 'broken', at };
}

/** 一行说明为什么回不去；回得去时 null。 */
export function blockedText(r: Reach): string | null {
  if (r.ok) return null;
  if (r.reason === 'not-found') return C.whyNotFound;
  return r.reason === 'unreadable' ? C.whyUnreadable(r.at) : C.whyBroken(r.at);
}

/**
 * 事先就能看出回到之后与现在相同（§9.5：相同时不提交、不产生版本）：快照已同步，且要逆着走过的每一版 diff 都是空的。
 * 看不出来的照常提交，引擎发现相同时返回没有回执，对话框再说「没有改动」。
 */
export function predictNoop(list: VideoVersionList, state: VideoSnapshotState | null, version: number, before: boolean): boolean {
  if (state !== 'synced') return false;
  const passes = (n: number) => (before ? n >= version : n > version);
  if (list.unreadable.some(passes)) return false;
  return list.versions.filter((v) => passes(v.version)).every((v) => v.files.length === 0);
}

/** 版本的标题：保存的版本是它的名字，别的是引擎写的摘要（按当前语言显示）。 */
export function versionTitle(v: VideoVersion): string {
  if (v.kind === 'save' && v.name) return v.name;
  return localizeText(v.summary, v.summaryRef);
}

export function kindLabel(kind: VideoVersionKind): string {
  if (kind === 'save') return C.kindSave;
  if (kind === 'restore') return C.kindRestore;
  if (kind === 'external') return C.kindExternal;
  if (kind === 'rebuild') return C.kindRebuild;
  return C.kindSegment;
}

export type ActorKind = 'user' | 'agent' | 'external' | 'system';

/** 操作者 ID（§9.4 `Action`）的种类：`user_local`、`agent:<会话>`、`external:<服务>`，其余是 BaoCut 自己（`system:*`）。 */
export function actorKind(actor: string): ActorKind {
  if (actor === 'user_local' || actor.startsWith('user')) return 'user';
  if (actor.startsWith('agent:')) return 'agent';
  if (actor.startsWith('external:')) return 'external';
  return 'system';
}

export function actorLabel(actor: string): string {
  const kind = actorKind(actor);
  if (kind === 'user') return C.actorYou;
  if (kind === 'agent') return C.actorAgent;
  if (kind === 'external') return C.actorExternal(actor.slice('external:'.length));
  return C.actorSystem;
}

export interface ActorGroup {
  key: string;
  kind: ActorKind;
  label: string;
  items: string;
}

/** 「谁改的」：同一类执行者的动作放在一起（按首次出现的顺序），动作写成「裁切片段 ×5、修改文字」。 */
export function actorGroups(actions: readonly VideoVersionAction[]): ActorGroup[] {
  const groups: { key: string; kind: ActorKind; label: string; items: string[] }[] = [];
  for (const action of actions) {
    const label = actorLabel(action.actor);
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { key: action.actor, kind: actorKind(action.actor), label, items: [] };
      groups.push(group);
    }
    group.items.push(C.actionCount(localizeText(action.label, action.labelRef), action.count));
  }
  return groups.map((g) => ({ ...g, items: g.items.join(C.listSeparator) }));
}

/** 列表里的「谁改的」：执行者的显示名连起来。 */
export function actorsText(v: VideoVersion): string {
  return actorGroups(v.actions)
    .map((g) => g.label)
    .join(C.listSeparator);
}

/** 快照里的文件（相对 `.bcut-snapshot/`）给人看的名字：`video.json` 是时间线，`documents/<id>.json` 是那份文档。 */
export function fileLabel(path: string, documents: Readonly<Record<Id, DocumentRecord>>): string {
  if (path === 'video.json') return C.fileTimeline;
  const doc = /^documents\/(.+)\.json$/.exec(path);
  if (doc) return documents[doc[1]!]?.name || C.fileDocument;
  return path;
}

export type FileChange = 'add' | 'delete' | 'modify';

export function fileChange(file: Pick<VideoVersionFile, 'before' | 'after'>): FileChange {
  if (file.before === null) return 'add';
  if (file.after === null) return 'delete';
  return 'modify';
}

export function changeLabel(change: FileChange): string {
  if (change === 'add') return C.changeAdd;
  if (change === 'delete') return C.changeDelete;
  return C.changeModify;
}

/** 版本文件在视频目录里的位置（相对 `.bcut-snapshot/`，§9.4）。 */
export function versionFileName(version: number): string {
  return `history/${String(version).padStart(6, '0')}.patch`;
}

const dateTime = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/** 一个时刻：「2026年10月17日 09:41」。 */
export function momentText(iso: string): string {
  return dateTime().format(new Date(iso));
}

/** 这一版的时间段：开始与结束在同一分钟只写一个时刻，同一天只写一次日子（`formatRange` 按语言处理）。 */
export function rangeText(startedAt: string, updatedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(updatedAt);
  if (Math.floor(start.getTime() / 60_000) >= Math.floor(end.getTime() / 60_000)) return dateTime().format(start);
  return dateTime().formatRange(start, end);
}

export type SnapshotTone = 'positive' | 'informative' | 'negative' | 'neutral';

type StatusLike = Pick<VideoSnapshotStatus, 'state' | 'conflict'>;

/**
 * 快照与视频库的关系（§9.7，`videos.versions.status`）：状态灯的文字、颜色与页脚的说明。冲突按原因分开说
 * （两边都改了 / 快照读不出）；`external` 是只有快照被改、Runtime 正在导入，通常不到一秒。
 */
export function snapshotState(status: StatusLike): { label: string; tone: SnapshotTone; desc: string } {
  const { state } = status;
  if (state === 'pending') return { label: C.statePending, tone: 'informative', desc: C.statePendingDesc };
  if (state === 'external') return { label: C.stateExternal, tone: 'informative', desc: C.stateExternalDesc };
  if (state === 'conflict' && status.conflict === 'invalid') return { label: C.stateInvalid, tone: 'negative', desc: C.stateInvalidDesc };
  if (state === 'conflict') return { label: C.stateConflict, tone: 'negative', desc: C.stateConflictDesc };
  if (state === 'missing') return { label: C.stateMissing, tone: 'neutral', desc: C.stateMissingDesc };
  if (state === 'rebuild') return { label: C.stateRebuild, tone: 'informative', desc: C.stateRebuildDesc };
  return { label: C.stateSynced, tone: 'positive', desc: C.stateSyncedDesc };
}

/** 视频栏版本记录按钮的提示：当前修订，最新是第几版，快照不是已同步时带上状态（视频栏只有这一个历史入口，产品设计 §5.1）。 */
export function buttonTip(inProject: boolean, status: (StatusLike & { latestVersion?: number }) | null, revision: string | null = null): string {
  const head = revision === null ? [C.title] : [C.title, C.tipRevision(revision)];
  if (!inProject) return [...head, C.tipOutside].join(' · ');
  const parts = head;
  if (status) {
    parts.push(status.latestVersion ? C.tipLatest(status.latestVersion) : C.tipNone);
    if (status.state !== 'synced') parts.push(snapshotState(status).label);
  }
  return parts.join(' · ');
}

/** 自动导入外部改动的操作者（§9.8）：Runtime 发现快照被外部改过、导入成一笔「外部变更」时用它，用户选「用磁盘上的」也是它。 */
export const IMPORT_ACTOR = 'system:history';

/** 视频事件是不是一次外部改动的导入：操作者是 `system:history`、不是撤销。 */
export function isImportChange(change: { actorId?: string | undefined; undoOf?: string | undefined } | null): boolean {
  return change?.actorId === IMPORT_ACTOR && !change.undoOf;
}

export type ResolveKeep = 'video' | 'snapshot';

/**
 * 冲突时两个选择的确认（§9.8 `videos.versions.resolve`）：写明各自丢掉什么。保留 BaoCut 里的立即覆盖磁盘上被改过或读不出的
 * 那些文件，它们不进版本记录；用磁盘上的把视频换成快照、记成一个「外部变更」版本，BaoCut 里还没写进快照的修改先记进版本记录。
 */
export function resolveAsk(
  keep: ResolveKeep,
  status: Pick<VideoSnapshotStatus, 'conflict' | 'changedPaths'>,
  documents: Readonly<Record<Id, DocumentRecord>>,
): { title: string; body: string; confirm: string; destructive: boolean } {
  const paths = status.changedPaths ?? [];
  const files = paths.map((p) => fileLabel(p, documents)).join(C.listSeparator);
  if (keep === 'video') {
    return { title: C.keepTitle, body: C.keepBody(paths.length, files, status.conflict === 'invalid'), confirm: C.keepConfirm, destructive: true };
  }
  return { title: C.diskTitle, body: C.diskBody(files), confirm: C.diskConfirm, destructive: false };
}

export interface DiffLine {
  sign: '+' | '-' | ' ' | '\\';
  text: string;
}
export interface DiffHunk {
  head: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  change: FileChange;
  hunks: DiffHunk[];
  plus: number;
  minus: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * 把版本文件里的 unified diff（引擎 line_diff.rs 写的：`a/`、`b/` 前缀，不存在的一侧 `/dev/null`）切成文件与 hunk。
 * 按 hunk 头里的行数取行，内容以 `---` 开头的删除行不会被当成下一个文件。读不懂的行跳过。
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const lines = text.split('\n');
  const files: DiffFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith('--- ') || !lines[i + 1]?.startsWith('+++ ')) {
      i++;
      continue;
    }
    const oldPath = line.slice(4).trim();
    const newPath = lines[i + 1]!.slice(4).trim();
    const strip = (p: string) => p.replace(/^[ab]\//, '');
    const file: DiffFile = {
      path: newPath === '/dev/null' ? strip(oldPath) : strip(newPath),
      change: oldPath === '/dev/null' ? 'add' : newPath === '/dev/null' ? 'delete' : 'modify',
      hunks: [],
      plus: 0,
      minus: 0,
    };
    files.push(file);
    i += 2;
    while (i < lines.length) {
      const match = HUNK.exec(lines[i]!);
      if (!match) break;
      let oldLeft = match[2] === undefined ? 1 : Number(match[2]);
      let newLeft = match[4] === undefined ? 1 : Number(match[4]);
      const hunk: DiffHunk = { head: lines[i]!, lines: [] };
      file.hunks.push(hunk);
      i++;
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i]!.startsWith('\\'))) {
        const row = lines[i]!;
        const sign = row[0];
        if (sign === '+') {
          newLeft--;
          file.plus++;
        } else if (sign === '-') {
          oldLeft--;
          file.minus++;
        } else if (sign === ' ' || row === '') {
          oldLeft--;
          newLeft--;
        } else if (sign !== '\\') break;
        hunk.lines.push({ sign: (sign === undefined ? ' ' : sign) as DiffLine['sign'], text: row.slice(1) });
        i++;
      }
    }
  }
  return files;
}

export interface VersionError {
  code: string | null;
  brokenAt: number | null;
  message: string;
}

/** 写操作被拒绝时的错误码、断点与说明（`RpcError.details` 是引擎错误体，或 Runtime 自己的 `{ code }`）。 */
export function versionError(error: unknown): VersionError {
  const details = error instanceof RpcError ? error.details : undefined;
  if (isEngineErrorBody(details)) {
    const brokenAt = (details.details as { brokenAt?: unknown } | null | undefined)?.brokenAt;
    return {
      code: details.code,
      brokenAt: typeof brokenAt === 'number' ? brokenAt : null,
      message: localizeText(details.message, details.messageRef),
    };
  }
  const code = (details as { code?: unknown } | undefined)?.code;
  const message = error instanceof RpcError ? localizeText(error.message, error.messageRef) : (error as Error).message;
  return { code: typeof code === 'string' ? code : null, brokenAt: null, message };
}
