import { useMemo, useState, type ReactNode } from 'react';
import type { Id, TimelineItem } from '@baocut/protocol';
import { ActionButton, Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, TextArea, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Edit from '@react-spectrum/s2/icons/Edit';
import ThumbDown from '@react-spectrum/s2/icons/ThumbDown';
import ThumbUp from '@react-spectrum/s2/icons/ThumbUp';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useTimeline } from '../../../state/timeline-store.ts';
import { useWorkItem } from '../../../state/work-items-store.ts';
import type { BotThreadExtras } from '../../thread/bot-items.ts';
import { useBotCall } from '../bot-actions.ts';
import { BOT_COPY as C } from '../bot-copy.ts';

type UserMessage = Extract<TimelineItem, { kind: 'user-message' }>;
type AgentMessage = Extract<TimelineItem, { kind: 'agent-message' }>;

export const THUMBS_UP = '\u{1F44D}';
export const THUMBS_DOWN = '\u{1F44E}';

const mark = style({ alignSelf: 'center', font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const editField = style({ width: 'full' });
const reactions = style({ display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, marginTop: 4 });

/**
 * 频道与线程里每条消息下的 Bot 操作（需求 §11.4 表「用户消息：可编辑、可表情回应」）：
 * 亲手打的消息可以改（BOT-EX-06，`conversations.editMessage`），改过的标「已编辑」；回复线程卡发的写「回复：任务名」（BOT-EX-09）；
 * 智能体的消息下 👍 👎（BOT-EX-10，`bot.react`），点过的高亮。
 */
export function useBotMessageExtras(): Pick<BotThreadExtras, 'userMessage' | 'agentMessage'> {
  return useMemo(
    () => ({
      userMessage: (item: UserMessage, conversationId: Id) => <UserMessageExtras item={item} conversationId={conversationId} />,
      agentMessage: (item: AgentMessage, conversationId: Id) =>
        item.streaming || item.fallback ? null : <Reactions item={item} conversationId={conversationId} />,
    }),
    [],
  );
}

export function UserMessageExtras({ item, conversationId }: { item: UserMessage; conversationId: Id }) {
  const [editing, setEditing] = useState(false);
  const editable = !item.via || item.via === 'typed';
  return (
    <>
      {editable ? (
        <TooltipTrigger delay={400}>
          <ActionButton isQuiet size="XS" aria-label={C.message.edit} onPress={() => setEditing(true)}>
            <Edit />
          </ActionButton>
          <Tooltip>{C.message.edit}</Tooltip>
        </TooltipTrigger>
      ) : null}
      {item.history?.length ? (
        <span className={mark} title={C.message.editedFrom(item.history[item.history.length - 1]!.text)}>
          {C.message.edited}
        </span>
      ) : null}
      {item.replyToItemId ? <ReplyMark conversationId={conversationId} itemId={item.replyToItemId} /> : null}
      <DialogContainer onDismiss={() => setEditing(false)}>
        {editing ? <EditMessageDialog item={item} conversationId={conversationId} onClose={() => setEditing(false)} /> : null}
      </DialogContainer>
    </>
  );
}

/** 「回复：任务名」：回复的那张线程卡指向的任务；卡片或任务不在了就只写「回复了一张任务卡」。 */
function ReplyMark({ conversationId, itemId }: { conversationId: Id; itemId: Id }) {
  const workItemId = useTimeline((s) => {
    const target = s.byConversationId[conversationId]?.items.find((i) => i.id === itemId);
    return target?.kind === 'work-item-ref' || target?.kind === 'relay' ? target.workItemId : null;
  });
  const task = useWorkItem(workItemId);
  return <span className={mark}>{task ? C.message.replyTo(task.title) : C.message.replyToCard}</span>;
}

function EditMessageDialog({ item, conversationId, onClose }: { item: UserMessage; conversationId: Id; onClose: () => void }) {
  const call = useBotCall();
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== '' && text !== item.text;
  const save = async () => {
    if (!changed || busy) return;
    setBusy(true);
    const result = await call('conversations.editMessage', { conversationId, itemId: item.id, text });
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Dialog size="M">
      {({ close }) => (
        <>
          <Heading slot="title">{C.message.editTitle}</Heading>
          <Content>
            <TextArea aria-label={C.message.editTitle} description={C.message.editHint} value={text} onChange={setText} autoFocus styles={editField} />
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={close}>
              {C.common.cancel}
            </Button>
            <Button variant="accent" isDisabled={!changed} isPending={busy} onPress={() => void save()}>
              {C.dialog.save}
            </Button>
          </ButtonGroup>
        </>
      )}
    </Dialog>
  );
}

export function Reactions({ item, conversationId }: { item: AgentMessage; conversationId: Id }) {
  const call = useBotCall();
  const [pending, setPending] = useState<string | null>(null);
  const given = item.reactions ?? [];
  const react = async (emoji: string) => {
    setPending(emoji);
    await call('bot.react', { conversationId, itemId: item.id, emoji });
    setPending(null);
  };
  const button = (emoji: string, label: string, icon: ReactNode) => {
    const on = given.includes(emoji);
    return (
      <TooltipTrigger delay={400}>
        <ActionButton
          isQuiet={!on}
          size="XS"
          aria-label={label}
          aria-pressed={on}
          isPending={pending === emoji}
          // 一条消息只回应一次：点过 👍 再点 👎，协调者会先后收到相反的两个回答。
          isDisabled={given.length > 0 || (pending !== null && pending !== emoji)}
          onPress={() => void react(emoji)}>
          {icon}
        </ActionButton>
        <Tooltip>{label}</Tooltip>
      </TooltipTrigger>
    );
  };
  return (
    <div className={reactions} role="group" aria-label={C.message.reactions}>
      {button(THUMBS_UP, C.message.thumbsUp, <ThumbUp />)}
      {button(THUMBS_DOWN, C.message.thumbsDown, <ThumbDown />)}
    </div>
  );
}
