import { engineRanges, lazyObject } from '@baocut/editor-wasm';
import { mediaTimeToSeconds, type DuckingRule, type EditOperation, type Id, type Sequence, type SequenceItem } from '@baocut/protocol';
import { trackRows } from './editor.ts';
import { decimalSeconds } from './property-values.ts';

/**
 * 属性页「压低原声」的纯逻辑（视频格式规范 §3.9 的闪避；命令 `setDucking` / `removeDucking`）。
 *
 * 闪避是序列上的规则：触发组（轨道或片段，或者有人说话）发声的时间段里，目标组压低 `depth` dB。属性页从被压低的片段看：
 * 找目标组里有它（直接点名它，或点名它所在的轨道）的第一条规则。新建的规则只点名这个片段，触发组是另一条有声音的轨道；
 * 关掉时只点名它的规则直接删掉，还压低别的片段的规则只停用（关掉会一起停用，页上写明）。
 */

const DUCKING = lazyObject(() => engineRanges().ducking);

/** 引擎的缺省值（`setDucking` 不给时；`editor-wasm` 的取值区间）：压低 10 dB，0.02 秒压下，0.35 秒回升。 */
export const DUCK_DEFAULTS = lazyObject(() => DUCKING.defaults);

/** 滑杆范围（设计稿）与精确输入的上限（引擎的区间：压低 0–60 dB，起落 0–5 秒）。 */
export const DUCK_LIMITS = lazyObject(
  () =>
    ({
      depth: { min: 1, max: 30, hardMax: DUCKING.depth[1] },
      attack: { min: 0, max: 1, hardMax: DUCKING.time[1] },
      release: { min: 0, max: 2, hardMax: DUCKING.time[1] },
    }) as const,
);

/** 能被压低的片段：音频、视频（自带的声音）。 */
export function isDuckable(item: SequenceItem): boolean {
  return item.type === 'audio' || item.type === 'video';
}

/** 片段会不会发声（触发组里只有发声的片段才起作用）。 */
function sounds(item: SequenceItem): boolean {
  if (!item.enabled) return false;
  if (item.type === 'audio') return true;
  if (item.type === 'video') return item.embeddedAudio.enabled;
  return item.type === 'composition' && !!item.audio?.enabled;
}

/** 压低这个片段的第一条规则（点名它的优先，其次点名它所在轨道的）。 */
export function duckingRuleFor(sequence: Sequence, item: SequenceItem): DuckingRule | undefined {
  const rules = sequence.ducking ?? [];
  return rules.find((r) => r.target.itemIds?.includes(item.id)) ?? rules.find((r) => r.target.trackIds?.includes(item.trackId));
}

/** 规则只压低这一个片段（关掉时可以直接删）。 */
export function isOwnRule(rule: DuckingRule, item: SequenceItem): boolean {
  return !rule.target.trackIds?.length && rule.target.itemIds?.length === 1 && rule.target.itemIds[0] === item.id;
}

/** 「压在」的选项：别的、有发声片段的轨道（片段自己的轨道不能既触发又被压低）。 */
export function triggerOptions(sequence: Sequence, item: SequenceItem): { key: Id; label: string }[] {
  const sounding = new Set(sequence.items.filter((other) => other.trackId !== item.trackId && sounds(other)).map((other) => other.trackId));
  return trackRows(sequence)
    .filter((row) => sounding.has(row.track.id))
    .map((row) => ({ key: row.track.id, label: row.label }));
}

/** 规则的触发组正好是一条轨道时是它；点名了片段或几条轨道时是 null（页上不选中任何一项，写明）。 */
export function singleTrigger(rule: DuckingRule): Id | null {
  const t = rule.trigger;
  return t.kind === 'items' && !t.itemIds?.length && t.trackIds?.length === 1 ? t.trackIds[0]! : null;
}

/** 规则的读数（秒）。 */
export function ruleValues(rule: DuckingRule): { depth: number; attack: number; release: number } {
  return { depth: rule.depth, attack: mediaTimeToSeconds(rule.attack), release: mediaTimeToSeconds(rule.release) };
}

export function isDefault(rule: DuckingRule): boolean {
  const v = ruleValues(rule);
  return (
    v.depth === DUCK_DEFAULTS.depth &&
    Math.abs(v.attack - DUCK_DEFAULTS.attack) < 1e-9 &&
    Math.abs(v.release - DUCK_DEFAULTS.release) < 1e-9
  );
}

/** 打开：已有（停用的）规则重新启用；没有就新建一条只点名这个片段的规则，压在 `trigger` 轨道之下。 */
export function enableOperations(sequence: Sequence, item: SequenceItem, trigger: Id): EditOperation[] {
  const rule = duckingRuleFor(sequence, item);
  if (rule) return rule.enabled ? [] : [{ type: 'setDucking', sequenceId: sequence.id, ruleId: rule.id, enabled: true }];
  return [{ type: 'setDucking', sequenceId: sequence.id, trigger: { kind: 'items', trackIds: [trigger] }, target: { itemIds: [item.id] } }];
}

/** 关掉：只压低它的规则删掉；还压低别的片段的规则停用。 */
export function disableOperations(sequence: Sequence, item: SequenceItem): EditOperation[] {
  const rule = duckingRuleFor(sequence, item);
  if (!rule) return [];
  if (isOwnRule(rule, item)) return [{ type: 'removeDucking', sequenceId: sequence.id, ruleId: rule.id }];
  return rule.enabled ? [{ type: 'setDucking', sequenceId: sequence.id, ruleId: rule.id, enabled: false }] : [];
}

/** 改规则的一项：换触发轨道、压低多少、压下与回升的时长（十进制秒）。 */
export function changeOperation(
  sequence: Sequence,
  rule: DuckingRule,
  change: { trigger?: Id; depth?: number; attack?: number; release?: number },
): EditOperation {
  return {
    type: 'setDucking',
    sequenceId: sequence.id,
    ruleId: rule.id,
    ...(change.trigger !== undefined ? { trigger: { kind: 'items' as const, trackIds: [change.trigger] } } : {}),
    ...(change.depth !== undefined ? { depth: change.depth } : {}),
    ...(change.attack !== undefined ? { attack: decimalSeconds(change.attack) } : {}),
    ...(change.release !== undefined ? { release: decimalSeconds(change.release) } : {}),
  };
}

/** 恢复缺省。 */
export function resetOperation(sequence: Sequence, rule: DuckingRule): EditOperation {
  return changeOperation(sequence, rule, { ...DUCK_DEFAULTS });
}
