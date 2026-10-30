import type { ForkNote, Id, TimelineItem, VideoChange } from '@baocut/protocol';
import { contextBlock } from './context-tags.ts';

/*
 * 分叉（产品设计 §3.2.2「分叉」、架构设计 §3.4）里算出来的东西：截至哪一轮、带进去的记录、这条会话改过哪些视频。
 * 不分叉 Agent 的原生会话：只带用户与 Agent 说的话（同「在会话中查找」的口径），新会话第一次交给智能体时包成
 * `<baocut-fork-history>` 放在用户消息前面。
 */

/** 带进去的记录的总长上限（字符）。 */
export const FORK_HISTORY_LIMIT = 100_000;

export const FORK_HISTORY_TAG = 'baocut-fork-history';
const HEADER = 'Chat history from a previous BaoCut session.';
const OMITTED = '[Earlier messages omitted]';
const CUT = '[…]';

/**
 * 那一轮在记录里的位置：回合按任务第一次出现的位置算（同 `conversations.page`），`turn` 从 1 数，`end` 是下一轮开头（不含）。
 * 完成收件箱唤醒旧任务后接着写的条目落在后面的回合里，按位置截断就不会带进来。没有这个任务时 null。
 */
export function forkPoint(items: readonly TimelineItem[], taskId: Id): { turn: number; end: number } | null {
  const seen = new Set<Id>();
  let turn = 0;
  let found = false;
  for (let i = 0; i < items.length; i++) {
    const id = items[i]!.taskId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (found) return { turn, end: i };
    turn++;
    if (id === taskId) found = true;
  }
  return found ? { turn, end: items.length } : null;
}

/** 记录里截至 `end` 的分叉原文。`carried`：原会话自己是分叉出来的，上一次带进来的记录原样接着带。 */
export function forkHistory(
  items: readonly TimelineItem[],
  end: number,
  source: { title: string; folder: string | null; carried: string | null },
  limit = FORK_HISTORY_LIMIT,
): Pick<ForkNote, 'history' | 'turns' | 'omitted'> {
  const join = (lines: readonly string[]) => lines.join('\n');
  // 按回合分组：一轮是同一个任务里的用户消息与回复，按记录先后。
  const turns: string[][] = [];
  const index = new Map<Id, number>();
  for (const item of items.slice(0, end)) {
    if (item.kind !== 'user-message' && item.kind !== 'agent-message') continue;
    const text = item.text.trim();
    if (!text) continue;
    const key = item.taskId ?? '';
    let at = index.get(key);
    if (at === undefined) {
      at = turns.length;
      index.set(key, at);
      turns.push([]);
    }
    turns[at]!.push(`${item.kind === 'user-message' ? 'User' : 'Assistant'}: ${text}`);
  }
  const head = [HEADER, `Source session: ${source.title || 'Untitled'}`, ...(source.folder ? [`Source folder: ${source.folder}`] : [])];
  let carried = source.carried;
  let carriedCut = false;
  let kept = turns.map(join);
  let omitted = 0;
  const lines = () => [...head, ...(carriedCut ? [OMITTED] : []), ...(carried ? [carried] : []), ...(omitted ? [OMITTED] : []), ...kept];
  const total = () => join(lines()).length;
  // 超出时从最早的整轮开始略去，至少留下最近的一轮；还超出时从上一次带进来的记录开头按行截掉；最近一轮本身超长时截掉它的中间。
  let size = total();
  let first = 0;
  while (kept.length - first > 1 && size > limit) {
    size -= kept[first]!.length + 1 - (omitted ? 0 : OMITTED.length + 1);
    first++;
    omitted++;
  }
  kept = kept.slice(first);
  if (carried && total() > limit) {
    const from = carried.indexOf('\n', total() - limit + OMITTED.length);
    carried = from < 0 ? null : carried.slice(from + 1);
    carriedCut = true;
  }
  if (kept.length && total() > limit) {
    const last = kept[kept.length - 1]!;
    const room = Math.max(0, last.length - (total() - limit) - CUT.length - 2);
    const front = Math.ceil(room / 2);
    kept[kept.length - 1] = `${last.slice(0, front)}\n${CUT}\n${last.slice(last.length - (room - front))}`;
  }
  return { history: join(lines()), turns: kept.length, omitted };
}

/** 交给智能体的那一段：`ForkNote.history` 包上标签；正文里的 `<baocut-…>` 转义，不能冒充别的段。 */
export function forkHistoryBlock(note: Pick<ForkNote, 'history'>): string {
  return contextBlock(`<${FORK_HISTORY_TAG}>`, note.history.split('\n'), `</${FORK_HISTORY_TAG}>`);
}

/** 原会话自己顶上的分叉提示（再分叉时接着带它的原文）。 */
export function forkNoteOf(items: readonly TimelineItem[]): ForkNote | null {
  for (const item of items) {
    if (item.kind === 'notice' && item.fork) return item.fork;
    if (item.kind === 'user-message') return null;
  }
  return null;
}

/** 这条会话改过或建过的视频（「回到那时」的候选），按最后一次改动排，新的在前。 */
export interface TouchedVideo {
  videoId: Id;
  videoName: string;
  target: VideoChange['target'];
  /** 这条会话建它的时刻；不是它建的为 null。 */
  createdAt: string | null;
  lastChangeAt: string;
}

export function touchedVideos(items: readonly TimelineItem[]): TouchedVideo[] {
  const map = new Map<Id, TouchedVideo>();
  for (const item of items) {
    if (item.kind !== 'video-change' && item.kind !== 'video-created') continue;
    const prev = map.get(item.videoId);
    map.set(item.videoId, {
      videoId: item.videoId,
      videoName: item.videoName,
      target: item.target,
      createdAt: prev?.createdAt ?? (item.kind === 'video-created' ? item.createdAt : null),
      lastChangeAt: item.createdAt,
    });
  }
  return [...map.values()].sort((a, b) => b.lastChangeAt.localeCompare(a.lastChangeAt));
}
