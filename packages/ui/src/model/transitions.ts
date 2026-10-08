import type { Easing, FrameSpan, Sequence, Transition } from '@baocut/protocol';

/**
 * 转场的窗口与缓动（视频格式规范 §3.9），与 Rust `video-model/src/transition.rs` 相同：
 *
 * - 两侧转场的窗口按 `placement` 摆在剪切点上：居中从 `cut − ⌊D/2⌋` 开始，`start-at-cut` 从剪切点开始，
 *   `end-at-cut` 在剪切点结束；
 * - 入场（只有右侧）从实例开头开始，出场（只有左侧）在实例结尾结束；
 * - 窗口是 `[start, start + D)`（帧）。
 */
export function transitionWindow(transition: Transition, left: FrameSpan | undefined, right: FrameSpan | undefined): [number, number] | null {
  const duration = transition.durationFrames;
  let start: number;
  if (left && right) {
    const cut = right.fromFrame;
    start = transition.placement === 'start-at-cut' ? cut : transition.placement === 'end-at-cut' ? cut - duration : cut - Math.floor(duration / 2);
  } else if (right) start = right.fromFrame;
  else if (left) start = left.fromFrame + left.durationFrames - duration;
  else return null;
  return [start, start + duration];
}

/** 缓动：进度 `p`（0–1）到画法用的值。 */
export function applyEasing(easing: Easing, p: number): number {
  switch (easing) {
    case 'linear':
      return p;
    case 'ease-in':
      return p * p;
    case 'ease-out':
      return 1 - (1 - p) * (1 - p);
    case 'ease-in-out':
      return p * p * (3 - 2 * p);
  }
}

/**
 * 两侧转场让实例在自己的区间之外也要画（左侧画到窗口结束、右侧从窗口开始画）：每个实例因此多占的帧区间。
 * 预览按它给同一素材多备元素（拆开的两段之间叠化时，同一个素材同时要两个源时刻）。
 */
export function transitionReach(sequence: Sequence): Map<string, [number, number]> {
  const spans = new Map(sequence.items.flatMap((item) => ('span' in item && item.span ? [[item.id, item.span] as const] : [])));
  const reach = new Map<string, [number, number]>();
  const extend = (id: string, from: number, to: number) => {
    const [a, b] = reach.get(id) ?? [from, to];
    reach.set(id, [Math.min(a, from), Math.max(b, to)]);
  };
  for (const transition of sequence.transitions ?? []) {
    if (!transition.leftItemId || !transition.rightItemId) continue;
    const left = spans.get(transition.leftItemId);
    const right = spans.get(transition.rightItemId);
    if (!left || !right) continue;
    const window = transitionWindow(transition, left, right);
    if (!window) continue;
    extend(transition.leftItemId, left.fromFrame, Math.max(left.fromFrame + left.durationFrames, window[1]));
    extend(transition.rightItemId, Math.min(right.fromFrame, window[0]), right.fromFrame + right.durationFrames);
  }
  return reach;
}
