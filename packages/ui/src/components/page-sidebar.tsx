import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { SIDEBAR_SLIDE, sidebarSlide } from '../model/sidebar-toggle.ts';
import { SIDEBAR_DEFAULT, useShell, type Route } from '../state/shell-store.ts';
import { paneEdge } from './pane-edges.ts';

/**
 * 区域内边距 16（Spectrum layout spacing 300）；行用整行底色表达当前页与 hover（产品设计 §3.1 用户修订），
 * 颜色经 CSS 变量交给 app.css 里替换 S2 指示条的那几条规则。
 */
const aside = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  boxSizing: 'border-box',
  minHeight: 0,
  padding: 16,
  borderEndWidth: 2,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  '--bc-row-hover': { type: 'backgroundColor', value: 'gray-75' },
  '--bc-row-current': { type: 'backgroundColor', value: 'gray-100' },
});
const title = style({ flexShrink: 0, marginX: 8, marginTop: 0, marginBottom: 16, fontSize: '[18px]', fontWeight: 'bold', lineHeight: '[24px]', color: 'gray-900' });
/** 侧栏里可滚动的那一段（SideNav）。 */
export const sidebarBody = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto' });
const note = style({ flexShrink: 0, marginX: 8, marginTop: 16, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
/**
 * 开合动画的两层（原型 shell.jsx `SideSlide`、ui.css `.sideslide`）：外层定位拖动条，裁切层的宽度在开合时从 0 拉开、收回 0，
 * 侧栏本身保持自己的宽度、只被裁切，内容不跟着挤压换行。拖动条放在裁切层外面，它左右各伸出 4px 骑在交界上，
 * 放进去会被裁掉一半；外层没有自己的宽度，跟着裁切层的右沿走。
 */
const slideFrame = style({ position: 'relative', display: 'flex', flexShrink: 0, minHeight: 0 });
const slideClip = style({ display: 'flex', flexShrink: 0, minWidth: 0, minHeight: 0, overflow: 'hidden' });
/** 侧栏右沿的拖动条：可拖宽、双击复原（产品设计 §2.2）。 */
const resizer = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetEnd: -4,
  width: 8,
  cursor: 'col-resize',
  zIndex: 2,
});

/**
 * 侧栏浮出（产品设计 §2.5；原型 home-shell-chrome.jsx `ShellPeek` 用 AppCtx 覆盖 route）：浮层里的侧栏以浮出区域的路由为上下文，
 * 不随侧栏隐藏卸载、不画右沿分界与拖动条。常驻侧栏没有这层，读 store 的当前路由。
 */
export const SidebarPeekContext = createContext<{ route: Route; go: (route: Route) => void } | null>(null);

/** 侧栏用来判断当前位置的路由：在浮层里是浮出区域的路由，否则是 store 的当前路由。 */
export function useSidebarRoute(): Route {
  const peek = useContext(SidebarPeekContext);
  const route = useShell((s) => s.route);
  return peek?.route ?? route;
}

/** 侧栏里的跳转：在浮层里先关浮层再跳（去的就是当前路由时也关），否则就是 store 的 `go`。 */
export function useSidebarGo(): (route: Route) => void {
  const peek = useContext(SidebarPeekContext);
  const go = useShell((s) => s.go);
  return peek?.go ?? go;
}

/**
 * 页面侧栏的外框（各入口共用）：宽度可拖，标题栏的开合钮可以把它收起。开合时裁切层的宽度用 Web Animations 动一次
 * （时长与曲线同 S2 的默认过渡）；拖动改宽不带过渡；系统要求减少动效时直接开合。收起时动画结束才卸载，期间照常显示内容；
 * 中途反向从此刻的宽度接着走。标题栏的分界挂在裁切层上，跟着动画中的右沿走。
 */
export function PageSidebar({ label, children }: { label: string; children: ReactNode }) {
  const peek = useContext(SidebarPeekContext);
  return peek ? <PeekSidebar label={label}>{children}</PeekSidebar> : <DockedSidebar label={label}>{children}</DockedSidebar>;
}

/** 浮层里的侧栏：只有侧栏本身，宽度同常驻侧栏；高度、去掉右沿分隔线见 app.css `[data-shell-peek]`。 */
function PeekSidebar({ label, children }: { label: string; children: ReactNode }) {
  const width = useShell((s) => s.sidebarWidth);
  return (
    <aside className={aside} style={{ width }} aria-label={label}>
      {children}
    </aside>
  );
}

function DockedSidebar({ label, children }: { label: string; children: ReactNode }) {
  const width = useShell((s) => s.sidebarWidth);
  const hidden = useShell((s) => s.sidebarHidden);
  const setWidth = useShell((s) => s.setSidebarWidth);
  const [mounted, setMounted] = useState(!hidden);
  if (!hidden && !mounted) setMounted(true);
  const clip = useRef<HTMLDivElement | null>(null);
  const shown = useRef(!hidden);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const open = !hidden;
    if (shown.current === open) return;
    shown.current = open;
    const element = clip.current;
    if (!element) return;
    // 先量此刻的宽度，再取消上一段动画量出侧栏的自然宽度。
    const running = element.getAnimations().length > 0;
    const now = element.getBoundingClientRect().width;
    element.getAnimations().forEach((old) => old.cancel());
    animation.current = null;
    const full = element.getBoundingClientRect().width;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!open) setMounted(false);
      return;
    }
    const slide = sidebarSlide({ open, running, now, full });
    const next = element.animate([{ width: `${slide.from}px` }, { width: `${slide.to}px` }], { ...SIDEBAR_SLIDE, fill: slide.fill });
    animation.current = next;
    if (!open) next.onfinish = () => setMounted(false);
    else if (!running) {
      // 从收起打开时侧栏刚挂上，挂载的那一段主线程工作会吃掉动画的前半程：先停在 0，等挂载之后的一帧过去再开始走
      // （挂载后紧接着的那一帧时间戳是旧的，在那里开始仍会跳过一截）。
      next.pause();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (animation.current === next) next.play();
        }),
      );
    }
  }, [hidden]);
  // 换页时侧栏随页面卸载：停掉还在走的动画，不留结束回调。
  useEffect(() => () => animation.current?.cancel(), []);

  const clipRef = useCallback((element: HTMLDivElement) => {
    clip.current = element;
    const offEdge = paneEdge(element);
    return () => {
      clip.current = null;
      offEdge();
    };
  }, []);

  if (!mounted) return null;
  return (
    <div className={slideFrame}>
      <div ref={clipRef} className={slideClip}>
        <aside className={aside} style={{ width }} aria-label={label}>
          {children}
        </aside>
      </div>
      <SidebarResizer width={width} onResize={setWidth} />
    </div>
  );
}

/** 每个页面侧栏顶上的区域标题（产品设计 §2、§3.1 用户修订）。 */
export function SidebarTitle({ children }: { children: ReactNode }) {
  return <h2 className={title}>{children}</h2>;
}

/** 侧栏底部的一句说明。 */
export function SidebarNote({ children }: { children: ReactNode }) {
  return <p className={note}>{children}</p>;
}

function SidebarResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(start.current.width + event.clientX - start.current.x);
  };
  const onPointerUp = () => {
    start.current = null;
  };
  return (
    <div
      className={resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label={S.pageSidebar.resize}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => onResize(SIDEBAR_DEFAULT)}
    />
  );
}
