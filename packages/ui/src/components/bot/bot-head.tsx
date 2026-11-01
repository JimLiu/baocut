import { useState, type ReactNode } from 'react';
import type { Channel } from '@baocut/protocol';
import { ActionButton, DialogContainer, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import CalendarAdd from '@react-spectrum/s2/icons/CalendarAdd';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Settings from '@react-spectrum/s2/icons/Settings';
import ViewList from '@react-spectrum/s2/icons/ListBulleted';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { FixedSideTab } from '../../model/bot-side.ts';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ScheduleDialog } from '../agent-schedule/schedule-dialog.tsx';
import { BOT_COPY as C } from './bot-copy.ts';
import type { BotRouteView, BotSide } from './bot-side-state.ts';
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
/** 说明的第一行跟在频道名后面，占掉剩下的宽（基准 0：窄时它先让，频道名后让，按钮不缩）。 */
const purpose = style({
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  marginStart: 4,
  font: 'ui-xs',
  color: { default: 'gray-600', isEmpty: 'gray-500' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

function IconButton({
  label,
  onPress,
  isDisabled,
  children,
}: {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger>
      <ActionButton isQuiet size="S" aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * 频道头（需求 §11.3，原型 page-bot-channel.jsx `BotChannelHead`）：频道名、说明的第一行与本月花费，
 * 记忆、周期任务与设置，最后是右栏的「任务」「Make」两个开关——只有图标，有等你的事或建议时右上角带点。
 * 开关打开（关掉过的插回原位）并选中那个固定页签，再按一次收起。
 */
function BotChannelHead({ channel, side }: { channel: Channel; side: BotSide }) {
  const go = useShell((s) => s.go);
  const [scheduling, setScheduling] = useState(false);
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
      <h1 className={title} title={channel.name}>
        {channel.name}
      </h1>
      <span className={purpose({ isEmpty: !channel.purpose })} title={channel.purpose || undefined}>
        {channel.purpose || C.channel.noPurpose}
      </span>
      <ChannelSpend channelId={channel.id} />
      <IconButton label={C.channel.memory} onPress={() => go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'memory' })}>
        <Bookmark />
      </IconButton>
      {/* 周期任务（Bot 技术方案 §14.1）：每次到点在这个频道里建一条任务。 */}
      <IconButton label={C.channel.recurring} isDisabled={channel.archived} onPress={() => setScheduling(true)}>
        <CalendarAdd />
      </IconButton>
      <IconButton label={C.sidebar.settings} onPress={() => useBotLayout.getState().setSettingsFor(channel.id)}>
        <Settings />
      </IconButton>
      {toggleButton('tasks')}
      {toggleButton('make')}
      <DialogContainer onDismiss={() => setScheduling(false)}>
        {scheduling ? <ScheduleDialog channelId={channel.id} onClose={() => setScheduling(false)} /> : null}
      </DialogContainer>
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
