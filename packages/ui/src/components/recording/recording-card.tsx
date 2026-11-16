import type { Id, RecordingSummary } from '@baocut/protocol';
import { localizeText } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop';
import { formatElapsed } from '../../model/recording.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useRecordings } from '../../state/recordings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { cardVars } from '../thread/video-card-rows.tsx';
import { RC } from './recording-copy.ts';
import { sessionRequest } from './recording-host.tsx';

/*
 * 会话里智能体发起的录制（屏幕录制设计 §13）：挂在发起它的那一轮后面，外观同下载卡（`bc-dlcard`）。
 * 等待开始时给「打开启动器」（关掉过、或者被别的窗口挡住时再打开）；放进视频之后给「打开视频」。
 * 状态读 `recordings` 主题（RecordingHost 写），主题里已经没有这次录制时不显示。
 */
export function RecordingCard({ recordingId, conversationId }: { recordingId: Id; conversationId: Id }) {
  const runtime = useRuntime();
  const recording = useRecordings((s) => s.recordings.find((r) => r.recordingId === recordingId) ?? null);
  if (!recording) return null;
  const line = cardLine(recording);
  const failed = recording.state === 'failed';
  const live = recording.state === 'recording' || recording.state === 'stopping' || recording.state === 'finalizing' || recording.state === 'importing';
  const openVideo = () => {
    const videoId = recording.result?.videoId ?? recording.videoId;
    if (!videoId) return;
    runtime.client.request('videos.target', { videoId }).then(
      ({ target }) => useShell.getState().openVideoBeside(target, conversationId),
      () => {},
    );
  };
  const reopen = () => {
    useRecordings.setState((s) => ({ dismissed: s.dismissed.filter((id) => id !== recordingId) }));
    runtime.host.recording?.open(sessionRequest({ target: recording.target, recordingId }));
  };
  return (
    <section className={`bc-dlcard is-${failed ? 'failed' : live ? 'running' : 'done'} ${cardVars}`} aria-label={RC.cardTitle} data-recording={recording.state}>
      <header className="bc-dlcard__head">
        <span className="bc-dlcard__ic">{failed ? <AlertTriangle /> : <DeviceDesktop />}</span>
        <span className="bc-dlcard__titles">
          <span className={`bc-dlcard__title${live ? ' bc-shimmer' : ''}`}>{RC.cardTitle}</span>
          <span className="bc-dlcard__name">{line}</span>
        </span>
      </header>
      {recording.state === 'waiting' || (recording.state === 'in-timeline' && recording.result) ? (
        <div className="bc-vjob__foot">
          <span className="bc-vjob__time" />
          {recording.state === 'waiting' ? (
            <Button size="S" variant="secondary" onPress={reopen}>
              {RC.cardOpenPanel}
            </Button>
          ) : (
            <Button size="S" variant="secondary" onPress={openVideo}>
              {RC.cardOpenVideo}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function cardLine(r: RecordingSummary): string {
  switch (r.state) {
    case 'waiting':
    case 'preparing':
      return RC.cardWaiting;
    case 'countdown':
      return RC.cardCountdown(r.countdownLeft ?? r.options.countdown);
    case 'recording':
      return RC.cardRecording(formatElapsed(r.elapsed));
    case 'paused':
      return RC.cardPaused(formatElapsed(r.elapsed));
    case 'stopping':
    case 'finalizing':
    case 'importing':
      return RC.cardFinishing;
    case 'importable':
      return RC.cardImportable;
    case 'in-timeline':
      return RC.cardDone(formatElapsed(r.result?.duration ?? r.elapsed));
    case 'failed':
      return RC.cardFailed(r.error ? localizeText(r.error.message, r.error.messageRef) : '');
    case 'discarded':
      return RC.cardDiscarded;
  }
}
