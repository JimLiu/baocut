/**
 * 会话线程「跟到底」的状态机，不依赖 DOM。
 *
 * - 脱钩：正在跟、scrollTop 比上一次小、且最近有向上的用户输入证据（滚轮、键盘、滚动条拖动、触摸）。
 *   只有 scrollTop 变小而没有输入证据时（上方块折叠、窗口变矮、内容缩短被浏览器夹紧），维持跟底。
 * - 重新跟上：scrollTop 比上一次大，且距底 ≤ REFOLLOW_PX。内容缩短把视口被动带到底不算。
 * - 其他情况维持原值。
 */

/** 向上输入证据的有效窗口。 */
export const UPWARD_INTENT_WINDOW_MS = 100;
/** 重新跟上要求的距底距离，容纳亚像素误差。 */
export const REFOLLOW_PX = 1;
/** 「接近底部」：只用于展示类判断，不参与脱钩与跟上。 */
export const NEAR_BOTTOM_PX = 64;

export interface FollowState {
  following: boolean;
  /** 上一次 scroll 事件观察到的 scrollTop；null 表示还没观察过。 */
  lastScrollTop: number | null;
  /** 最近一次向上输入的时间戳（毫秒）；null 表示没有。 */
  upwardIntentAt: number | null;
  /** 正在拖滚动条：拖动可能远超时间窗口，期间一直算有向上输入证据。 */
  scrollbarDrag: boolean;
}

export interface ScrollSample {
  scrollTop: number;
  /** scrollHeight - scrollTop - clientHeight；弹性超滚时可能为负。 */
  distanceFromBottom: number;
  now: number;
}

export function initialFollowState(): FollowState {
  return { following: true, lastScrollTop: null, upwardIntentAt: null, scrollbarDrag: false };
}

export function recordUpwardIntent(state: FollowState, now: number): FollowState {
  return { ...state, upwardIntentAt: now };
}

export function beginScrollbarDrag(state: FollowState): FollowState {
  return state.scrollbarDrag ? state : { ...state, scrollbarDrag: true };
}

export function endScrollbarDrag(state: FollowState): FollowState {
  return state.scrollbarDrag ? { ...state, scrollbarDrag: false } : state;
}

export function hasUpwardIntent(state: FollowState, now: number): boolean {
  if (state.scrollbarDrag) return true;
  return state.upwardIntentAt !== null && now - state.upwardIntentAt <= UPWARD_INTENT_WINDOW_MS;
}

/** 时间窗口内的向上输入还要多久过期（毫秒）；没有则为 0。滚动条拖动不计入。 */
export function upwardIntentRemaining(state: FollowState, now: number): number {
  if (state.upwardIntentAt === null) return 0;
  return Math.max(0, UPWARD_INTENT_WINDOW_MS - (now - state.upwardIntentAt));
}

export function nextFollowState(state: FollowState, sample: ScrollSample): FollowState {
  const last = state.lastScrollTop;
  let following = state.following;
  if (last !== null) {
    if (following && sample.scrollTop < last && hasUpwardIntent(state, sample.now)) following = false;
    else if (!following && sample.scrollTop > last && sample.distanceFromBottom <= REFOLLOW_PX) following = true;
  }
  return { ...state, following, lastScrollTop: sample.scrollTop };
}

/** 跟底时是否该把视口钉到底：最近有向上输入时先不钉，免得盖掉还没派发 scroll 事件的用户滚动。 */
export function shouldPin(state: FollowState, now: number): boolean {
  return state.following && !hasUpwardIntent(state, now);
}

export function isNearBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom <= NEAR_BOTTOM_PX;
}

/**
 * 会让滚动区向上走的按键：ArrowUp、PageUp、Home（含 Cmd/Ctrl 组合，「到顶」）、Shift+Space。
 * 是否在可编辑元素里由调用方判断。
 */
export function isUpwardKey(event: { key: string; shiftKey: boolean }): boolean {
  if (event.key === ' ' || event.key === 'Spacebar') return event.shiftKey;
  return event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home';
}
