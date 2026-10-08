import {
  SINGLE_SIDED_TRANSITION_KINDS,
  framesToSeconds,
  type EditOperation,
  type Easing,
  type Rate,
  type Sequence,
  type SequenceItem,
  type Transition,
  type TransitionKind,
} from '@baocut/protocol';
import { decimalSeconds } from './property-values.ts';
import { M } from './transition-panel-copy.ts';

/**
 * 属性页「转场」一节的纯逻辑（视频格式规范 §3.9；命令 `setTransition` / `removeTransition`）。
 *
 * 一个画面片段有两条边：开头（「进入」，转场的 `rightItemId` 是它）与结尾（「离开」，`leftItemId` 是它）。一条边上
 * 只有一个转场。同一轨道上首尾相接的邻居在时，可以把这条边做成两侧转场（「衔接」：和邻居之间过渡）；否则是单侧转场，
 * 另一侧是透明的，露出下面的轨道。单侧转场只能居中，也不能交叉淡化声音（引擎拒绝）。
 */

export type TransitionSlot = 'in' | 'out';
export type TransitionChoice = TransitionKind | 'none';
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/** 一组选项：键固定，名字按当前语言读。 */
function options<K extends string>(keys: readonly K[], labels: () => Record<K, string>): readonly { key: K; label: string }[] {
  return keys.map((key) => ({
    key,
    get label() {
      return labels()[key];
    },
  }));
}

export const SLOTS: readonly { key: TransitionSlot; label: string }[] = options(['in', 'out'], () => M.slot);

/** 页上的转场瓦片，按设计稿的顺序；「叠色」「推入」是格式里有、设计稿没画的两种，只能两侧（和邻居衔接）。 */
export const TRANSITION_CHOICES: readonly { key: TransitionChoice; label: string }[] = options(
  ['none', 'dissolve', 'wipe', 'slide', 'zoom', 'dip-to-color', 'push'],
  () => M.choice,
);

/** 方向：推入时画面朝哪边走，缺省 `right`。 */
export const DIRECTIONS: readonly { key: TransitionDirection; label: string }[] = options(['right', 'left', 'down', 'up'], () => M.direction);

export const EASINGS: readonly { key: Easing; label: string }[] = options(['linear', 'ease-in', 'ease-out', 'ease-in-out'], () => M.easing);

/** 新加转场的时长（秒），同设计稿。 */
export const DEFAULT_SECONDS = 0.5;
export const DEFAULT_DIRECTION: TransitionDirection = 'right';
export const DEFAULT_DIP_COLOR = '#000000';
/** 引擎的上限。 */
export const MAX_SECONDS = 10;

/** 能加转场的片段：画面片段（音频与字幕不能）。 */
export function isTransitionable(item: SequenceItem): item is Exclude<SequenceItem, { type: 'audio' | 'caption' }> {
  return item.type !== 'audio' && item.type !== 'caption';
}

/** 这条边上的转场。 */
export function slotTransition(sequence: Sequence, itemId: string, slot: TransitionSlot): Transition | undefined {
  return (sequence.transitions ?? []).find((t) => (slot === 'in' ? t.rightItemId === itemId : t.leftItemId === itemId));
}

/** 这条边外侧、同一轨道上首尾相接的画面片段（能做两侧转场的邻居）。 */
export function slotNeighbor(sequence: Sequence, item: SequenceItem, slot: TransitionSlot): SequenceItem | undefined {
  if (!isTransitionable(item)) return undefined;
  const from = item.span.fromFrame;
  const end = from + item.span.durationFrames;
  return sequence.items.find(
    (other) =>
      other.id !== item.id &&
      other.trackId === item.trackId &&
      isTransitionable(other) &&
      (slot === 'in' ? other.span.fromFrame + other.span.durationFrames === from : other.span.fromFrame === end),
  );
}

/** 时长滑杆的范围（秒）：设计稿是 0.1 到 min(2, 片段长 / 2)；精确输入可到片段长（不超过 10 秒），超了由引擎拒绝。 */
export function durationLimits(item: SequenceItem, fps: Rate): { min: number; max: number; hardMax: number } {
  const length = isTransitionable(item) ? framesToSeconds(item.span.durationFrames, fps) : 0;
  const max = Math.max(0, Math.min(2, length / 2));
  const frame = framesToSeconds(1, fps);
  return { min: Math.min(Math.max(0.1, frame), max), max, hardMax: Math.max(max, Math.min(MAX_SECONDS, length)) };
}

