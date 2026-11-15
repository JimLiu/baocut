import { useState } from 'react';
import type { RecordingSummary } from '@baocut/protocol';
import { AlertDialog, Button, DialogContainer, ToastQueue } from '@react-spectrum/s2';
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel, formatDuration } from '../../model/format.ts';
import { unfinishedRecordings } from '../../model/recording.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useRecordings } from '../../state/recordings-store.ts';
import { useRecordingCapable } from './recording-host.tsx';
import { RC } from './recording-copy.ts';

/*
 * 起始页的「没收完的录制」提示（屏幕录制设计 §10「崩溃恢复」）：上次 Runtime 退出时没有导入完的录制，文件还在录制目录里。
 * 一次只提最新的那条（其余写「还有 N 条」，处理完一条下一条接上）：恢复是 `recordings.recover`（接着导入，进时间线后
 * 由 RecordingHost 打开编辑器），删除是 `recordings.discard`，先确认（删掉录下的文件，不能撤销）。
 */

const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 16,
  paddingY: 12,
  paddingX: 16,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const icon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 32,
  borderRadius: 'default',
  backgroundColor: 'gray-200',
});
const text = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, font: 'ui', color: 'gray-900' });
const title = style({ fontWeight: 'bold' });
const body = style({ margin: 0, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const more = style({ font: 'ui-sm', color: 'gray-600' });
const actions = style({ display: 'flex', gap: 8, flexShrink: 0 });

export function RecoveryPrompt() {
  const capable = useRecordingCapable();
  const recordings = useRecordings((s) => s.recordings);
  return capable ? <RecoveryList recordings={recordings} /> : null;
}

/** 按录制列表画提示（单测直接用它：服务端渲染读不到 store 的当前值）。 */
export function RecoveryList({ recordings }: { recordings: readonly RecordingSummary[] }) {
  const list = unfinishedRecordings(recordings);
  if (list.length === 0) return null;
  return <RecoveryCard key={list[0]!.recordingId} recording={list[0]!} others={list.length - 1} />;
}

function RecoveryCard({ recording, others }: { recording: RecordingSummary; others: number }) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState<'recover' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const recover = async () => {
    setBusy('recover');
    try {
      await runtime.client.request('recordings.recover', { recordingId: recording.recordingId });
      ToastQueue.info(RC.recovering, { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(RC.recoverFailed((error as Error).message), { timeout: 6000 });
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('delete');
    try {
      await runtime.client.request('recordings.discard', { recordingId: recording.recordingId });
      ToastQueue.positive(RC.deleted, { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(RC.deleteFailed((error as Error).message), { timeout: 6000 });
      setBusy(null);
    }
  };

  return (
    <div className={card} role="status" data-recording={recording.recordingId}>
      <span className={icon} aria-hidden>
        <DeviceDesktop />
      </span>
      <div className={text}>
        <span className={title}>{RC.recoverTitle}</span>
        <p className={body}>{RC.recoverBody(agoLabel(recording.startedAt ?? recording.createdAt), formatDuration(Math.round(recording.elapsed * 1000)))}</p>
        {others > 0 ? <span className={more}>{RC.recoverMore(others)}</span> : null}
      </div>
      <div className={actions}>
        <Button variant="secondary" size="S" isDisabled={busy !== null} isPending={busy === 'delete'} onPress={() => setConfirming(true)}>
          {RC.delete}
        </Button>
        <Button variant="accent" size="S" isDisabled={busy !== null} isPending={busy === 'recover'} onPress={() => void recover()}>
          {RC.recover}
        </Button>
      </div>
      <DialogContainer onDismiss={() => setConfirming(false)}>
        {confirming ? (
          <AlertDialog
            variant="destructive"
            title={RC.deleteTitle}
            primaryActionLabel={RC.delete}
            cancelLabel={RC.cancel}
            onPrimaryAction={() => void remove()}>
            {RC.deleteBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}
