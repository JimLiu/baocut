import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNarrow } from './use-narrow.ts';

vi.mock('react', () => ({ useEffect: vi.fn(), useState: vi.fn() }));

describe('useNarrow', () => {
  const setNarrow = vi.fn();
  const observe = vi.fn();
  const disconnect = vi.fn();
  let receive: ResizeObserverCallback;
  let cleanup: (() => void) | undefined;
  let outerWidth: number;
  const element = { getBoundingClientRect: () => ({ width: outerWidth }) } as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup = undefined;
    outerWidth = 556;
    vi.mocked(useState).mockReturnValue([false, setNarrow]);
    vi.mocked(useEffect).mockImplementation((effect) => {
      const dispose = effect();
      if (dispose) cleanup = () => { dispose(); };
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { receive = callback; }
      observe = observe;
      disconnect = disconnect;
    });
  });

  afterEach(() => {
    cleanup?.();
    vi.unstubAllGlobals();
  });

  function resize(contentWidth: number, borderBox = true) {
    const entry = {
      target: element,
      contentRect: { width: contentWidth },
      borderBoxSize: borderBox ? [{ inlineSize: outerWidth }] : [],
    } as unknown as ResizeObserverEntry;
    receive([entry], {} as ResizeObserver);
  }

  it('输入框留白从 24px 收到 12px 后，临界宽度保持紧凑，不反复切换', () => {
    useNarrow({ current: element }, 520 + 24 * 2, 'border-box');
    expect(observe).toHaveBeenCalledWith(element, { box: 'border-box' });
    let compact = false;
    const modes: boolean[] = [];
    for (let frame = 0; frame < 8; frame++) {
      resize(outerWidth - 2 * (compact ? 12 : 24));
      compact = setNarrow.mock.lastCall![0];
      modes.push(compact);
    }
    expect(modes).toEqual(Array(8).fill(true));
  });

  it('实际外宽跨过断点时才切换，等于断点使用正常布局', () => {
    useNarrow({ current: element }, 568, 'border-box');
    outerWidth = 567;
    resize(543);
    expect(setNarrow).toHaveBeenLastCalledWith(true);
    outerWidth = 568;
    resize(544);
    expect(setNarrow).toHaveBeenLastCalledWith(false);
    outerWidth = 620;
    resize(572);
    expect(setNarrow).toHaveBeenLastCalledWith(false);
  });

  it('没有 borderBoxSize 时仍按外框宽度判断', () => {
    useNarrow({ current: element }, 568, 'border-box');
    resize(532, false);
    expect(setNarrow).toHaveBeenLastCalledWith(true);
    outerWidth = 600;
    resize(552, false);
    expect(setNarrow).toHaveBeenLastCalledWith(false);
  });

  it('其他调用默认仍按内容宽度判断，并在卸载时停止观察', () => {
    useNarrow({ current: element }, 520);
    expect(observe).toHaveBeenCalledWith(element, { box: 'content-box' });
    resize(508);
    expect(setNarrow).toHaveBeenLastCalledWith(true);
    resize(532);
    expect(setNarrow).toHaveBeenLastCalledWith(false);
    cleanup?.();
    cleanup = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