/** 页上这条边的样子：选的种类、参数、时长、缓动、是否和邻居衔接、声音交叉淡化。 */
export interface SlotState {
  kind: TransitionChoice;
  /** 认不出的种类（别的版本写的）：页上不选中任何瓦片。 */
  unknownKind?: string;
  direction: TransitionDirection;
  color: string;
  seconds: number;
  easing: Easing;
  joined: boolean;
  audioCrossfade: boolean;
}

export function slotState(sequence: Sequence, item: SequenceItem, slot: TransitionSlot): SlotState {
  const t = slotTransition(sequence, item.id, slot);
  if (!t) {
    return {
      kind: 'none',
      direction: DEFAULT_DIRECTION,
      color: DEFAULT_DIP_COLOR,
      seconds: DEFAULT_SECONDS,
      easing: 'linear',
      joined: !!slotNeighbor(sequence, item, slot),
      audioCrossfade: false,
    };
  }
  const known = TRANSITION_CHOICES.some((choice) => choice.key === t.kind && choice.key !== 'none');
  const direction = t.params?.direction;
  const color = t.params?.color;
  return {
    kind: known ? (t.kind as TransitionKind) : 'none',
    ...(known ? {} : { unknownKind: t.kind }),
    direction: DIRECTIONS.some((d) => d.key === direction) ? (direction as TransitionDirection) : DEFAULT_DIRECTION,
    color: typeof color === 'string' ? color : DEFAULT_DIP_COLOR,
    seconds: framesToSeconds(t.durationFrames, sequence.fps),
    easing: t.easing,
    joined: !!t.leftItemId && !!t.rightItemId,
    audioCrossfade: !!t.audioCrossfade,
  };
}

/** 种类要的参数（引擎按种类严格校验，多一个字段也拒绝）：只有叠色带颜色、推入带方向，其余没有参数。 */
export function transitionParams(kind: TransitionKind, state: Pick<SlotState, 'direction' | 'color'>): Record<string, unknown> | undefined {
  switch (kind) {
    case 'dip-to-color':
      return { color: state.color };
    case 'push':
      return { direction: state.direction };
    default:
      return undefined;
  }
}

/** 这种转场能不能单侧（没有邻居、另一侧透明）：叠色与推入只能两侧。 */
export function singleSided(kind: TransitionChoice): boolean {
  return kind === 'none' || SINGLE_SIDED_TRANSITION_KINDS.includes(kind);
}

/** 种类要不要选方向。 */
export const directed = (kind: TransitionChoice) => kind === 'push';

/** 片段带声音（视频自带的声音、合成发出的声音）：两侧都带时才有「声音交叉淡化」可言。 */
export function hasSound(item: SequenceItem | undefined): boolean {
  return item?.type === 'video' || (item?.type === 'composition' && !!item.audio);
}

/**
 * 写这条边的转场。选「无」是删掉已有的；其余是 `setTransition`：两侧（和邻居衔接）时沿用已有两侧转场的 placement，
 * 否则居中；单侧不带 placement 以外的位置、不交叉淡化声音。时长按十进制秒给，引擎对齐到最近的一帧。
 */
export function slotOperations(sequence: Sequence, item: SequenceItem, slot: TransitionSlot, next: SlotState): EditOperation[] {
  const existing = slotTransition(sequence, item.id, slot);
  if (next.kind === 'none') return existing ? [{ type: 'removeTransition', sequenceId: sequence.id, transitionId: existing.id }] : [];
  const neighbor = next.joined ? slotNeighbor(sequence, item, slot) : undefined;
  const sides = neighbor
    ? slot === 'in'
      ? { leftItemId: neighbor.id, rightItemId: item.id }
      : { leftItemId: item.id, rightItemId: neighbor.id }
    : slot === 'in'
      ? { rightItemId: item.id }
      : { leftItemId: item.id };
  const params = transitionParams(next.kind, next);
  const twoSided = !!neighbor;
  // 只能两侧的种类没有邻居时写不进去（引擎拒绝），页上那几格是灰的。
  if (!twoSided && !singleSided(next.kind)) return [];
  const keepPlacement = twoSided && existing?.leftItemId && existing.rightItemId ? existing.placement : 'center';
  return [
    {
      type: 'setTransition',
      sequenceId: sequence.id,
      ...sides,
      kind: next.kind,
      ...(params ? { params } : {}),
      duration: { unit: 'seconds', value: decimalSeconds(next.seconds) },
      alignment: 'nearest-frame',
      easing: next.easing,
      placement: keepPlacement,
      ...(twoSided && next.audioCrossfade && hasSound(item) && hasSound(neighbor) ? { audioCrossfade: true } : {}),
    },
  ];
}
