import { describe, expect, it } from 'vitest';
import {
  UPWARD_INTENT_WINDOW_MS,
  beginScrollbarDrag,
  endScrollbarDrag,
  initialFollowState,
  isNearBottom,
  isUpwardKey,
  nextFollowState,
  recordUpwardIntent,
  shouldPin,
  upwardIntentRemaining,
  type FollowState,
} from './follow-bottom.ts';

/** 先观察一次 scrollTop，作为后续比较的基准。 */
function settled(scrollTop: number, following = true): FollowState {
  const state = { ...initialFollowState(), following };
  return nextFollowState(state, { scrollTop, distanceFromBottom: following ? 0 : 300, now: 0 });
}

describe('nextFollowState', () => {
  it('布局导致 scrollTop 变小、没有向上输入时不脱钩', () => {
    const next = nextFollowState(settled(1000), { scrollTop: 700, distanceFromBottom: 0, now: 1000 });
    expect(next.following).toBe(true);
    expect(next.lastScrollTop).toBe(700);
  });

  it('滚轮向上后 100ms 内 scrollTop 变小就脱钩', () => {
    const state = recordUpwardIntent(settled(1000), 1000);
    const next = nextFollowState(state, { scrollTop: 900, distanceFromBottom: 100, now: 1000 + UPWARD_INTENT_WINDOW_MS });
    expect(next.following).toBe(false);
  });

  it('向上输入超过窗口之后 scrollTop 变小不脱钩', () => {
    const state = recordUpwardIntent(settled(1000), 1000);
    const next = nextFollowState(state, { scrollTop: 900, distanceFromBottom: 100, now: 1000 + UPWARD_INTENT_WINDOW_MS + 1 });
    expect(next.following).toBe(true);
  });

  it('拖滚动条期间超过时间窗口仍算向上输入', () => {
    const state = beginScrollbarDrag(settled(1000));
    const next = nextFollowState(state, { scrollTop: 600, distanceFromBottom: 400, now: 5000 });
    expect(next.following).toBe(false);
    const released = nextFollowState(endScrollbarDrag(settled(1000)), { scrollTop: 600, distanceFromBottom: 400, now: 5000 });
    expect(released.following).toBe(true);
  });

  it('滚回到距底 1px 以内重新跟上', () => {
    const next = nextFollowState(settled(500, false), { scrollTop: 799.5, distanceFromBottom: 0.5, now: 10 });
    expect(next.following).toBe(true);
  });

  it('向下滚但没到底不跟上', () => {
    const next = nextFollowState(settled(500, false), { scrollTop: 700, distanceFromBottom: 30, now: 10 });
    expect(next.following).toBe(false);
  });

  it('没在跟时距底 ≤1 但 scrollTop 没变大（内容缩短被动到底）不跟上', () => {
    const shrunk = nextFollowState(settled(500, false), { scrollTop: 400, distanceFromBottom: 0, now: 10 });
    expect(shrunk.following).toBe(false);
    const same = nextFollowState(settled(500, false), { scrollTop: 500, distanceFromBottom: 0, now: 10 });
    expect(same.following).toBe(false);
  });

  it('第一次观察只记基准不改跟底', () => {
    const next = nextFollowState(recordUpwardIntent(initialFollowState(), 0), { scrollTop: 0, distanceFromBottom: 500, now: 0 });
    expect(next.following).toBe(true);
    expect(next.lastScrollTop).toBe(0);
  });
});

describe('shouldPin', () => {
  it('跟底且没有近期向上输入时才钉底', () => {
    const state = settled(1000);
    expect(shouldPin(state, 0)).toBe(true);
    expect(shouldPin(recordUpwardIntent(state, 100), 150)).toBe(false);
    expect(upwardIntentRemaining(recordUpwardIntent(state, 100), 150)).toBe(UPWARD_INTENT_WINDOW_MS - 50);
    expect(shouldPin(recordUpwardIntent(state, 100), 100 + UPWARD_INTENT_WINDOW_MS + 1)).toBe(true);
    expect(shouldPin(settled(500, false), 0)).toBe(false);
  });
});

describe('isUpwardKey / isNearBottom', () => {
  it('识别向上的按键', () => {
    expect(isUpwardKey({ key: 'ArrowUp', shiftKey: false })).toBe(true);
    expect(isUpwardKey({ key: 'PageUp', shiftKey: false })).toBe(true);
    expect(isUpwardKey({ key: 'Home', shiftKey: false })).toBe(true);
    expect(isUpwardKey({ key: ' ', shiftKey: true })).toBe(true);
    expect(isUpwardKey({ key: ' ', shiftKey: false })).toBe(false);
    expect(isUpwardKey({ key: 'ArrowDown', shiftKey: false })).toBe(false);
  });

  it('64px 内算接近底部', () => {
    expect(isNearBottom(64)).toBe(true);
    expect(isNearBottom(65)).toBe(false);
  });
});
