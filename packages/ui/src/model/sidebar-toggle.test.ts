import { describe, expect, it } from 'vitest';
import { SIDEBAR_SLIDE, sidebarSlide, sidebarToggleLabel } from './sidebar-toggle.ts';

describe('侧栏开合钮', () => {
  it('名称跟着状态：开着说隐藏，收起说显示', () => {
    expect(sidebarToggleLabel(false)).toBe('隐藏侧边栏');
    expect(sidebarToggleLabel(true)).toBe('显示侧边栏');
  });
});

describe('侧栏开合动画', () => {
  it('展开从 0 拉到侧栏宽，结束后回到侧栏自己的宽度', () => {
    expect(sidebarSlide({ open: true, running: false, now: 0, full: 260 })).toEqual({ from: 0, to: 260, fill: 'none' });
  });

  it('收起从当前宽收回 0，停在 0 等卸载', () => {
    expect(sidebarSlide({ open: false, running: false, now: 260, full: 260 })).toEqual({ from: 260, to: 0, fill: 'forwards' });
  });

  it('收起途中再展开，从此刻的宽度接着走', () => {
    expect(sidebarSlide({ open: true, running: true, now: 97, full: 260 })).toEqual({ from: 97, to: 260, fill: 'none' });
  });

  it('展开途中再收起，从此刻的宽度收回', () => {
    expect(sidebarSlide({ open: false, running: true, now: 140, full: 260 })).toEqual({ from: 140, to: 0, fill: 'forwards' });
  });

  it('时长与曲线同 S2 默认过渡（原型 --ease）', () => {
    expect(SIDEBAR_SLIDE).toEqual({ duration: 150, easing: 'cubic-bezier(0.45, 0, 0.4, 1)' });
  });
});
