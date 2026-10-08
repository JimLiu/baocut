import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { RouterProvider } from 'react-aria-components';
import { S } from './shell-copy.ts';
import {
  PEEK_DELAY_MS,
  PEEK_OVERLAY_SELECTOR,
  closesPeekOnPointerDown,
  closingFirst,
  isCurrentPeek,
  peekBox,
  peekKindOf,
  peekRoute,
  peekStaysOpen,
  type PeekKind,
} from '../model/shell-peek.ts';
import { defaultRoute, useShell, type Route, type Tab } from '../state/shell-store.ts';
import { HomeSidebar } from './home-sidebar.tsx';
import { SidebarPeekContext } from './page-sidebar.tsx';
import { ShellButton } from './shell-button.tsx';
import { ShellSidebarIcon } from './shell-icons.tsx';
import { SpaceSidebar } from './space/space-page.tsx';
import { UtilitySidebar } from './utility-sidebar.tsx';
import { useWorkspaceOverlay } from './workspace/workspace-overlay.ts';

/**
 * 侧栏浮出（产品设计 §2.5「侧栏浮出」；原型 home-shell-chrome.jsx `useShellPeek` / `ShellPeek`）：页面侧栏隐藏时，
 * 指针在 Rail 入口或标题栏的侧栏开关上停 100 ms，浮出该区域的侧栏，盖在内容之上、不改布局。
 * 状态只属于这一层界面，不进 shell store。
 */
export interface ShellPeekControls {
  /** 指针进入某个入口：侧栏隐藏着就在 100 ms 后浮出该区域（设置不浮出）。 */
  peekSidebar(tab: Tab): void;
  /** 指针离开入口或浮层：100 ms 后关闭，浮层里有焦点或开着菜单、对话框时不关。 */
  leaveSidebar(): void;
  /** 指针或焦点回到浮层：取消待关闭。 */
  keepSidebar(): void;
  closePeek(): void;
  /** 用侧栏开关收起侧栏：指针还停在开关上时不再浮出，直到它离开开关（`releaseToggle`）。 */
  suppressToggle(): void;
  releaseToggle(): void;
}

const ControlsContext = createContext<ShellPeekControls | null>(null);
const PeekContext = createContext<{ peek: PeekKind | null; root: RefObject<HTMLDivElement | null> } | null>(null);

/** Rail 与标题栏取浮出的开关；不在 `ShellPeekProvider` 里时（测试、别的宿主）是 null，触发点什么也不做。 */
export function useShellPeekControls(): ShellPeekControls | null {
  return useContext(ControlsContext);
}

/** 真开着的菜单、对话框或确认框；提示区里的 Toast 也是 alertdialog，不算。 */
function overlayOpen(): boolean {
  return Array.from(document.querySelectorAll(PEEK_OVERLAY_SELECTOR)).some((el) => !el.closest('[role="region"]'));
}

export function ShellPeekProvider({ children }: { children: ReactNode }) {
  const [peek, setPeek] = useState<PeekKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressed = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const route = useShell((s) => s.route);
  const hidden = useShell((s) => s.sidebarHidden);

  const controls = useMemo<ShellPeekControls>(() => {
    const cancel = () => clearTimeout(timer.current);
    const closePeek = () => {
      cancel();
      setPeek(null);
    };
    return {
      peekSidebar: (tab) => {
        cancel();
        const kind = peekKindOf(tab);
        if (!kind || suppressed.current || !useShell.getState().sidebarHidden) return;
        timer.current = setTimeout(() => {
          if (useShell.getState().sidebarHidden && !suppressed.current) setPeek(kind);
        }, PEEK_DELAY_MS);
      },
      leaveSidebar: () => {
        cancel();
        timer.current = setTimeout(() => {
          const element = root.current;
          // 指针其实还在浮层里（例如焦点从浮层里的按钮移走）时也不关。
          if (element?.matches(':hover')) return;
          const focusInside = !!element && element.contains(document.activeElement);
          if (!peekStaysOpen({ focusInside, overlayOpen: overlayOpen() })) setPeek(null);
        }, PEEK_DELAY_MS);
      },
      keepSidebar: cancel,
      closePeek,
      suppressToggle: () => {
        suppressed.current = true;
        closePeek();
      },
      releaseToggle: () => {
        suppressed.current = false;
      },
    };
  }, []);

  // 路由变化、侧栏重新显示（或又被收起）时关闭。
  useEffect(() => controls.closePeek(), [controls, route, hidden]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!peek) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !overlayOpen()) controls.closePeek();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (closesPeekOnPointerDown(target)) controls.closePeek();
    };
    // 捕获阶段：S2 提示框在 document 捕获阶段吞掉 Esc（开合钮的提示正开着时），浮层得先看到它。
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [peek, controls]);

  const state = useMemo(() => ({ peek, root }), [peek]);
  return (
    <ControlsContext.Provider value={controls}>
      <PeekContext.Provider value={state}>{children}</PeekContext.Provider>
    </ControlsContext.Provider>
  );
}

