import { useRef } from 'react';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { HELP_COPY } from '../copy.ts';
import { sidebarToggleLabel } from '../model/sidebar-toggle.ts';
import { workspaceKey } from '../model/workspace.ts';
import { useHelp } from '../state/help-store.ts';
import { hasSidebar, railTabOf, useShell } from '../state/shell-store.ts';
import { usePaneDividers } from './pane-edges.ts';
import { ShellButton } from './shell-button.tsx';
import { ShellSidebarHiddenIcon, ShellSidebarIcon } from './shell-icons.tsx';
import { useShellPeekControls } from './shell-peek.tsx';
import { HomeTitleBar } from './workspace/home-title-bar.tsx';

const bar = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 44,
  paddingEnd: 12,
});
const nav = style({ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 });
const toggleWrap = style({ display: 'inline-flex' });
/** 应用名居中在内容区上方：从最后一根分界到右缘（没有分界时是整条标题栏）。 */
const titleArea = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetEnd: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  paddingX: 48,
  pointerEvents: 'none',
});
const title = style({ font: 'ui', fontWeight: 'bold', color: 'gray-800' });
/** 右侧的动作（原型 .tbar__acts）：压在居中的应用名之上。 */
const acts = style({ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4, marginStart: 'auto' });
const divider = style({
  position: 'absolute',
  top: 12,
  bottom: 12,
  width: '[1px]',
  backgroundColor: 'gray-100',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
});

/**
 * 标题栏（产品设计 §2.2、§2.5 用户修订）：后退、前进，然后是侧栏开合；应用名居中在内容区上方；
 * 下方各栏的分界延伸上来。整条可以拖动窗口；macOS 的红绿灯在左边，留出位置。
 * Home 总有视图按钮组（见 HomeTitleBar）；有会话或功能区标签（或是窄窗口）时再换上会话头与标签条，不显示应用名。
 */
export function TitleBar({ platform }: { platform: string }) {
  const route = useShell((s) => s.route);
  const canBack = useShell((s) => s.back.length > 0);
  const canForward = useShell((s) => s.forward.length > 0);
  const sidebarHidden = useShell((s) => s.sidebarHidden);
  const { goBack, goForward, toggleSidebar } = useShell.getState();
  const ref = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const dividers = usePaneDividers(ref);
  const home = route.tab === 'home' ? route : null;
  const homeTabs = useShell((s) => (home ? (s.workspaces[workspaceKey(home.conversationId, home.projectId)]?.tabs.length ?? 0) : 0));
  const narrow = useShell((s) => s.workspaceNarrow);
  const peek = useShellPeekControls();
  // 窄窗口里会话本身是标签条的第一格，没有标签时也要显示标签条。
  const homeMode = home !== null && (home.conversationId !== null || homeTabs > 0 || narrow);
  return (
    <div ref={ref} className={`${bar} bc-drag`} style={{ paddingInlineStart: platform === 'darwin' ? 84 : 12 }}>
      {dividers.map((x) => (
        <span key={x} className={divider} style={{ left: x }} aria-hidden="true" />
      ))}
      {/* 应用名这层继承了拖动区，pointer-events 管不到它：Electron 按文档顺序叠拖动区，放在按钮前面，
          侧栏收起、它从左缘铺开时按钮的 no-drag 才压得住它（否则点开合钮只会拖动窗口）。 */}
      {homeMode ? null : (
        <div className={titleArea} style={{ left: dividers.at(-1) ?? 0 }}>
          <span className={title}>BaoCut</span>
        </div>
      )}
      {/* `data-shell-peek-keep`：在导航区按下不关侧栏浮层（开合钮自己处理）。 */}
      <div ref={navRef} className={nav} data-shell-peek-keep="">
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={S.common.back} isDisabled={!canBack} onPress={goBack}>
            <ChevronLeft />
          </ActionButton>
          <Tooltip>{S.titleBar.backTip}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={S.common.forward} isDisabled={!canForward} onPress={goForward}>
            <ChevronRight />
          </ActionButton>
          <Tooltip>{S.titleBar.forwardTip}</Tooltip>
        </TooltipTrigger>
        {hasSidebar(route) ? (
          // 开合钮不画按下态：状态由图标（开着与已隐藏两枚外壳图形）和提示 / 读屏名称表达（原型 shell.jsx）。
          // 侧栏隐藏时悬停它浮出当前区域的侧栏；用它收起侧栏后，指针离开它之前不再浮出（产品设计 §2.5）。
          <span
            className={`${toggleWrap} bc-no-drag`}
            onPointerEnter={() => peek?.peekSidebar(railTabOf(route))}
            onPointerLeave={() => {
              peek?.releaseToggle();
              peek?.leaveSidebar();
            }}>
            <ShellButton
              label={sidebarToggleLabel(sidebarHidden)}
              onPress={() => {
                peek?.suppressToggle();
                toggleSidebar();
              }}>
              {sidebarHidden ? <ShellSidebarHiddenIcon /> : <ShellSidebarIcon />}
            </ShellButton>
          </span>
        ) : null}
      </div>
      {home ? (
        <HomeTitleBar conversationId={home.conversationId} projectId={home.projectId} pane={home.pane ?? null} bar={ref} nav={navRef} />
      ) : null}
      {sidebarHidden && !home ? (
        // 帮助入口（原型 shell.jsx `sidebar.ghost && !home`）：侧栏收起时、Home 之外才放在标题栏。
        <div className={acts}>
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={HELP_COPY.entryLabel} onPress={(event) => useHelp.getState().open(event.target)}>
              <HelpCircle />
            </ActionButton>
            <Tooltip>{HELP_COPY.entry}</Tooltip>
          </TooltipTrigger>
        </div>
      ) : null}
    </div>
  );
}
