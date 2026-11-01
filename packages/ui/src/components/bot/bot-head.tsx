import type { ReactNode } from 'react';
import type { Channel } from '@baocut/protocol';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import ViewList from '@react-spectrum/s2/icons/ListBulleted';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { FixedSideTab } from '../../model/bot-side.ts';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import type { BotRouteView, BotSide } from './bot-side-state.ts';
import { ChannelTitleMenu } from './channel-menu.tsx';
import { ChannelSpend } from './channel-view.tsx';

/**
 * 中间栏的标题（原型 page-bot.css「频道对话」那段、home 的会话头）：照 Home 的会话头一行，左右 12，占满标题栏那一段的高度。
 * 窄时它回到中间栏顶上（BotPage 包一层带分隔线的容器）。
 */
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexGrow: 1,
  minWidth: 0,
  height: 'full',
  boxSizing: 'border-box',
  paddingX: 12,
});
const title = style({
  flexShrink: 1,
  minWidth: 0,
  margin: 0,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
/** 频道名是菜单入口（ChannelTitleMenu）：抵掉安静按钮的一点左内边距，让图标靠近栏的左缘。 */
const titleMenu = style({ display: 'flex', flexShrink: 1, minWidth: 0, margin: 0, marginStart: -8 });
/** 说明的第一行跟在频道名后面，占掉剩下的宽（基准 0：窄时它先让，频道名后让，按钮不缩）；点开编辑说明（需求 §11.3）。 */
const purpose = style({
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  marginStart: 4,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: 'transparent',
  textAlign: 'start',
  cursor: 'pointer',
  font: 'ui-xs',
  color: { default: 'gray-600', isEmpty: 'gray-500', ':hover': 'gray-900' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
});
const grow = style({ flexGrow: 1 });
/** 开关显示右栏时的底色（app.css `.bc-panel-toggle[aria-expanded='true']` 读这个变量；S2 的安静按钮没有选中态）。 */
const toggleOnFill = style({ '--bc-panel-toggle-on': { type: 'backgroundColor', value: 'gray-100' } });
/** 开关右上角的点：「任务」有等你的事、「Make」有建议；数目在读屏名称里。 */
const toggleDot = style({ position: 'absolute', top: 2, insetEnd: 2, size: 8, borderRadius: 'full', backgroundColor: 'blue-900' });

/** 当前这一页的标题：频道头、「等你处理」或记忆页的标题；频道还没载入或不在了时没有。 */
export function BotHead({ route, side }: { route: BotRouteView; side: BotSide }) {
  if (route.view === 'inbox') return <BotInboxHead />;
  if (!side.channel) return null;
  if (route.view === 'memory') return <BotMemoryHead channel={side.channel} />;
  return <BotChannelHead channel={side.channel} side={side} />;
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <TooltipTrigger>
      <ActionButton isQuiet size="S" aria-label={label} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * 频道头（需求 §11.3 修订，原型 page-bot-channel.jsx `BotChannelHead`）：「图标 频道名 ⌄」是频道菜单（设置、记忆、周期任务都收在里面），
 * 说明的第一行点开编辑说明，本月花费（BOT-NF-04），最后是右栏的「任务」「Make」两个开关——只有图标，有等你的事或建议时右上角带点。
 * 开关打开（关掉过的插回原位）并选中那个固定页签，再按一次收起。
 */
function BotChannelHead({ channel, side }: { channel: Channel; side: BotSide }) {
  const go = useShell((s) => s.go);
  const fixedOn = (kind: FixedSideTab) => side.shown && !side.active && side.sideKind === kind;
  const toggle = (kind: FixedSideTab) => (fixedOn(kind) ? side.hide() : side.selectFixed(kind));
  const toggleButton = (kind: FixedSideTab) => {
    const label = kind === 'tasks' ? C.channel.tasks(side.waiting) : C.make.toggle(side.suggestions);
    const marked = kind === 'tasks' ? side.waiting > 0 : side.suggestions > 0;
    return (
      <TooltipTrigger>
        <ActionButton
          isQuiet
          size="S"
          aria-label={label}
          aria-expanded={fixedOn(kind)}
          onPress={() => toggle(kind)}
          UNSAFE_className={`bc-panel-toggle ${toggleOnFill}`}
        >
          {kind === 'tasks' ? <ViewList /> : <MagicWand />}
          {marked ? <span className={toggleDot} aria-hidden="true" /> : null}
        </ActionButton>
        <Tooltip>{kind === 'tasks' ? C.panel.title : C.make.title}</Tooltip>
      </TooltipTrigger>
    );
  };
  return (
    <div className={row}>
      <h1 className={titleMenu}>
        <ChannelTitleMenu channel={channel} go={go} />
      </h1>
      <button
        type="button"
        className={purpose({ isEmpty: !channel.purpose })}
        title={channel.purpose || undefined}
        aria-label={channel.purpose ? C.channel.instructions(channel.purpose) : C.channel.writeInstructions}
        onClick={() => useBotLayout.getState().setDialog({ kind: 'instructions', channelId: channel.id })}
      >
        {channel.purpose ? channel.purpose.split('\n')[0] : C.channel.noPurpose}
      </button>
      <ChannelSpend channelId={channel.id} />
      {toggleButton('tasks')}
      {toggleButton('make')}
    </div>
  );
}

function BotInboxHead() {
  return (
    <div className={row}>
      <h1 className={title}>{C.inbox.title}</h1>
      <span className={grow} />
    </div>
  );
}

/** 记忆页的标题（原型 page-bot-memory.jsx `BotMemoryHead`）：「‹ 记忆 · 频道名」。 */
function BotMemoryHead({ channel }: { channel: Channel }) {
  const go = useShell((s) => s.go);
  return (
    <div className={row}>
      <IconButton label={C.detail.back} onPress={() => go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'channel' })}>
        <ChevronLeft />
      </IconButton>
      <h1 className={title}>{`${C.memory.title} · ${channel.name}`}</h1>
      <span className={grow} />
    </div>
  );
}
