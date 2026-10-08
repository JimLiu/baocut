import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 标题栏的分界跟着下方各栏的右沿走（产品设计 §2.5 用户修订）：页面侧栏、视频旁的会话栏把 `paneEdge`
 * 当 ref 挂上，标题栏在同一个横坐标画一根短线，拖宽、收起、窄屏改成覆盖层时一起变。
 */
const edges = new Set<HTMLElement>();
const listeners = new Set<() => void>();
let observer: ResizeObserver | null = null;
const emit = () => listeners.forEach((listener) => listener());

/** 挂在一栏上（React 19 的 ref 清理函数）：它右沿那根 2px 分界的中线，就是标题栏里的一根分界。 */
export function paneEdge(element: HTMLElement) {
  edges.add(element);
  observer ??= new ResizeObserver(emit);
  observer.observe(element);
  emit();
  return () => {
    edges.delete(element);
    observer?.unobserve(element);
    emit();
  };
}

/**
 * Home 标题栏要对齐的几块区域（原型 shell.jsx `Titlebar` 的 `.content` 与 `.home-workspace__conversation`）：
 * 内容区（会话侧栏右边）与会话列。和分界共用一个 ResizeObserver。
 */
export type PaneRegion = 'home-content' | 'home-conversation';
const regions = new Map<PaneRegion, HTMLElement>();

function regionRef(name: PaneRegion) {
  return (element: HTMLElement) => {
    regions.set(name, element);
    observer ??= new ResizeObserver(emit);
    observer.observe(element);
    emit();
    return () => {
      if (regions.get(name) === element) regions.delete(name);
      observer?.unobserve(element);
      emit();
    };
  };
}

/** 模块级的 ref 回调：每次渲染是同一个函数，不会反复挂上卸下。 */
export const homeContentRegion = regionRef('home-content');
export const homeConversationRegion = regionRef('home-conversation');

export interface RegionBounds {
  left: number;
  right: number;
}

/** 这几块区域的左右缘（视口坐标）；不在或宽度为 0 的不给。 */
export function usePaneRegions(): Partial<Record<PaneRegion, RegionBounds>> {
  const [bounds, setBounds] = useState<Partial<Record<PaneRegion, RegionBounds>>>({});
  useLayoutEffect(() => {
    const sync = () => {
      const next: Partial<Record<PaneRegion, RegionBounds>> = {};
      for (const [name, element] of regions) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) next[name] = { left: Math.round(rect.left), right: Math.round(rect.right) };
      }
      setBounds((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    listeners.add(sync);
    sync();
    window.addEventListener('resize', sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  return bounds;
}

/** 各栏分界相对标题栏左缘的横坐标，从左到右。 */
export function usePaneDividers(bar: RefObject<HTMLElement | null>): number[] {
  const [dividers, setDividers] = useState<number[]>([]);
  useLayoutEffect(() => {
    const sync = () => {
      const origin = bar.current?.getBoundingClientRect().left;
      if (origin === undefined) return;
      const next = [...edges]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.right - 1 - origin))
        .sort((a, b) => a - b);
      setDividers((old) => (old.length === next.length && old.every((x, i) => x === next[i]) ? old : next));
    };
    listeners.add(sync);
    sync();
    return () => void listeners.delete(sync);
  }, [bar]);
  return dividers;
}
