import type { Id } from '@baocut/protocol';
import { ActionButton, Text } from '@react-spectrum/s2';
import Comment from '@react-spectrum/s2/icons/Comment';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useShell } from '../../../state/shell-store.ts';
import { useWorkItem } from '../../../state/work-items-store.ts';
import { nextLine, useBotCall } from '../bot-actions.ts';
import { BOT_COPY as C } from '../bot-copy.ts';
import { StatusIcon, StatusLabel } from '../status-badge.tsx';
import { workItemStatus } from '../work-item-status.ts';

/** 与智能体回复正文对齐（头像 24 + 间距 12），同 thread.tsx 的 `messageOutputs`。 */
export const card = style({
  display: 'flex',
  alignItems: 'start',
  gap: 12,
  marginStart: 36,
  paddingX: 12,
  paddingY: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'gray-25',
  minWidth: 0,
});
const body = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const title = style({
  font: 'ui',
  fontWeight: 'medium',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  textDecoration: { default: 'none', isStruck: 'line-through' },
});
const next = style({ font: 'ui-sm', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const actions = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 });
const muted = style({ font: 'ui-sm', color: 'gray-600' });

/**
 * 线程卡（BOT-CV-03、需求 §11.4）：频道对话里一条任务的占位，标题、状态与「下一步」从任务镜像实时读。
 * 「打开」在右侧打开任务详情；进行中的智能体任务可以「停止」。读屏读出「任务名，状态，下一步」（需求 §11.10）。
 */
export function WorkItemRefCard({ workItemId, channelId, onReply = null }: { workItemId: Id; channelId: Id | null; onReply?: (() => void) | null }) {
  const item = useWorkItem(workItemId);
  const go = useShell((s) => s.go);
  const call = useBotCall();
  const open = () => go({ tab: 'bot', channelId: item?.channelId ?? channelId, workItemId, view: 'channel' });
  if (!item) {
    return (
      <div className={card} role="group" aria-label={C.card.missing}>
        <div className={body}>
          <span className={muted}>{C.card.missing}</span>
        </div>
        <div className={actions}>
          <ActionButton isQuiet size="S" onPress={open}>
            <OpenIn />
            <Text>{C.card.open}</Text>
          </ActionButton>
        </div>
      </div>
    );
  }
  const status = workItemStatus(item);
  const line = nextLine(item);
  const stoppable = item.owner === 'agent' && item.status === 'active' && item.active?.state !== 'blocked';
  return (
    <div className={card} role="group" aria-label={C.card.label(item.title, status.label, line)} data-work-item={item.id}>
      <StatusIcon statusKey={status.key} />
      <div className={body}>
        <div className={titleRow}>
          <span className={title({ isStruck: status.strike })}>{item.title}</span>
          <StatusLabel statusKey={status.key} />
        </div>
        {line ? <span className={next}>{line}</span> : null}
      </div>
      <div className={actions}>
        {stoppable ? (
          <ActionButton isQuiet size="S" onPress={() => void call('workItems.stop', { id: item.id })}>
            <StopProcessing />
            <Text>{C.card.stop}</Text>
          </ActionButton>
        ) : null}
        {onReply ? (
          <ActionButton isQuiet size="S" onPress={onReply}>
            <Comment />
            <Text>{C.card.reply}</Text>
          </ActionButton>
        ) : null}
        <ActionButton isQuiet size="S" onPress={open}>
          <OpenIn />
          <Text>{C.card.open}</Text>
        </ActionButton>
      </div>
    </div>
  );
}
