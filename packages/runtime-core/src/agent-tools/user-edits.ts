import { contextBlock } from '@baocut/harness';
import { localizeText, type EditorContext, type HistoryEntry } from '@baocut/protocol';

/** 一段里最多列几笔，其余只报个数。 */
const MAX_LISTED = 10;

/**
 * 用户上一条消息之后在编辑器里亲手做的修改（架构设计 §3.4 `<baocut-user-edits>`）：人和智能体共用一个编辑器，
 * 智能体下一轮开工前该知道用户动过什么。只在两条消息都带着同一部视频的编辑器上下文、版本又变了时才有。
 *
 * `entries` 是这部视频的修改记录，新的在前（`history.list`）；`complete` 表示这就是全部记录、没被截断。从最新的往回走到
 * 上一条消息时用户看到的版本为止，只留操作者是用户的；智能体自己的与系统的修改不列。全部记录走到头也算走到了（那时的版本
 * 是还没有任何修改的初始版本）；截断了又走不到时不附，编辑器上下文已经提醒先读当前版本。
 */
export function userEditsBlock(
  previous: EditorContext | undefined,
  current: EditorContext | undefined,
  entries: readonly HistoryEntry[],
  complete: boolean,
): string {
  if (!previous || !current || previous.videoId !== current.videoId || previous.revision === current.revision) return '';
  const since: HistoryEntry[] = [];
  let reached = complete;
  for (const entry of entries) {
    if (entry.videoRevision === previous.revision) {
      reached = true;
      break;
    }
    if (entry.actor.kind === 'user') since.push(entry);
  }
  if (!reached || since.length === 0) return '';
  const lines = [
    `Since the user's previous message they changed the video ${JSON.stringify(current.videoName)} (videoId: ${current.videoId}) by hand in the BaoCut editor. Their changes, newest first:`,
    ...since.slice(0, MAX_LISTED).map((entry) => {
      const notes = [`revision ${entry.videoRevision}`, ...(entry.undoneBy ? ['later undone'] : [])];
      return `- ${localizeText(entry.label, entry.labelRef)} (${notes.join(', ')})`;
    }),
    ...(since.length > MAX_LISTED ? [`- …and ${since.length - MAX_LISTED} earlier changes`] : []),
    'Build on these changes: read the current version with videos_inspect before editing, and do not redo or revert them unless the user asks.',
  ];
  return contextBlock('<baocut-user-edits>', lines, '</baocut-user-edits>');
}
