import type { DocumentRecord, EditOperation, Id, Sequence } from '@baocut/protocol';

/**
 * 翻译配音收据上的「撤销这组配音」。Runtime 在一笔事务里应用一组配音（导入合成的音频、新增配音轨、带 `groupId` 的实例、
 * 配音计划文档，`mute` 时静音原句所在的实例，`duck` 时加一条闪避规则），所以首选撤掉那一笔（`videos.undo`）——它把轨道与
 * 文档一起撤掉。那一笔之后视频又改过、撤不了时（`UNDO_CONFLICT`）退回到能做到的部分：删掉这一组的实例（含分离出来的背景）、
 * 恢复这次静音的实例、去掉以配音轨为触发的闪避。协议里没有删轨道与删文档的操作，配音轨（空的）与配音计划文档会留下。
 */

export const DUB_EXTENSION = 'baocut.dub';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 写入配音计划的那一笔事务：文档最早一个版本的 `createdBy`（应用配音时写入，之后就地改的版本更晚）。 */
export function planTransaction(record: Pick<DocumentRecord, 'revisions'> | undefined): Id | null {
  if (!record) return null;
  let first: { createdAt: string; createdBy: Id } | null = null;
  for (const revision of Object.values(record.revisions)) {
    if (!revision?.createdBy) continue;
    if (!first || revision.createdAt < first.createdAt) first = revision;
  }
  return first?.createdBy ?? null;
}

/** 配音计划里记着的、这次静音的实例（之前已经静音的不在里面）。 */
export function mutedItemsOf(planBody: unknown): Id[] {
  if (!isObject(planBody) || !isObject(planBody.extensions)) return [];
  const own = planBody.extensions[DUB_EXTENSION];
  if (!isObject(own) || !Array.isArray(own.mutedItemIds)) return [];
  return own.mutedItemIds.filter((id): id is Id => typeof id === 'string' && id !== '');
}

/** 实例是不是这一组配音的（配音与分离出来的背景都带 `extensions['baocut.dub'].groupId`）。 */
export function inDubGroup(item: { extensions?: Record<string, unknown> }, groupId: string): boolean {
  const own = item.extensions?.[DUB_EXTENSION];
  return isObject(own) && own.groupId === groupId;
}

export interface FallbackUndo {
  operations: EditOperation[];
  /** 删掉的实例、恢复声音的实例、去掉的闪避规则各几个。 */
  removed: number;
  unmuted: number;
  ducking: number;
}

/**
 * 撤不了那一笔时的部分撤销：一笔事务里删掉这一组的实例（锁着的照样列上，整笔被拒时编辑器给原话）、对还静音着的
 * 「这次静音的」实例恢复声音（用户已经自己恢复过的不动）、去掉以这条配音轨为触发的闪避。什么都不剩时操作为空。
 */
export function fallbackUndoOperations(sequence: Sequence, group: { groupId: string; trackId: Id }, mutedItemIds: readonly Id[]): FallbackUndo {
  const operations: EditOperation[] = [];
  const itemIds = sequence.items.filter((item) => inDubGroup(item, group.groupId)).map((item) => item.id);
  if (itemIds.length > 0) operations.push({ type: 'deleteItems', sequenceId: sequence.id, itemIds });
  const muted = new Set(mutedItemIds);
  let unmuted = 0;
  for (const item of sequence.items) {
    if (!muted.has(item.id)) continue;
    const silent = item.type === 'audio' ? item.mix.muted === true : item.type === 'video' ? !item.embeddedAudio.enabled : false;
    if (!silent) continue;
    operations.push({ type: 'setAudioMix', sequenceId: sequence.id, itemId: item.id, muted: false });
    unmuted++;
  }
  const rules = (sequence.ducking ?? []).filter((rule) => rule.trigger.kind === 'items' && rule.trigger.trackIds?.includes(group.trackId));
  for (const rule of rules) operations.push({ type: 'removeDucking', sequenceId: sequence.id, ruleId: rule.id });
  return { operations, removed: itemIds.length, unmuted, ducking: rules.length };
}
