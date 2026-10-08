import { useState } from 'react';
import type { JobRecord, ModelCapabilitiesView } from '@baocut/protocol';
import { ActionButton, ActionMenu, Button, MenuItem, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Revert from '@react-spectrum/s2/icons/Revert';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { cancellationCost } from '../../model/task-facts.ts';
import { jobPercent } from '../../model/task-list.ts';
import { providerName } from '../../model/tools-models.ts';
import { aheadOf, didNotFinish, failureText, phaseLabel, queuedDetail, recordStatus, stateLabel } from '../../model/tools-records.ts';
import { audioFileName, audioOutput, speechMeta, speechRetry, speechText, speechTitle } from '../../model/tools-tts.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { detail, detailGrow, RecordCard, recordHead, recordIcon, recordRow, recordText, recordTitle } from './tool-parts.tsx';
import { ToolOutputRow, useJobOutputs } from './tool-outputs.tsx';
import { RECORD_COPY, TTS_COPY } from './tools-copy.ts';
import { copyText, useArtifactUrl, useCancelJob, useDownloadArtifact, useRecordRetry } from './use-tool-records.ts';

/* 设计稿 tool-tts.jsx `RecordCard`（157-219）：标题、状态、文字、元数据、在跑的进度或播放器与下载。 */

const audio = style({ width: 'full', height: 36 });
const progress = style({ width: 'full' });

/** 「再试一次 / 重新排队」：中断的就地重跑，其余照冻结的参数原样再提交（见 `useRecordRetry`）。 */
function useSpeechRetry(job: JobRecord) {
  const runtime = useRuntime();
  return useRecordRetry(
    job,
    'synthesizeSpeech',
    (j) => {
      const request = speechRetry(j);
      return request ? runtime.synthesizeSpeech(request) : null;
    },
    { submitted: TTS_COPY.submitted, failed: TTS_COPY.submitFailed },
  );
}

export function TtsRecord({
  job,
  all,
  view,
  now,
  onReuse,
}: {
  job: JobRecord;
  all: readonly JobRecord[];
  view: ModelCapabilitiesView | null;
  now: number;
  onReuse: (job: JobRecord) => void;
}) {
  const go = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const cancel = useCancelJob();
  const again = useSpeechRetry(job);
  const title = speechTitle(job);
  const unsettled = job.state === 'needs-reconciliation';
  const cost = job.state === 'cancelled' && job.cancellation ? cancellationCost(job.cancellation) : null;
  const status = recordStatus(job);
  const live = status === 'queued' || status === 'running';
  const off = job.state === 'cancelled' || didNotFinish(job);
  const pct = jobPercent(job);

  const act = (key: string) => {
    if (key === 'reuse') onReuse(job);
    else if (key === 'copy') copyText(speechText(job));
    else if (key === 'task') go({ tab: 'tasks', taskId: job.jobId });
    else if (key === 'remove') {
      hide(job.jobId);
      ToastQueue.neutral(RECORD_COPY.removed(title), { timeout: 4000 });
    }
  };

  return (
    <RecordCard running={status === 'running'} failed={didNotFinish(job)} label={title}>
      <div className={recordHead}>
        <span className={recordIcon} aria-hidden>
          <AudioWave />
        </span>
        <h3 className={recordTitle} title={speechText(job)}>
          {title}
        </h3>
        <span className={detail}>{stateLabel(job, now)}</span>
        <ActionMenu aria-label={RECORD_COPY.more} isQuiet size="S" disabledKeys={live || unsettled ? ['remove'] : []} onAction={(key) => act(String(key))}>
          <MenuItem id="reuse" textValue={RECORD_COPY.reuse}>
            <Revert />
            <Text slot="label">{RECORD_COPY.reuse}</Text>
          </MenuItem>
          <MenuItem id="copy" textValue={RECORD_COPY.copyText}>
            <Copy />
            <Text slot="label">{RECORD_COPY.copyText}</Text>
          </MenuItem>
          <MenuItem id="task" textValue={RECORD_COPY.task}>
            <OpenIn />
            <Text slot="label">{RECORD_COPY.task}</Text>
          </MenuItem>
          <MenuItem id="remove" textValue={RECORD_COPY.remove}>
            <Delete />
            <Text slot="label">{RECORD_COPY.remove}</Text>
            <Text slot="description">{RECORD_COPY.removeNote}</Text>
          </MenuItem>
        </ActionMenu>
      </div>
      <p className={recordText({ isOff: off })}>{speechText(job)}</p>
      <span className={detail}>{speechMeta(job, providerName(view, 'synthesizeSpeech', job.providerId))}</span>

      {status === 'running' ? (
        <>
          <div className={recordRow}>
            <span className={detailGrow}>{phaseLabel(job)}</span>
            <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
              <Text>{RECORD_COPY.cancel}</Text>
            </ActionButton>
          </div>
          <ProgressBar
            size="S"
            styles={progress}
            aria-label={RECORD_COPY.progressLabel(title, phaseLabel(job))}
            isIndeterminate={pct === null}
            value={pct ?? undefined}
          />
        </>
      ) : null}
      {job.state === 'queued' ? (
        <div className={recordRow}>
          <span className={detailGrow}>{queuedDetail(job) ?? RECORD_COPY.ahead(aheadOf(all, job))}</span>
          <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
            <Text>{RECORD_COPY.cancel}</Text>
          </ActionButton>
        </div>
      ) : null}
      {job.state === 'cancelled' ? (
        <div className={recordRow}>
          <span className={detailGrow}>{cost ? `${RECORD_COPY.noFile} · ${cost}` : RECORD_COPY.noFile}</span>
          <RetryButton label={RECORD_COPY.requeue} again={again} />
        </div>
      ) : null}
      {didNotFinish(job) ? (
        <div className={recordRow}>
          <span className={detailGrow}>{unsettled ? RECORD_COPY.unsettled(failureText(job)) : failureText(job)}</span>
          {unsettled ? (
            <ActionButton size="S" onPress={() => go({ tab: 'tasks', taskId: job.jobId })}>
              <Text>{RECORD_COPY.reconcile}</Text>
            </ActionButton>
          ) : (
            <RetryButton label={RECORD_COPY.retry} again={again} />
          )}
        </div>
      ) : null}
      {job.state === 'completed' ? <SpeechResult job={job} /> : null}
    </RecordCard>
  );
}

/** 重新提交过的不再给按钮，写「已重新提交」；在途时转圈。 */
function RetryButton({ label, again }: { label: string; again: ReturnType<typeof useSpeechRetry> }) {
  if (again.done) return <span className={detail}>{RECORD_COPY.retried}</span>;
  return (
    <ActionButton size="S" isPending={again.pending} onPress={again.retry}>
      <Text>{label}</Text>
    </ActionButton>
  );
}

/** 做完的那一条：播放器、下载，以及它在 Space 里的条目（产物行：在 Space 中查看、交给 Agent、以此新建视频）。 */
function SpeechResult({ job }: { job: JobRecord }) {
  const out = audioOutput(job);
  const media = useArtifactUrl(out?.artifactId ?? null);
  const download = useDownloadArtifact();
  const [busy, setBusy] = useState(false);
  const entry = useJobOutputs([job.jobId])[0] ?? null;
  if (!out) return <span className={detail}>{RECORD_COPY.noFile}</span>;
  const fileName = audioFileName(job, out);
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase();
  return (
    <>
      {media?.status === 'ready' ? (
        <audio className={audio} controls preload="metadata" src={media.url} aria-label={RECORD_COPY.play(speechTitle(job))} />
      ) : (
        <span className={detail}>{media?.status === 'failed' ? RECORD_COPY.openFailed(media.message) : RECORD_COPY.loadingMedia}</span>
      )}
      <div className={recordRow}>
        <Button
          variant="secondary"
          size="S"
          isPending={busy}
          onPress={() => {
            setBusy(true);
            download(out.artifactId, fileName)
              .catch((e: Error) => ToastQueue.negative(RECORD_COPY.downloadFailed(e.message), { timeout: 6000 }))
              .finally(() => setBusy(false));
          }}>
          <Download />
          <Text>{RECORD_COPY.download(ext)}</Text>
        </Button>
      </div>
      {entry ? <ToolOutputRow entry={entry} fromTool="synthesize-speech" compact /> : null}
    </>
  );
}
