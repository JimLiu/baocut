import { useState } from 'react';
import { BOT_LIMITS, type WorkItem, type WorkItemPatch, type WorkItemPriority } from '@baocut/protocol';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Form, Heading, Picker, PickerItem, TextField } from '@react-spectrum/s2';
import { useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';

const PRIORITIES: readonly WorkItemPriority[] = ['high', 'medium', 'low'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 且是真实存在的日子；空串表示没有。 */
export function validDay(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 只带改过的字段；日期清空交 null。 */
export function taskPatch(item: WorkItem, draft: { title: string; priority: WorkItemPriority; dueOn: string; eventOn: string }): WorkItemPatch {
  const patch: WorkItemPatch = {};
  const title = draft.title.trim();
  if (title && title !== item.title) patch.title = title;
  if (draft.priority !== item.priority) patch.priority = draft.priority;
  const dueOn = draft.dueOn.trim() || null;
  if (dueOn !== item.dueOn) patch.dueOn = dueOn;
  const eventOn = draft.eventOn.trim() || null;
  if (eventOn !== item.eventOn) patch.eventOn = eventOn;
  return patch;
}

/**
 * 改任务（BOT-TK-06、需求 §11.6 头部「标题（用户可改）」「优先级、截止日」）：标题、优先级、截止日、活动日，走 `workItems.update`。
 * 这里改过的日期，Runtime 记成「你定的」。
 */
export function TaskEditDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const call = useBotCall();
  const [draft, setDraft] = useState({ title: item.title, priority: item.priority, dueOn: item.dueOn ?? '', eventOn: item.eventOn ?? '' });
  const [busy, setBusy] = useState(false);
  const titleOk = draft.title.trim() !== '' && draft.title.trim().length <= BOT_LIMITS.title;
  const valid = titleOk && validDay(draft.dueOn) && validDay(draft.eventOn);
  const save = async () => {
    if (!valid || busy) return;
    const patch = taskPatch(item, draft);
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    const result = await call('workItems.update', { id: item.id, patch });
    setBusy(false);
    if (result) onClose();
  };
  const dayField = (key: 'dueOn' | 'eventOn', label: string) => (
    <TextField
      label={label}
      value={draft[key]}
      onChange={(value) => setDraft((d) => ({ ...d, [key]: value }))}
      placeholder="YYYY-MM-DD"
      description={C.detail.dayHint}
      isInvalid={!validDay(draft[key])}
      errorMessage={C.detail.dayInvalid}
    />
  );
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{C.detail.editTask}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}>
                <TextField
                  label={C.panel.taskTitle}
                  value={draft.title}
                  onChange={(title) => setDraft((d) => ({ ...d, title }))}
                  autoFocus
                  isRequired
                  maxLength={BOT_LIMITS.title}
                />
                <Picker label={C.detail.priority} selectedKey={draft.priority} onSelectionChange={(key) => setDraft((d) => ({ ...d, priority: key as WorkItemPriority }))}>
                  {PRIORITIES.map((p) => (
                    <PickerItem key={p} id={p}>
                      {C.detail.priorities[p]}
                    </PickerItem>
                  ))}
                </Picker>
                {dayField('dueOn', C.detail.dueLabel)}
                {dayField('eventOn', C.detail.eventLabel)}
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!valid} isPending={busy} onPress={() => void save()}>
                {C.dialog.save}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
