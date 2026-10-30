import { useState, type Key } from 'react';
import type { ForkVideoOption, Id } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Revert from '@react-spectrum/s2/icons/Revert';
import VideoIcon from '@react-spectrum/s2/icons/MovieCamera';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { restoreItem, restoreNote } from '../../model/agent-fork.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { ForkIcon } from '../fork-icon.tsx';
import { FORK_COPY as F } from './fork-copy.ts';

const lead = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const list = style({
  listStyleType: 'none',
  marginTop: 12,
  marginBottom: 0,
  paddingX: 0,
  paddingY: 4,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
});
const rowStyle = style({ display: 'flex', flexDirection: 'column', gap: 2, paddingX: 12, paddingY: 4 });
const nameStyle = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-900' });
const noteStyle = style({ paddingStart: 28, font: 'ui-xs', color: { default: 'gray-700', isDisabled: 'gray-600' } });

/**
 * 回合页脚「复制」左边的分叉按钮（产品设计 §3.2.2「分叉」，原型 agent-fork.jsx `AgentForkButton`）。菜单第一项直接分叉；
 * 第二项「接着做，并把视频回到那时…」在菜单打开时向 Runtime 查（`conversations.forkVideos`），这条会话改过的视频在这一轮之后
 * 又有改动时才出现，都回不去时变灰。分叉后打开新会话。
 */
export function ForkButton({ conversationId, taskId }: { conversationId: Id; taskId: Id }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const [options, setOptions] = useState<ForkVideoOption[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    runtime
      .forkVideos(conversationId, taskId)
      .then(setOptions)
      .catch(() => setOptions([]));
  };
  const fork = async (restore: readonly Id[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const { conversation, restored } = await runtime.forkConversation(conversationId, taskId, restore);
      setAsking(false);
      go({ tab: 'home', conversationId: conversation.id, projectId: conversation.projectId });
      ToastQueue.positive(restored ? F.doneRestored(restored) : F.done, { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(F.failed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  const item = options ? restoreItem(options) : { disabled: true, note: F.checking };
  const onAction = (key: Key) => {
    if (key === 'fork') void fork([]);
    else if (key === 'restore') setAsking(true);
  };

  return (
    <>
      <MenuTrigger
        onOpenChange={(open) => {
          // 每次打开都重查：别的会话、用户自己可能刚改过这些视频。
          if (open) load();
        }}
      >
        <ActionButton isQuiet size="XS" aria-label={F.button} isPending={busy}>
          <ForkIcon />
        </ActionButton>
        <Menu aria-label={F.button} onAction={onAction} disabledKeys={item?.disabled ? ['restore'] : []}>
          <MenuItem id="fork" textValue={F.fork}>
            <ForkIcon />
            <Text slot="label">{F.fork}</Text>
            <Text slot="description">{F.forkHint}</Text>
          </MenuItem>
          {item ? (
            <MenuItem id="restore" textValue={F.restore}>
              <Revert />
              <Text slot="label">{F.restore}</Text>
              <Text slot="description">{item.note}</Text>
            </MenuItem>
          ) : null}
        </Menu>
      </MenuTrigger>
      {asking && options ? (
        <ForkRestoreDialog options={options} busy={busy} onClose={() => setAsking(false)} onFork={(ids) => void fork(ids)} />
      ) : null}
    </>
  );
}

/** 选哪几部视频回到那时：回得去的默认勾上，回不去的变灰并写原因；只有一部时不放勾选，直接写它会怎样。 */
function ForkRestoreDialog({
  options,
  busy,
  onClose,
  onFork,
}: {
  options: readonly ForkVideoOption[];
  busy: boolean;
  onClose: () => void;
  onFork: (ids: Id[]) => void;
}) {
  const [picked, setPicked] = useState<Id[]>(() => options.filter((o) => o.state === 'ok').map((o) => o.videoId));
  const single = options.length === 1;
  const toggle = (id: Id, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{F.dialogTitle}</Heading>
            <Content>
              <p className={lead}>{F.dialogLead}</p>
              <ul className={list} aria-label={F.listLabel}>
                {options.map((o) => {
                  const disabled = o.state !== 'ok';
                  return (
                    <li key={o.videoId} className={rowStyle}>
                      {single ? (
                        <span className={nameStyle}>
                          <VideoIcon />
                          {o.videoName}
                        </span>
                      ) : (
                        <Checkbox isSelected={picked.includes(o.videoId)} isDisabled={disabled} onChange={(on) => toggle(o.videoId, on)}>
                          {o.videoName}
                        </Checkbox>
                      )}
                      <span className={noteStyle({ isDisabled: disabled })}>{restoreNote(o)}</span>
                    </li>
                  );
                })}
              </ul>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {F.cancel}
              </Button>
              <Button variant="accent" isDisabled={!picked.length} isPending={busy} onPress={() => onFork(picked)}>
                {F.confirm}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
