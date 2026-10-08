import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
  alignedScrollTop,
  anchorShift,
  layoutRows,
  rowAt,
  rowHeight,
  rowRange,
  rowSegments,
  type Align,
  type RowLayout,
  type RowSegment,
} from '../../model/virtual-rows.ts';

export type { Align, RowSegment };

/** 还没量到视口高时按这么高排（挂载那一刻在 layout effect 里就换成真的，不会画出来）。 */
const FALLBACK_VIEWPORT = 800;
/** 自己写下的 scrollTop 多久之后不再认作「程序滚的」：面板隐藏时 scroll 事件不来，记下的值会一直留着。 */
const PROGRAMMATIC_TTL = 500;
/** scrollToIndex 估计 → 量 → 修正最多来回几次。 */
const MAX_SETTLE = 8;
/** 行高差这么一点不算变（量到的高是小数，例如 67.390625）。 */
const EPSILON = 0.01;

export interface VirtualRowsOptions {
  /** 滚动容器。行在它里面按正常文档流排（容器上内边距当作 0），行与行之间不能有外边距。 */
  scrollRef: RefObject<HTMLElement | null>;
  /** 每行一个稳定的 key（行增删后跟着 key 走：高度缓存、钉住、锚点）。 */
  keys: readonly string[];
  /** 没量过的行的估计高（border-box）；`width` 是容器的内容宽。换了函数身份就重排一遍（行内容变了时换）。 */
  estimate: (index: number, width: number) => number;
  /** 视口前后各多挂几屏，默认 1。 */
  overscan?: number;
  /** 不管在不在窗口里都挂着的行（正在改的、查找命中的……）；null 跳过。 */
  pinned?: readonly (string | null | undefined)[];
  /**
   * 吸顶的行（`position: sticky` 的分组头）的下标，从小到大：视口上沿所在行之前（含）最近的那一行一直挂着，
   * 滚出窗口也不卸，免得吸在顶上的头行跟着窗口消失。
   */
  sticky?: readonly number[];
  /**
   * 行的画法（比如文稿的视图与译文语言）：换了说明同一个 key 的行高也变了，没挂着的行量过的高作废、回到新的估计。
   * 内容改动（改词、剪掉）不用换：改的行多半挂着，会重量。
   */
  measureKey?: string;
}

export interface VirtualRows {
  /** 按下标排好的段：空白段画一个这么高的空 div（`aria-hidden`），行段画那一行。 */
  segments: RowSegment[];
  /**
   * 行外层的 ref：按 key 缓存，同一个 key 拿到的是同一个函数（memo 的行组件可以直接收）。行外层还要带 `role="listitem"`、
   * `aria-setsize`（行数）与 `aria-posinset`（下标 + 1）。
   */
  measureRef(key: string): (element: HTMLElement | null) => void;
  /** 把第 `index` 行滚到视口里：先按估计跳，挂上量过再修正；行挂上、量过且对准了 resolve(true)，被用户滚动或别的请求打断 resolve(false)。 */
  scrollToIndex(index: number, options?: { align?: Align }): Promise<boolean>;
  /** 程序滚到 `top`（记作程序滚动）；给面板在行内再对准某个元素用。 */
  scrollTo(top: number): void;
  /** 第 `index` 行在当前排版里的上沿（`index` 等于行数时是总高）：面板把空白段按分组切开时用，与 `segments` 同一份排版。 */
  rowTop(index: number): number;
  /**
   * 行里的子组件要求「别卸掉这一行」（菜单开着、行内输入框……）：按 key 缓存的开关，行外层用 `RowHoldContext` 交给子组件，
   * 子组件调 `useHoldRow(条件)`。几处同时要求时都放开才算放开。
   */
  holdRow(key: string): (on: boolean) => void;
  /** 滚动容器上要带的：列表角色、焦点进出（焦点所在行及前后各一行钉住）、关掉浏览器自己的滚动锚定（补偿由这里手动做）。 */
  containerProps: {
    role: 'list';
    style: CSSProperties;
    onFocus(event: FocusEvent<HTMLElement>): void;
    onBlur(event: FocusEvent<HTMLElement>): void;
  };
}

interface Pending {
  key: string;
  align: Align;
  tries: number;
  resolve(done: boolean): void;
}

