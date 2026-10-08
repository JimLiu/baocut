import type { Id, SpacePurgeResult, SpaceContinueResult, VideoDeleteResult } from '@baocut/protocol';
import { M } from './space-copy.ts';

/**
 * `baocut space` 管理命令的参数与输出（架构设计 §5.7、§5.11）。列出与检索是派生命令（`space list|search`）。
 * 参数是否合法最终由 Runtime 判断；这里只把命令行整理成 `space.*` 的参数，给出可读的用法错误。
 */

export interface SpaceFlags {
  conversation?: string | undefined;
}

export type SpaceCommand =
  | { kind: 'rescan' }
  | { kind: 'rebuild' }
  | { kind: 'trash' | 'restore' | 'purge' | 'delete-video'; entryId: Id }
  | { kind: 'continue'; entryId: Id; conversationId?: Id };

function only(action: string, flags: SpaceFlags, allowed: (keyof SpaceFlags)[]): void {
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined && value !== false && !allowed.includes(key as keyof SpaceFlags)) {
      throw new Error(`${M.flagNotAccepted(action, key)}\n${M.usage}`);
    }
  }
}

export function parseSpaceArgs(args: string[], flags: SpaceFlags): SpaceCommand {
  const [action, ...rest] = args;
  if (action === 'rescan' || action === 'rebuild') {
    if (rest.length > 0) throw new Error(M.usage);
    only(action, flags, []);
    return { kind: action };
  }
  if (action === 'trash' || action === 'restore' || action === 'purge' || action === 'delete-video') {
    const [entryId, ...extra] = rest;
    if (!entryId || extra.length > 0) throw new Error(M.entryUsage(action));
    only(action, flags, []);
    return { kind: action, entryId };
  }
  if (action === 'continue') {
    const [entryId, ...extra] = rest;
    if (!entryId || extra.length > 0) throw new Error(M.continueUsage);
    only(action, flags, ['conversation']);
    return { kind: 'continue', entryId, ...(flags.conversation !== undefined ? { conversationId: flags.conversation } : {}) };
  }
  throw new Error(M.usage);
}

export function formatSpacePurge(result: SpacePurgeResult): string[] {
  if (result.status === 'purged') return [M.purged(result.entryId)];
  return [M.notPurged(result.entryId), ...result.references.map((r) => `  ${r.detail}`)];
}

/** 删除视频：回收站里的新条目 id，以及由它导出、生成而留在原处的条目数。 */
export function formatVideoDelete(result: VideoDeleteResult, retentionDays: number | null): string[] {
  const lines = [M.videoTrashed(result.name, result.entryId, retentionDays)];
  if (result.related.length > 0) lines.push(M.relatedKept(result.related.length));
  return lines;
}

/** 从条目继续会话：会话 id 与工作目录；引用随下一条消息带上。 */
export function formatSpaceContinue(result: SpaceContinueResult): string[] {
  return [
    M.continued(result.created, result.conversation.id, result.conversation.cwd),
    M.referenceNext(result.reference.name, result.conversation.id),
  ];
}
