import { memo, useState } from 'react';
import type { FileTarget, Id, TimelineItem } from '@baocut/protocol';
import { AlertDialog, Button, DialogContainer, ToastQueue } from '@react-spectrum/s2';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Undo from '@react-spectrum/s2/icons/Undo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { T } from './thread-copy.ts';
import { CHANGE_COPY } from '../../copy.ts';
import { formatClock } from '../../model/format.ts';
import { changeUndoState, type LocalUndoAction } from '../../model/thread.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { sameTarget } from '../../runtime/video-controller.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { undoInBackground } from './change-undo.ts';
import { useVideoHistory } from './use-video-history.ts';

type VideoChange = Extract<TimelineItem, { kind: 'video-change' }>;

/**
 * 回执是工作记录框里的一行（原型 agent-messages.css `.asteps--box .arcpt`）：不另起底色与边框，行间分隔线由框给；
 * 生效中图标是绿色，撤销之后转灰。
 */
const row = style({ display: 'flex', flexDirection: 'column', gap: 4, paddingX: 12, paddingY: 4 });
const head = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minHeight: 32 });
const icon = style({ display: 'flex', flexShrink: 0, color: { default: 'green-1100', isUndone: 'gray-600' } });
const title = style({
  flexGrow: 1,
  flexBasis: 0,
  minWidth: 0,
  font: 'ui-sm',
  fontWeight: 'medium',
  color: { default: 'gray-800', isUndone: 'gray-700' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const buttons = style({ display: 'flex', gap: 8, flexShrink: 0 });
const facts = style({ display: 'flex', flexWrap: 'wrap', columnGap: 8, font: 'ui-xs', color: 'gray-600', paddingStart: 28 });

function factsOf(item: VideoChange): string[] {
  const { before, after } = item.durationSeconds;
  return [
    item.createdIds.length ? T.change.added(item.createdIds.length) : '',
    item.updatedIds.length ? T.change.updated(item.updatedIds.length) : '',
    item.deletedIds.length ? T.change.deleted(item.deletedIds.length) : '',
    before === after
      ? T.change.duration(formatClock(after, { tenths: true }))
      : T.change.durationChange(formatClock(before, { tenths: true }), formatClock(after, { tenths: true })),
    T.change.revision(item.previousRevision, item.videoRevision),
  ].filter(Boolean);
}

/** 编辑器此刻占着这个视频（正在打开或已经开着）。 */
function editorHolds(target: FileTarget, videoId: Id): boolean {
  const video = useVideo.getState().video;
  return video !== null && (video.videoId === videoId || sameTarget(video.target, target));
}

/**
 * 变更卡（产品设计 §6.5，原型 agent-steps.jsx `ReceiptStep`）：Agent 经工具提交的一笔视频修改，是工作记录展开后框里的一行
 * （steps-group.tsx）。内容全部来自引擎的回执，不取 Agent 自己的说法。
 *
 * - 撤销：先确认（原型 `ConfirmDialog`）。编辑器开着这个视频时走编辑器的命令队列；没开着时在后台打开视频撤销再关掉
 *   （`undoInBackground`），不再要求视频开在旁边。编辑器正在打开它时先等打开完。撤销冲突由引擎判断。
 * - 撤销之后是「已撤销 · 改动已还原」。只有编辑器开着这个视频、这一笔的撤销正是当前连接「重做」栈顶时才给「恢复」：
 *   栈顶只能从编辑器订阅的 `edits.undoState` 看到；不是栈顶时（之后又改过这个视频、或撤销是 Agent 做的）
 *   撤销那笔补偿事务不一定等于把这一步放回去，不画。恢复按事务撤销那一笔（`{ transaction }`），不发 `'redo'`：
 *   按下时栈顶万一已经变了，也不会重做到别的修改上。
 * - Agent 自己撤销的那一笔（`undoOf`）只记一行，不给撤销或恢复。
 */
export const ChangeCard = memo(function ChangeCard({
  item,
  undone,
  conversationId,
}: {
  item: VideoChange;
  undone: boolean;
  conversationId: string;
}) {
  const runtime = useRuntime();
  const openHere = useVideo((s) => s.video !== null && (s.video.videoId === item.videoId || sameTarget(s.video.target, item.target)));
  const ready = useVideo((s) => s.video?.videoId === item.videoId && s.video.status === 'ready');
  const redo = useVideo((s) => (s.video?.videoId === item.videoId ? (s.video.undo.redo?.transactionId ?? null) : null));
  const history = useVideoHistory(item.videoId);
  const [local, setLocal] = useState<LocalUndoAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isUndoCard = Boolean(item.undoOf);
  const state = isUndoCard
    ? ({ state: 'applied' } as const)
    : changeUndoState({ transactionId: item.transactionId, undoneInThread: undone, local, history, redo });
  const isUndone = state.state === 'undone';
  const restoreTx = state.state === 'undone' ? state.restore : null;

  const undo = async () => {
    setBusy(true);
    try {
      if (ready) {
        const receipt = await runtime.videos.undo({ transaction: item.transactionId });
        if (!receipt) {
          const message = useVideo.getState().video?.commandError?.message ?? T.change.locked;
          ToastQueue.negative(CHANGE_COPY.undoFailed(message), { timeout: 5000 });
          return;
        }
        setLocal({ kind: 'undo', transactionId: receipt.transactionId });
        ToastQueue.neutral(CHANGE_COPY.undoneToast, { timeout: 3000 });
        return;
      }
      const result = await undoInBackground(
        { request: runtime.client.request.bind(runtime.client), editorHolds },
        item.target,
        item.transactionId,
      );
      setLocal({ kind: 'undo', transactionId: result.transactionId });
      ToastQueue.neutral(result.kind === 'undone' ? CHANGE_COPY.undoneToast : CHANGE_COPY.alreadyUndone, { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(CHANGE_COPY.undoFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (transaction: Id) => {
    setBusy(true);
    try {
      const receipt = await runtime.videos.undo({ transaction });
      if (!receipt) {
        const message = useVideo.getState().video?.commandError?.message ?? T.change.locked;
        ToastQueue.negative(CHANGE_COPY.restoreFailed(message), { timeout: 5000 });
        return;
      }
      setLocal({ kind: 'restore', transactionId: receipt.transactionId });
      ToastQueue.positive(CHANGE_COPY.restoredToast, { timeout: 3000 });
    } finally {
      setBusy(false);
    }
  };

  const label = isUndone
    ? CHANGE_COPY.undone
    : (isUndoCard ? T.change.undoStep : T.change.changed)(item.videoName, item.label);
  const Icon = isUndone ? Undo : CheckmarkCircle;

  return (
    <li className={row} aria-label={T.change.aria(item.label)} data-role="video-change">
      <div className={head}>
        <span className={icon({ isUndone })} aria-hidden>
          <Icon />
        </span>
        <span className={title({ isUndone })} title={isUndone ? T.withDetail(label, item.label) : label}>
          {label}
        </span>
        <span className={buttons}>
          {isUndoCard ? null : isUndone ? (
            restoreTx ? (
              <Button
                size="S"
                variant="secondary"
                fillStyle="outline"
                isPending={busy}
                isDisabled={!ready}
                onPress={() => void restore(restoreTx)}>
                {CHANGE_COPY.restore}
              </Button>
            ) : null
          ) : (
            <Button size="S" variant="negative" isPending={busy} isDisabled={openHere && !ready} onPress={() => setConfirming(true)}>
              {CHANGE_COPY.undo}
            </Button>
          )}
          {!openHere ? (
            <Button
              size="S"
              variant="secondary"
              fillStyle="outline"
              onPress={() => useShell.getState().openVideo(item.target, { conversationId, projectId: null })}>
              {CHANGE_COPY.openVideo}
            </Button>
          ) : null}
        </span>
      </div>
      <div className={facts}>
        {factsOf(item).map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
      <DialogContainer onDismiss={() => setConfirming(false)}>
        {confirming ? (
          <AlertDialog
            variant="destructive"
            title={CHANGE_COPY.confirmTitle}
            primaryActionLabel={CHANGE_COPY.undo}
            cancelLabel={CHANGE_COPY.cancel}
            onPrimaryAction={() => void undo()}>
            {CHANGE_COPY.confirmBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </li>
  );
});
