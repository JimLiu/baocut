import { useState } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton, Button, Text, TextArea } from '@react-spectrum/s2';
import Code from '@react-spectrum/s2/icons/Code';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import Image from '@react-spectrum/s2/icons/Image';
import Send from '@react-spectrum/s2/icons/Send';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { QUEUE_COPY, SKILL_COPY } from '../copy.ts';
import { editQueuedMessage, removeQueuedMessage, type QueuedMessage } from '../model/message-queue.ts';
import { useShell } from '../state/shell-store.ts';
import { useSkills } from '../state/skills-store.ts';

const EMPTY: QueuedMessage[] = [];

const box = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 8,
  padding: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const head = style({ font: 'ui-xs', color: 'gray-600', paddingX: 4 });
const list = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none' });
const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 });
const textCell = style({
  flexGrow: 1,
  flexBasis: 160,
  minWidth: 0,
  paddingX: 4,
  font: 'ui-sm',
  color: 'gray-800',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const meta = style({ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const editor = style({ display: 'flex', flexDirection: 'column', gap: 8, width: 'full' });
const field = style({ width: 'full' });
const editActs = style({ display: 'flex', justifyContent: 'end', gap: 8 });

/**
 * 忙时排队的消息，挂在输入框上方：会话的任务结束后按顺序发出。
 * 每条可以改文字、删掉，或「立即发送」——先试着插进当前回合，Agent 不支持就留在队列里等。
 */
export function QueuedMessages({
  conversationId,
  sending,
  onSendNow,
}: {
  conversationId: Id;
  /** 正在「立即发送」的那一条。 */
  sending: Id | null;
  onSendNow(id: Id): void;
}) {
  const queue = useShell((s) => s.queues[conversationId] ?? EMPTY);
  const setQueue = useShell((s) => s.setQueue);
  const [editing, setEditing] = useState<{ id: Id; text: string } | null>(null);
  const skills = useSkills((s) => s.skills);
  if (!queue.length) return null;

  const save = () => {
    if (!editing) return;
    setQueue(conversationId, (q) => editQueuedMessage(q, editing.id, editing.text));
    setEditing(null);
  };

  return (
    <section className={box} aria-label={QUEUE_COPY.title(queue.length)}>
      <div className={head}>{QUEUE_COPY.title(queue.length)}</div>
      <ol className={list}>
        {queue.map((message) => (
          <li key={message.id} className={row}>
            {editing?.id === message.id ? (
              <div className={editor}>
                <TextArea
                  aria-label={QUEUE_COPY.editLabel}
                  size="S"
                  value={editing.text}
                  onChange={(text) => setEditing({ id: message.id, text })}
                  autoFocus
                  styles={field}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
                <div className={editActs}>
                  <Button variant="secondary" size="S" onPress={() => setEditing(null)}>
                    {QUEUE_COPY.cancel}
                  </Button>
                  <Button variant="accent" size="S" onPress={save}>
                    {QUEUE_COPY.save}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <span className={textCell} title={message.text}>
                  {message.text}
                </span>
                {message.attachments.length ? (
                  <span className={meta}>
                    <Image />
                    {QUEUE_COPY.images(message.attachments.length)}
                  </span>
                ) : null}
                {message.skill ? (
                  <span className={meta}>
                    <Code />
                    {SKILL_COPY.token(skills.find((k) => k.id === message.skill!.id)?.name ?? message.skill.id)}
                  </span>
                ) : null}
                <ActionButton isQuiet size="S" aria-label={QUEUE_COPY.edit} onPress={() => setEditing({ id: message.id, text: message.text })}>
                  <Edit />
                </ActionButton>
                <ActionButton
                  isQuiet
                  size="S"
                  aria-label={QUEUE_COPY.remove}
                  onPress={() => setQueue(conversationId, (q) => removeQueuedMessage(q, message.id))}>
                  <Delete />
                </ActionButton>
                <ActionButton size="S" isDisabled={sending !== null} onPress={() => onSendNow(message.id)}>
                  <Send />
                  <Text>{QUEUE_COPY.sendNow}</Text>
                </ActionButton>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
