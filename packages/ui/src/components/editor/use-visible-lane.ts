import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

/** 看得见的范围按这个粒度取整，滚动时少重画几次。 */
const WINDOW_STEP = 256;

/**
 * 一个滚动容器的宽与横向滚动位置，同一容器上的各处（时间线、每个胶片条、字幕块）共用一份与一个滚动监听：
 * 建立时量一次，之后由滚动事件与 ResizeObserver 回调更新，再一并通知各处。
 */
interface Viewport {
  width: number;
  scrollLeft: number;
  readonly listeners: Set<() => void>;
  readonly dispose: () => void;
}

const viewports = new WeakMap<HTMLElement, Viewport>();

function attach(element: HTMLElement, listener: () => void): Viewport {
  let viewport = viewports.get(element);
  if (!viewport) {
    const listeners = new Set<() => void>();
    const notify = () => {
      for (const each of listeners) each();
    };
    // 用户滚动、尺寸变化：各处的新范围当场一起画进 DOM（flushSync），这一帧画出来的就是新位置的内容。
    // 不这样的话 React 把它排到这一帧之后，一次滚过一屏以上（滚轮甩得快、拖滚动条）会露白一帧。
    // 时间线在 layout effect 里补发的 scroll（isTrusted 为 false）本来就在提交里同步处理，不能也不必再 flushSync。
    const onScroll = (event: Event) => {
      created.scrollLeft = element.scrollLeft;
      if (event.isTrusted) flushSync(notify);
      else notify();
    };
    const observer = new ResizeObserver(() => {
      created.width = element.clientWidth;
      created.scrollLeft = element.scrollLeft;
      flushSync(notify);
    });
    const created: Viewport = {
      width: element.clientWidth,
      scrollLeft: element.scrollLeft,
      listeners,
      dispose: () => {
        element.removeEventListener('scroll', onScroll);
        observer.disconnect();
        viewports.delete(element);
      },
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(element);
    viewports.set(element, created);
    viewport = created;
  }
  viewport.listeners.add(listener);
  return viewport;
}

function detach(element: HTMLElement, listener: () => void) {
  const viewport = viewports.get(element);
  if (!viewport) return;
  viewport.listeners.delete(listener);
  if (viewport.listeners.size === 0) viewport.dispose();
}

function rangeOf(viewport: Viewport, head: number, margin: number): { left: number; right: number } {
  const width = viewport.width - head;
  return {
    left: Math.floor((viewport.scrollLeft - width * margin) / WINDOW_STEP) * WINDOW_STEP,
    right: Math.ceil((viewport.scrollLeft + width * (1 + margin)) / WINDOW_STEP) * WINDOW_STEP,
  };
}

/**
 * 时间线横向看得见的范围（相对轨道内容的左边，像素）。`margin` 是两边各多算几屏：
 * 片段、字幕句子多画一屏，滚动时不露白；要向 Runtime 取东西的（胶片条）只算看得见的。
 *
 * 滚动与尺寸变化时当场重算（不经 requestAnimationFrame：窗口在后台时它不触发），按 256px 取整，没跨格不重画。
 * 缩放后时间线在 layout effect 里摆好滚动位置，再补发一次 `scroll`，让各处在画上去之前就换到新的范围。
 */
export function useVisibleLane(scrollRef: RefObject<HTMLDivElement | null>, head: number, margin = 1): { left: number; right: number } {
  // 容器已经量过（滚动中新挂上的片段、字幕）就直接按它起范围，第一次渲染不按缺省范围画。
  const [range, setRange] = useState(() => {
    const viewport = scrollRef.current ? viewports.get(scrollRef.current) : undefined;
    return viewport ? rangeOf(viewport, head, margin) : { left: 0, right: 4096 };
  });
  // 在画上去之前算：第一帧就按真实的范围画，不先按缺省范围露白一帧。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      const next = rangeOf(viewport, head, margin);
      setRange((current) => (current.left === next.left && current.right === next.right ? current : next));
    };
    const viewport = attach(element, update);
    update();
    return () => detach(element, update);
  }, [scrollRef, head, margin]);
  return range;
}