/** 浮层：圆角 10（与应用面板同心：面板 16 − 内缩 6）、gray-200 边框、gray-25 底与投影；盖在内容上，压在弹层与对话框之下（z-index 见 app.css）。 */
const frame = style({
  position: 'fixed',
  zIndex: 50,
  display: 'flex',
  overflow: 'hidden',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
  boxShadow: 'elevated',
});
const pin = style({ position: 'absolute', top: 8, insetEnd: 8, zIndex: 1 });

/**
 * 浮出的侧栏。`sheet` 是应用面板（内容区）：浮层距它的上、下、左缘各内缩 6，窗口或面板尺寸变化时重算。
 * 浮出的是别的区域时，侧栏以点那个 Rail 入口会去的路由为上下文渲染；在浮层里选条目会跳转并关闭浮层。
 */
export function ShellPeek({ sheet }: { sheet: RefObject<HTMLElement | null> }) {
  const state = useContext(PeekContext);
  const controls = useContext(ControlsContext);
  const kind = state?.peek ?? null;
  const route = useShell((s) => s.route);
  const lastRoute = useShell((s) => s.lastRoute);
  const hidden = useShell((s) => s.sidebarHidden);
  const [box, setBox] = useState<{ left: number; top: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!kind || !element) return undefined;
    const sync = () => {
      const r = element.getBoundingClientRect();
      setBox(peekBox(r, window.innerHeight));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [kind, sheet]);

  const target = kind ? peekRoute(kind, route, lastRoute[kind] ?? defaultRoute(kind)) : null;
  // 侧栏里命令式的跳转（新建会话、项目菜单）也先关浮层；链接走下面 RouterProvider 的 navigate。
  const scope = useMemo(
    () => (target && controls ? { route: target, go: closingFirst(controls.closePeek, (r: Route) => useShell.getState().go(r)) } : null),
    [target, controls],
  );
  // 浮层显示期间登记为覆盖层，Electron 的内嵌网页视图暂时让开（100 ms 后才浮出，划过 Rail 不会闪）。
  useWorkspaceOverlay(!!(kind && hidden && box && state && scope));
  if (!kind || !hidden || !box || !state || !controls || !scope) return null;

  const current = isCurrentPeek(kind, route);
  const navigate = closingFirst(controls.closePeek, (href: string) => useShell.getState().navigate(href));
  // 固定：恢复常驻侧栏；浮出的是别的区域时同时进入该区域（走该 Rail 入口的目标）。
  const pinSidebar = () => {
    controls.closePeek();
    const shell = useShell.getState();
    if (shell.sidebarHidden) shell.toggleSidebar();
    if (!current) shell.goTab(kind);
  };
  const r = scope.route;
  return (
    <div
      ref={state.root}
      className={`${frame} bc-no-drag`}
      style={box}
      data-shell-peek={kind}
      onPointerEnter={controls.keepSidebar}
      onPointerLeave={controls.leaveSidebar}
      onFocus={controls.keepSidebar}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) controls.leaveSidebar();
      }}>
      <SidebarPeekContext.Provider value={scope}>
        <RouterProvider navigate={navigate}>
          {kind === 'home' ? (
            <HomeSidebar />
          ) : kind === 'space' ? (
            <SpaceSidebar category={r.tab === 'space' ? r.category : 'all'} projectId={r.tab === 'space' ? r.projectId : null} />
          ) : (
            <UtilitySidebar kind={kind} />
          )}
        </RouterProvider>
      </SidebarPeekContext.Provider>
      <div className={pin}>
        <ShellButton label={S.pageSidebar.pin} onPress={pinSidebar}>
          <ShellSidebarIcon />
        </ShellButton>
      </div>
    </div>
  );
}
