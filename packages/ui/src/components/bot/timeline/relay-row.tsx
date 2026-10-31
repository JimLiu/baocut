import { useId, useState } from 'react';
import type { TimelineItem } from '@baocut/protocol';
import { ActionButton, Text } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useShell } from '../../../state/shell-store.ts';
import { BOT_COPY as C } from '../bot-copy.ts';

type Relay = Extract<TimelineItem, { kind: 'relay' }>;

const row = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
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
 * 默认收成一行灰字，点开看全文与原文引用。不是用户打的字，不画成用户消息。
 */
export function RelayRow({ item, channelId }: { item: Relay; channelId: string | null }) {
  const [open, setOpen] = useState(false);
  const go = useShell((s) => s.go);
  const panel = useId();
  const label = C.relay.direction[item.direction];
  const line = firstLine(item.text);
  return (
    <div className={row} data-find-item={item.id}>
      <div className={head}>
        <ActionButton isQuiet size="S" aria-expanded={open} aria-controls={panel} aria-label={open ? C.relay.collapse : C.relay.expand} onPress={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </ActionButton>
        <span className={summary} data-find-body>
          {line ? `${label} · ${line}` : label}
        </span>
        {item.workItemId ? (
          <ActionButton
            isQuiet
            size="S"
            onPress={() => go({ tab: 'bot', channelId, workItemId: item.workItemId, view: 'channel' })}>
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