interface View {
  top: number;
  height: number;
  width: number;
  /** 量过容器了没有：没量过（刚挂载、容器还没出现）不挂行，免得按猜的宽高挂一批马上又换掉。 */
  known: boolean;
}

const UNKNOWN: RowLayout = { offsets: new Float64Array(1), total: 0 };

/**
 * 不定高的纵向虚拟列表（纯函数在 model/virtual-rows.ts）：只挂视口前后 `overscan` 屏的行与钉住的行，其余折成空白 div；
 * 行在正常文档流里，没有绝对定位。行高按 key 缓存 ResizeObserver 量到的 border-box 高，容器内容宽一变，没挂着的行的旧高作废。
 *
 * 浏览器的滚动锚定关掉（`overflow-anchor: none`），由这里补：视口上方的行量出来与估计不同时，在 ResizeObserver 回调里（排版后、
 * 绘制前）把 scrollTop 补上差值；行增删、估计变了时在 layout effect 里按锚点那一行的 key 补。正确性不靠 requestAnimationFrame
 * （面板隐藏时它不触发）：量高走 ResizeObserver 与 layout effect 里同步读，滚动目标写下去就同步改窗口。
 */
export function useVirtualRows({
  scrollRef,
  keys,
  estimate,
  overscan = 1,
  pinned = [],
  sticky = [],
  measureKey = '',
}: VirtualRowsOptions): VirtualRows {
  const [view, setView] = useState<View>({ top: 0, height: 0, width: 0, known: false });
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focused = useRef(focusKey);
  focused.current = focusKey;
  /** 子组件要求挂着的行：key → 几处在要求。 */
  const [held, setHeld] = useState<ReadonlyMap<string, number>>(() => new Map());
  const holds = useRef(new Map<string, (on: boolean) => void>()).current;

  const heights = useRef(new Map<string, number>()).current;
  const elements = useRef(new Map<string, HTMLElement>()).current;
  const keyOf = useRef(new WeakMap<Element, string>()).current;
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>()).current;
  /** 刚挂上、还没量过的行：layout effect 里同步量（不等 ResizeObserver）。 */
  const fresh = useRef(new Set<string>()).current;
  const observer = useRef<ResizeObserver | null>(null);
  /** DOM 现在对应的排版（空白段按它画、挂着的行按量到的高）：补偿都拿它当「之前」。 */
  const baseline = useRef<{ keys: readonly string[]; layout: RowLayout } | null>(null);
  const pending = useRef<Pending | null>(null);
  const written = useRef<{ value: number; at: number }[]>([]);
  /** 上次已知的 scrollTop（scroll 事件、自己写的、每次提交补完后）：内容变矮时浏览器先把 scrollTop 夹到底，补锚点要拿夹之前的。 */
  const lastTop = useRef(0);
  /** 量高用的内容宽（ResizeObserver 回调里判断宽度变了没有，不等渲染）。 */
  const widthRef = useRef(0);

  const width = view.width;
  /** 量过的高属于哪种画法：换了（比如换了视图）没挂着的行的旧高作废。 */
  const measuredFor = useRef(measureKey);
  // 估计只在行、估计函数或宽度变了时算（逐字估行数，上千行不便宜）；量到新高时只重新累加。
  const estimates = useMemo(() => {
    if (measuredFor.current !== measureKey) {
      // 挂着的行内容一变 ResizeObserver 会重量；没挂着的回到新的估计，免得滚回去时用错高、总高一块块地跳。
      measuredFor.current = measureKey;
      for (const key of [...heights.keys()]) if (!elements.has(key)) heights.delete(key);
    }
    return view.known ? Float64Array.from(keys, (_, i) => estimate(i, width)) : null;
  }, [keys, estimate, width, view.known, measureKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(
    () => (estimates ? layoutRows(keys, heights, (i) => estimates[i]!) : UNKNOWN),
    // version：量到的高变了
    [estimates, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const indexOf = useMemo(() => new Map(keys.map((key, i) => [key, i])), [keys]);
  const viewport = view.height || FALLBACK_VIEWPORT;
  const range = rowRange(layout, view.top, viewport, overscan * viewport);
  const focusIndex = focusKey === null ? undefined : indexOf.get(focusKey);
  const pins: number[] = [];
  for (const key of pinned) {
    const i = key == null ? undefined : indexOf.get(key);
    if (i !== undefined) pins.push(i);
  }
  if (focusIndex !== undefined) pins.push(focusIndex - 1, focusIndex, focusIndex + 1);
  for (const key of held.keys()) {
    const i = indexOf.get(key);
    if (i !== undefined) pins.push(i);
  }
  if (sticky.length && estimates) {
    // 视口上沿所在行之前最近的吸顶行（二分）。
    const top = rowAt(layout, view.top);
    let lo = 0;
    let hi = sticky.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sticky[mid]! <= top) {
        hit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (hit >= 0) pins.push(sticky[hit]!);
  }
  const pinKey = pins.join(',');
  const segments = useMemo(
    () => (estimates ? rowSegments(layout, range, pins) : []),
    [layout, range[0], range[1], pinKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 渲染之外（回调、effect）要读最新的。
  const latest = useRef({ keys, layout, indexOf, range, overscan });
  latest.current = { keys, layout, indexOf, range, overscan };

  /** 写 scrollTop 并记下读回来的值（浏览器会夹到底），scroll 事件来时据此认出是自己滚的；窗口同步跟上。 */
  const write = useCallback(
    (el: HTMLElement, top: number) => {
      const before = el.scrollTop;
      el.scrollTop = top;
      const now = el.scrollTop;
      lastTop.current = now;
      if (Math.abs(now - before) >= 0.5) written.current.push({ value: now, at: performance.now() });
      setView((v) => (v.top === now ? v : { ...v, top: now }));
    },
    [setView],
  );

  /** 一批量到的高（key → border-box 高）：对 DOM 现在的排版补锚点、记进缓存。返回有没有变。 */
  const apply = useCallback(
    (measured: Iterable<[string, number]>): boolean => {
      const base = baseline.current;
      const changed = new Map<string, number>();
      for (const [key, height] of measured) {
        const previous = heights.get(key);
        heights.set(key, height);
        // 与 DOM 现在的排版里这一行的高比（没量过的行在那里是估计）。
        const index = latest.current.indexOf.get(key);
        const modeled = base && index !== undefined && base.keys[index] === key ? rowHeight(base.layout, index) : previous;
        if (modeled === undefined || Math.abs(modeled - height) > EPSILON) changed.set(key, height);
      }
      if (!changed.size) return false;
      const el = scrollRef.current;
      if (base && el) {
        // DOM 现在 = 之前的排版里换上这几行的真高（空白段只含没挂的行，没变）。
        const after = layoutRows(base.keys, changed, (i) => rowHeight(base.layout, i));
        if (!pending.current && el.scrollTop > 0) {
          const shift = anchorShift(base.layout, after, rowAt(base.layout, el.scrollTop));
          if (Math.abs(shift) >= 0.5) write(el, el.scrollTop + shift);
        }
        baseline.current = { keys: base.keys, layout: after };
      }
      return true;
    },
    [heights, scrollRef, write],
  );

  /** 有 scrollToIndex 在等：按现在的排版重算目标，没对准就写，对准了且那一行挂着量过就 resolve。 */
  const settle = useCallback(() => {
    const request = pending.current;
    const el = scrollRef.current;
    const base = baseline.current;
    if (!request) return;
    const finish = (done: boolean) => {
      pending.current = null;
      request.resolve(done);
    };
    // 容器还没量过：等量过的那次提交再对。
    if (el && !base) return;
    const index = latest.current.indexOf.get(request.key);
    if (!el || !base || index === undefined || base.keys[index] !== request.key) return finish(false);
    const target = alignedScrollTop(base.layout, index, el.clientHeight, el.scrollTop, request.align);
    const want = Math.min(target, Math.max(0, el.scrollHeight - el.clientHeight));
    const ready = elements.has(request.key) && heights.has(request.key);
    if (Math.abs(el.scrollTop - want) <= 1 && ready) return finish(true);
    if (++request.tries > MAX_SETTLE) return finish(ready);
    if (Math.abs(el.scrollTop - want) > 1) write(el, want);
    // 已经对准但那一行还没挂上（窗口落后）：再渲染一遍。
    else bump();
  }, [elements, heights, scrollRef, write]);

  const getObserver = useCallback((): ResizeObserver => {
    if (observer.current) return observer.current;
    const ro = new ResizeObserver((entries) => {
      const el = scrollRef.current;
      const measured: [string, number][] = [];
      let resized: View | null = null;
      for (const entry of entries) {
        if (entry.target === el) {
          resized = { top: el.scrollTop, height: el.clientHeight, width: contentWidth(el), known: true };
          continue;
        }
        const key = keyOf.get(entry.target);
        if (key === undefined || !entry.target.isConnected || elements.get(key) !== entry.target) continue;
        measured.push([key, entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height]);
      }
      let changed = false;
      if (resized) {
        const next = resized;
        if (next.width !== widthRef.current) {
          // 内容宽变了：没挂着的行的旧高作废（回到按新宽度的估计），挂着的行这里当场重量一遍。
          widthRef.current = next.width;
          for (const key of [...heights.keys()]) if (!elements.has(key)) heights.delete(key);
          for (const [key, element] of elements) if (element.isConnected) measured.push([key, element.getBoundingClientRect().height]);
          changed = true;
        }
        setView((v) =>
          v.width === next.width && v.height === next.height ? v : { ...v, height: next.height, width: next.width, known: true },
        );
      }
      if (apply(measured)) changed = true;
      if (changed) bump();
      settle();
    });
    observer.current = ro;
    return ro;
  }, [apply, elements, heights, keyOf, scrollRef, settle]);

  const measureRef = useCallback(
    (key: string) => {
      let callback = callbacks.get(key);
      if (!callback) {
        callback = (element: HTMLElement | null) => {
          const previous = elements.get(key);
          if (previous && previous !== element) {
            observer.current?.unobserve(previous);
            elements.delete(key);
          }
          if (!element) return;
          elements.set(key, element);
          keyOf.set(element, key);
          fresh.add(key);
          getObserver().observe(element);
        };
        callbacks.set(key, callback);
      }
      return callback;
    },
    [callbacks, elements, fresh, getObserver, keyOf],
  );

  /** 接上滚动容器：量视口、听滚动、看容器尺寸。返回拆下的函数。 */
  const attach = useCallback(
    (el: HTMLElement) => {
      widthRef.current = contentWidth(el);
      setView({ top: el.scrollTop, height: el.clientHeight, width: widthRef.current, known: true });
      const ro = getObserver();
      ro.observe(el);
      for (const element of elements.values()) ro.observe(element);
      const onScroll = () => {
        const top = el.scrollTop;
        lastTop.current = top;
        const now = performance.now();
        written.current = written.current.filter((w) => now - w.at < PROGRAMMATIC_TTL);
        const hit = written.current.findIndex((w) => Math.abs(w.value - top) <= 1);
        if (hit >= 0) written.current.splice(hit, 1);
        else if (pending.current) {
          // 用户自己滚了：不再追着对准。
          const request = pending.current;
          pending.current = null;
          request.resolve(false);
        }
        // 焦点所在的元素被卸掉（行内输入框按 Esc 关了之类）时浏览器不发 blur：滚动时看一眼，焦点已不在列表里就不再钉那一行。
        if (focused.current !== null && !el.contains(document.activeElement)) setFocusKey(null);
        const { layout, range, overscan } = latest.current;
        const height = el.clientHeight || FALLBACK_VIEWPORT;
        const next = rowRange(layout, top, height, overscan * height);
        const update = () => setView((v) => (v.top === top ? v : { ...v, top }));
        // 窗口要换：同步画（scroll 事件在绘制前派发），拖滚动条时不露出空白。
        if (next[0] !== range[0] || next[1] !== range[1]) flushSync(update);
        else update();
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
        observer.current = null;
      };
    },
    [elements, getObserver],
  );
  // 滚动容器可能晚于这个 hook 出现（面板先画「正在读取…」）：每次提交后看一眼，换了就重接。
  const attached = useRef<{ el: HTMLElement; detach(): void } | null>(null);
  useLayoutEffect(
    () => () => {
      attached.current?.detach();
      attached.current = null;
    },
    [],
  );

  // 每次提交后：排版变了（行增删、估计变了、宽度变了）按锚点行的 key 补；刚挂上的行同步量；再看有没有等着对准的。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (attached.current?.el !== el) {
      attached.current?.detach();
      attached.current = el ? { el, detach: attach(el) } : null;
    }
    const base = baseline.current;
    if (el && base && base.layout !== layout && !pending.current) {
      // 新排版比原来矮（比如换成只看译文）时，这次提交后浏览器已把 scrollTop 夹到了底：锚点按夹之前的位置找。
      const now = el.scrollTop;
      const clamped = lastTop.current > now + 0.5 && now >= el.scrollHeight - el.clientHeight - 1;
      const top = clamped ? lastTop.current : now;
      const anchor = top > 0 ? rowAt(base.layout, top) : -1;
      const index = anchor < 0 ? undefined : indexOf.get(base.keys[anchor]!);
      if (index !== undefined) {
        const target = layout.offsets[index]! + (top - base.layout.offsets[anchor]!);
        if (Math.abs(target - now) >= 0.5) write(el, target);
      }
    }
    // 还没量过容器、没挂行：没有可补的排版（等量过的那次提交）。
    baseline.current = estimates ? { keys, layout } : null;
    let changed = false;
    if (fresh.size) {
      const measured: [string, number][] = [];
      for (const key of fresh) {
        const element = elements.get(key);
        if (element?.isConnected) measured.push([key, element.getBoundingClientRect().height]);
      }
      fresh.clear();
      changed = apply(measured);
    }
    if (changed) bump();
    settle();
    if (el) lastTop.current = el.scrollTop;
  });

  const scrollToIndex = useCallback(
    (index: number, options?: { align?: Align }) =>
      new Promise<boolean>((resolve) => {
        pending.current?.resolve(false);
        const key = latest.current.keys[index];
        if (key === undefined) {
          pending.current = null;
          return resolve(false);
        }
        pending.current = { key, align: options?.align ?? 'nearest', tries: 0, resolve };
        // 放到微任务里同步画：多半是从 effect 里调的（那里 flushSync 不生效），微任务仍在这一帧绘制之前，跳过去不露空白。
        queueMicrotask(() => {
          if (pending.current?.resolve === resolve) flushSync(settle);
        });
      }),
    [settle],
  );

  const scrollTo = useCallback(
    (top: number) => {
      const el = scrollRef.current;
      if (el) write(el, top);
    },
    [scrollRef, write],
  );

  const rowTop = useCallback((index: number) => layout.offsets[Math.max(0, Math.min(index, layout.offsets.length - 1))]!, [layout]);

  const holdRow = useCallback(
    (key: string) => {
      let hold = holds.get(key);
      if (!hold) {
        hold = (on: boolean) =>
          setHeld((map) => {
            const count = (map.get(key) ?? 0) + (on ? 1 : -1);
            const next = new Map(map);
            if (count > 0) next.set(key, count);
            else next.delete(key);
            return next;
          });
        holds.set(key, hold);
      }
      return hold;
    },
    [holds],
  );

  const containerProps = useMemo<VirtualRows['containerProps']>(
    () => ({
      role: 'list',
      style: { overflowAnchor: 'none' },
      onFocus: (event) => {
        let node: Element | null = event.target;
        while (node && node !== event.currentTarget) {
          const key = keyOf.get(node);
          if (key !== undefined) return setFocusKey(key);
          node = node.parentElement;
        }
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusKey(null);
      },
    }),
    [keyOf],
  );

  return { segments, measureRef, scrollToIndex, scrollTo, rowTop, holdRow, containerProps };
}

/** 行外层交给子组件的「别卸掉这一行」开关（`VirtualRows.holdRow(key)`）；不在虚拟列表里时没有。 */
export const RowHoldContext = createContext<((on: boolean) => void) | null>(null);

/** `on` 为真时让所在的行一直挂着（菜单开着、行内输入框开着……）；不在虚拟列表里什么也不做。 */
export function useHoldRow(on: boolean): void {
  const hold = useContext(RowHoldContext);
  useLayoutEffect(() => {
    if (!on || !hold) return;
    hold(true);
    return () => hold(false);
  }, [on, hold]);
}

/** 容器的内容宽（去掉内边距与滚动条）。 */
function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return Math.round(el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
}
