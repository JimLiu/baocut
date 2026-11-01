import { useId, useState } from 'react';
import type { TimelineItem } from '@baocut/protocol';
import { ActionButton, Text } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useShell } from '../../../state/shell-store.ts';
import { useWorkItem } from '../../../state/work-items-store.ts';
import { BOT_COPY as C } from '../bot-copy.ts';
import { StatusIcon } from '../status-badge.tsx';
import { workItemStatus } from '../work-item-status.ts';

type Relay = Extract<TimelineItem, { kind: 'relay' }>;

const row = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const taskHead = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
// 弯线从下面展开钮的中线（24px 按钮的 12px 处）拐到任务头，像对话里的回复线。
const curve = style({
  flexShrink: 0,
  alignSelf: 'end',
  width: 12,
  height: 16,
  marginStart: 12,
  marginBottom: -4,
  boxSizing: 'border-box',
  borderTopWidth: 2,
  borderStartWidth: 2,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-300',
  borderTopStartRadius: 'default',
});
const taskTitle = style({
  minWidth: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui',
  fontWeight: 'medium',
  color: { default: 'gray-900', isStruck: 'gray-600' },
  textAlign: 'start',
  textDecoration: { default: 'none', ':hover': 'underline', isStruck: 'line-through' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  borderRadius: 'sm',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, font: 'ui-sm', color: 'gray-600' });
const summary = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1 });
const details = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginStart: 28,
  paddingStart: 12,
  borderStartWidth: 2,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const text = style({ margin: 0, font: 'ui-sm', color: 'gray-800', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' });
const citedHead = style({ font: 'ui-xs', fontWeight: 'medium', color: 'gray-700' });
const cited = style({ display: 'flex', flexDirection: 'column', gap: 2, font: 'ui-xs', color: 'gray-700' });
const citedAuthor = style({ fontWeight: 'medium' });

function firstLine(value: string): string {
  return value.split('\n').find((line) => line.trim())?.trim() ?? '';
}

/**
 * 报告、简报、转交、刷新、定时与提醒这类 Runtime 搬进会话的条目（技术方案 §4.3，需求 §11.4「运行记录行」）：
 * 挂在任务上时，上面一行是任务头：一根弯线、任务的状态图标与标题，点标题打开任务；任务还没载入时退回行尾的「打开任务」。
 * 下面默认收成一行灰字，点开看全文与原文引用。不是用户打的字，不画成用户消息。
 */
export function RelayRow({ item, channelId }: { item: Relay; channelId: string | null }) {
  const [open, setOpen] = useState(false);
  const go = useShell((s) => s.go);
  const panel = useId();
  const task = useWorkItem(item.workItemId ?? null);
  const status = task ? workItemStatus(task) : null;
  const label = C.relay.direction[item.direction];
  const line = firstLine(item.text);
  const openTask = () => go({ tab: 'bot', channelId, workItemId: item.workItemId, view: 'channel' });
  return (
    <div className={row} data-find-item={item.id}>
      {task && status ? (
        <div className={taskHead}>
          <span className={curve} aria-hidden="true" />
          <StatusIcon statusKey={status.key} chip />
          <button type="button" className={taskTitle({ isStruck: status.strike })} aria-label={C.relay.openTaskNamed(task.title, status.label)} onClick={openTask}>
            {task.title}
          </button>
        </div>
      ) : null}
      <div className={head}>
        <ActionButton isQuiet size="S" aria-expanded={open} aria-controls={panel} aria-label={open ? C.relay.collapse : C.relay.expand} onPress={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </ActionButton>
        <span className={summary} data-find-body>
          {line ? `${label} · ${line}` : label}
        </span>
        {item.workItemId && !task ? (
          <ActionButton isQuiet size="S" onPress={openTask}>
            <OpenIn />
            <Text>{C.relay.openTask}</Text>
          </ActionButton>
        ) : null}
      </div>
      {open ? (
        <div id={panel} className={details}>
          {item.text ? <p className={text}>{item.text}</p> : null}
          {item.cited.length ? (
            <div className={cited} role="group" aria-label={C.relay.quoted}>
              <span className={citedHead}>{C.relay.quoted}</span>
              {item.cited.map((message) => (
                <span key={message.messageId}>
                  <span className={citedAuthor}>{message.author === 'user' ? C.relay.you : C.relay.bot}</span>
                  {`: ${message.text}`}
                  {message.truncated ? ` ${C.relay.truncated}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
