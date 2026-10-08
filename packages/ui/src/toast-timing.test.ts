import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MS, installToastAutoDismiss, type ToastOptions, type ToastQueueLike } from './toast-timing.ts';

function fakeQueue() {
  const added: { children: string; options: ToastOptions }[] = [];
  const closed: number[] = [];
  const make = () => (children: string, options: ToastOptions = {}) => {
    const key = added.push({ children, options }) - 1;
    return () => {
      closed.push(key);
      added[key]!.options.onClose?.();
    };
  };
  const queue: ToastQueueLike = { neutral: make(), positive: make(), negative: make(), info: make() };
  return { queue, added, closed };
}

describe('installToastAutoDismiss', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('没给 timeout 的按默认几秒；给了的不短于 5 秒', () => {
    const { queue, added } = fakeQueue();
    const uninstall = installToastAutoDismiss(queue, () => false);
    queue.neutral('a');
    queue.info('b', { timeout: 2000 });
    queue.positive('c', { timeout: 8000 });
    expect(added.map((t) => t.options.timeout)).toEqual([DEFAULT_MS, 5000, 8000]);
    uninstall();
  });

  it('带按钮的 toast 到时由这里关掉；先关掉的不再计时', () => {
    const { queue, added, closed } = fakeQueue();
    const uninstall = installToastAutoDismiss(queue, () => false);
    const onClose = vi.fn();
    queue.neutral('undo', { actionLabel: '撤销', onClose });
    expect(added[0]!.options.timeout).toBeUndefined();
    vi.advanceTimersByTime(DEFAULT_MS - 1);
    expect(closed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(closed).toEqual([0]);
    expect(onClose).toHaveBeenCalledTimes(1);

    const close = queue.info('later', { actionLabel: '查看', timeout: 6000 });
    close();
    vi.advanceTimersByTime(10_000);
    expect(closed).toEqual([0, 1]);
    uninstall();
  });

  it('指针或焦点停在 toast 上时顺延', () => {
    const { queue, closed } = fakeQueue();
    let held = true;
    const uninstall = installToastAutoDismiss(queue, () => held);
    queue.neutral('undo', { actionLabel: '撤销' });
    vi.advanceTimersByTime(DEFAULT_MS * 3);
    expect(closed).toEqual([]);
    held = false;
    vi.advanceTimersByTime(DEFAULT_MS);
    expect(closed).toEqual([0]);
    uninstall();
  });

  it('同一个队列只装一次', () => {
    const { queue, added } = fakeQueue();
    const uninstall = installToastAutoDismiss(queue, () => false);
    installToastAutoDismiss(queue, () => false);
    queue.neutral('a', { timeout: 7000 });
    expect(added[0]!.options.timeout).toBe(7000);
    uninstall();
  });
});
