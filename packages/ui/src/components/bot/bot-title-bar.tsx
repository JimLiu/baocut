import { useLayoutEffect, useState, type RefObject } from 'react';
import Bell from '@react-spectrum/s2/icons/Bell';
import Comment from '@react-spectrum/s2/icons/Comment';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { botBarBounds } from '../../model/bot-side.ts';
import { usePaneRegions } from '../pane-edges.ts';
import { workspaceTabStyles as T } from '../workspace/workspace-tabs.tsx';
import { BOT_COPY as C } from './bot-copy.ts';
import { BotHead } from './bot-head.tsx';
import { useBotSide, type BotRouteView, type BotSide } from './bot-side-state.ts';
import { BotSideTabs, type BotHomeTab } from './bot-side-tabs.tsx';

/** 原型 `.tbar__conversation--bot`。 */
const head = style({ position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' });
/** 原型 `.tbar__workspace--bot`：空白继承标题栏的拖动区，页签与按钮自己让开。 */
const strip = style({ position: 'absolute', top: 0, bottom: 0, display: 'flex', minWidth: 0 });
/** 不占满时右栏左缘那根竖线，和标题栏的其他分界一样（原型 `.tbar__workspace--bot.has-divider::before`）。 */
const divider = style({
  position: 'absolute',
  top: 12,
  bottom: 12,
  insetStart: 0,
  width: '[1px]',
  backgroundColor: 'gray-100',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
});

/** 窄时中间栏那个固定页签：频道或「等你处理」。 */
export function botHomeTab(side: BotSide): BotHomeTab | null {
  if (!side.single) return null;
  if (side.inbox) return { name: C.inbox.title, aria: C.side.inboxTab, icon: <Bell UNSAFE_style={T.icon} /> };
  if (!side.channel) return null;
  return { name: side.channel.name, aria: C.side.channelTab(side.channel.name), icon: <Comment UNSAFE_style={T.icon} /> };
}

/**
 * Bot 页的标题栏（需求 §11.1 的修订稿，原型 page-bot.jsx 的 useTitlebarSlot 那段）：照 Home 的标题栏，
 * 中间栏上方是它的标题（频道头、「等你处理」、记忆页的标题），右栏上方是页签条，左缘跟着右栏；右栏收起时标题铺到右端，
 * 占满时只有页签条。窄时只剩一栏，标题栏是一条页签条，最前面是中间栏，标题放回中间栏顶上（BotPage）。
 * 位置跟着 BotPage 登记的三块区域（pane-edges.ts 的 bot-content / bot-main / bot-side）。
 */
export function BotTitleBar({
  route,
  bar,
  nav,
}: {
  route: BotRouteView;
  bar: RefObject<HTMLElement | null>;
  nav: RefObject<HTMLElement | null>;
}) {
  const side = useBotSide(route);
  const regions = usePaneRegions();
  const [bounds, setBounds] = useState<ReturnType<typeof botBarBounds> | null>(null);

  // 每次渲染后对一次：区域的左右缘由 usePaneRegions 推过来，标题栏与后退前进的位置在这里量。
  useLayoutEffect(() => {
    const box = bar.current?.getBoundingClientRect();
    const navRight = nav.current?.getBoundingClientRect().right;
    if (!box || navRight === undefined) return;
    const next = botBarBounds({
      origin: box.left,
      width: box.width,
      navRight,
      content: regions['bot-content'] ?? null,
      main: regions['bot-main'] ?? null,
      side: regions['bot-side'] ?? null,
      shown: side.shown,
      single: side.single,
    });
    setBounds((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  });

  return (
    <>
      {bounds?.head ? (
        <div className={head} style={{ left: bounds.head.left, width: bounds.head.width }}>
          <BotHead route={route} side={side} />
        </div>
      ) : null}
      {bounds?.strip ? (
        <div className={strip} style={{ left: bounds.strip.left, right: bounds.strip.right }}>
          {bounds.divider ? <span className={divider} aria-hidden="true" /> : null}
          <BotSideTabs side={side} home={botHomeTab(side)} />
        </div>
      ) : null}
    </>
  );
}
