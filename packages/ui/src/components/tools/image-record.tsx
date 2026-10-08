import { useState } from 'react';
import type { Id, JobRecord, ModelCapabilitiesView } from '@baocut/protocol';
import { ActionButton, ActionMenu, Button, MenuItem, ProgressBar, Text, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { cancellationCost } from '../../model/task-facts.ts';
import { jobPercent } from '../../model/task-list.ts';
import {
  imageBatchMeta,
  imageFileName,
  imagePrompt,
  imageResults,
  imageStepPhase,
  retryRequest,
  type ImageResult,
} from '../../model/tools-image.ts';
import { providerName } from '../../model/tools-models.ts';
import { aheadOf, didNotFinish, failureText, phaseLabel, queuedDetail, recordStatus, stateLabel } from '../../model/tools-records.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { detail, detailGrow, RecordCard, recordHead, recordIcon, recordRow, recordText } from './tool-parts.tsx';
import { ToolOutputRow } from './tool-outputs.tsx';
import { IMAGE_COPY, RECORD_COPY } from './tools-copy.ts';
import { copyText, useArtifactUrl, useCancelJob, useDownloadArtifact, useRecordRetry } from './use-tool-records.ts';

/*
 * 设计稿 image-gen.jsx `ImageResults`（425-442）、`ImageCard`（376-395）、`RunningCard`（396-409）、`ErrorCard`（411-423）：
 * 做完的一批是小标题 + 图格，在跑的一张进度卡，没做成的一张警示卡。取消了的不列（可能已经计费的照实留一张）。
 */

const batch = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const grid = style({ display: 'grid', gridTemplateColumns: { default: '[repeat(2, minmax(0, 1fr))]', isOne: '[minmax(0, 1fr)]' }, gap: 8 });
const card = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, minWidth: 0 });
const thumb = style({
  display: 'grid',
  placeItems: 'center',
  width: 'full',
  overflow: 'hidden',
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const img = style({ display: 'block', width: 'full', height: 'full', objectFit: 'contain' });
const name = style({ font: 'ui-sm', fontStyle: 'italic', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const truncate = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const errorTitle = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'orange-1000', overflowWrap: 'anywhere' });
const progress = style({ width: 'full' });
const caption = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

/** 「再试一次」：中断的就地重跑，其余照冻结的参数原样再提交（见 `useRecordRetry`）；编辑器里的带回 `videoId`，仍收进那个视频。 */
function useImageRetry(job: JobRecord, videoId?: Id) {
  const runtime = useRuntime();
  return useRecordRetry(
    job,
    'generateImage',
    (j) => {
      const request = retryRequest(j);
      return request ? runtime.generateImage(videoId ? { ...request, videoId } : request) : null;
    },
    { submitted: IMAGE_COPY.retried, failed: IMAGE_COPY.submitFailed },
  );
}

/** 右栏的一条生图记录：按状态画成一批结果、进度卡或警示卡。 */
export function ImageRecord({
  job,
  all,
  view,
  now,
  onAgain,
}: {
  job: JobRecord;
  all: readonly JobRecord[];
  view: ModelCapabilitiesView | null;
  now: number;
  onAgain: (job: JobRecord) => void;
}) {
  const provider = providerName(view, 'generateImage', job.providerId);
  // 取消了的不列；可能已经计费的照实留一张（服务商不支持取消时请求可能照样做完）。
  if (job.state === 'cancelled') {
    const cost = job.cancellation ? cancellationCost(job.cancellation) : null;
    return cost ? <CancelledCard job={job} cost={cost} /> : null;
  }
  const status = recordStatus(job);
  if (status === 'queued' || status === 'running') return <RunningCard job={job} all={all} provider={provider} />;
  if (didNotFinish(job)) return <ErrorCard job={job} />;
  return <DoneBatch job={job} provider={provider} now={now} onAgain={onAgain} />;
}

export function RunningCard({ job, all, provider }: { job: JobRecord; all: readonly JobRecord[]; provider: string }) {
  const cancel = useCancelJob();
  const pct = jobPercent(job);
  const phase = job.state === 'queued' ? (queuedDetail(job) ?? RECORD_COPY.ahead(aheadOf(all, job))) : (imageStepPhase(job) ?? phaseLabel(job));
  const line = `${phase} · ${provider}`;
  return (
    <RecordCard running={job.state !== 'queued'} label={imagePrompt(job)}>
      <div className={recordHead}>
        <span className={recordIcon} aria-hidden>
          <ImageIcon />
        </span>
        <span className={detailGrow} title={line}>
          {line}
        </span>
        <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
          <Text>{RECORD_COPY.cancel}</Text>
        </ActionButton>
      </div>
      {job.state !== 'queued' ? (
        <ProgressBar size="S" styles={progress} aria-label={line} isIndeterminate={pct === null} value={pct ?? undefined} />
      ) : null}
      <span className={truncate} title={imagePrompt(job)}>
        {imagePrompt(job)}
      </span>
    </RecordCard>
  );
}

export function ErrorCard({ job, videoId }: { job: JobRecord; videoId?: Id }) {
  const go = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const again = useImageRetry(job, videoId);
  // 结果不明的要先对账（任务详情里决定再试或放弃），这里不给重试、也不让藏起来。
  if (job.state === 'needs-reconciliation') {
    return (
      <RecordCard failed label={imagePrompt(job)}>
        <p className={errorTitle}>{failureText(job)}</p>
        <p className={recordText({ isOff: true })}>{imagePrompt(job)}</p>
        <span className={detail}>{RECORD_COPY.reconcileNote}</span>
        <div className={recordRow}>
          <Button variant="secondary" size="S" onPress={() => go({ tab: 'tasks', taskId: job.jobId })}>
            <OpenIn />
            <Text>{RECORD_COPY.reconcile}</Text>
          </Button>
        </div>
      </RecordCard>
    );
  }
  return (
    <RecordCard failed label={imagePrompt(job)}>
      <p className={errorTitle}>{IMAGE_COPY.failed(failureText(job))}</p>
      <p className={recordText({ isOff: true })}>{imagePrompt(job)}</p>
      <div className={recordRow}>
        {again.done ? (
          <span className={detail}>{IMAGE_COPY.retried}</span>
        ) : (
          <Button variant="secondary" size="S" isPending={again.pending} onPress={again.retry}>
            <Refresh />
            <Text>{IMAGE_COPY.retry}</Text>
          </Button>
        )}
        <ActionButton isQuiet size="S" onPress={() => hide(job.jobId)}>
          <Delete />
          <Text>{IMAGE_COPY.drop}</Text>
        </ActionButton>
      </div>
    </RecordCard>
  );
}

/** 取消了但可能已经计费的一条：照实写费用，可以藏起来。 */
export function CancelledCard({ job, cost }: { job: JobRecord; cost: string }) {
  const hide = useTools((s) => s.hide);
  return (
    <RecordCard label={imagePrompt(job)}>
      <span className={detail}>{`${IMAGE_COPY.cancelled} · ${cost}`}</span>
      <p className={recordText({ isOff: true })}>{imagePrompt(job)}</p>
      <div className={recordRow}>
        <ActionButton isQuiet size="S" onPress={() => hide(job.jobId)}>
          <Delete />
          <Text>{IMAGE_COPY.drop}</Text>
        </ActionButton>
      </div>
    </RecordCard>
  );
}

function DoneBatch({ job, provider, now, onAgain }: { job: JobRecord; provider: string; now: number; onAgain: (job: JobRecord) => void }) {
  const go = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const results = imageResults(job);
  const meta = imageBatchMeta(job, provider);
  const act = (key: string) => {
    if (key === 'copy') copyText(imagePrompt(job));
    else if (key === 'task') go({ tab: 'tasks', taskId: job.jobId });
    else if (key === 'remove') {
      hide(job.jobId);
      ToastQueue.neutral(RECORD_COPY.removed(meta), { timeout: 4000 });
    }
  };
  return (
    <section className={batch} aria-label={meta}>
      <div className={recordHead}>
        <span className={truncate} title={`${meta}\n${imagePrompt(job)}`}>
          {meta}
        </span>
        <span className={detailGrow} />
        <span className={detail}>{stateLabel(job, now)}</span>
        <ActionMenu aria-label={RECORD_COPY.more} isQuiet size="S" onAction={(key) => act(String(key))}>
          <MenuItem id="copy" textValue={RECORD_COPY.copyPrompt}>
            <Copy />
            <Text slot="label">{RECORD_COPY.copyPrompt}</Text>
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
      {results.length ? (
        <div className={grid({ isOne: results.length === 1 })}>
          {results.map((r) => (
            <ImageCard key={r.artifactId} job={job} result={r} onAgain={onAgain} />
          ))}
        </div>
      ) : (
        <span className={detail}>{RECORD_COPY.noFile}</span>
      )}
    </section>
  );
}

function ImageCard({ job, result, onAgain }: { job: JobRecord; result: ImageResult; onAgain: (job: JobRecord) => void }) {
  const media = useArtifactUrl(result.artifactId);
  const download = useDownloadArtifact();
  const [busy, setBusy] = useState(false);
  const mediaType = job.result?.outputs?.find((o) => o.artifactId === result.artifactId)?.mediaType ?? 'image/png';
  const fileName = imageFileName(result.name, mediaType);
  const prompt = imagePrompt(job);
  const entry = useSpace((s) => s.entries.find((e) => !e.user.trashedAt && e.ref && 'artifactId' in e.ref && e.ref.artifactId === result.artifactId) ?? null);
  return (
    <figure className={card}>
      <div className={thumb} style={{ aspectRatio: `${result.width || 1} / ${result.height || 1}` }}>
        {media?.status === 'ready' ? (
          <img className={img} src={media.url} alt={IMAGE_COPY.alt(result.name, prompt)} loading="lazy" />
        ) : (
          <span className={detail}>{media?.status === 'failed' ? RECORD_COPY.openFailed(media.message) : RECORD_COPY.loadingMedia}</span>
        )}
      </div>
      <figcaption className={caption}>
        <span className={name}>{result.name}</span>
        <span className={truncate}>{result.meta}</span>
      </figcaption>
      <div className={recordRow}>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            size="S"
            aria-label={RECORD_COPY.download(fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase())}
            isPending={busy}
            onPress={() => {
              setBusy(true);
              download(result.artifactId, fileName)
                .catch((e: Error) => ToastQueue.negative(RECORD_COPY.downloadFailed(e.message), { timeout: 6000 }))
                .finally(() => setBusy(false));
            }}>
            <Download />
          </ActionButton>
          <Tooltip>{RECORD_COPY.download(fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase())}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            size="S"
            aria-label={IMAGE_COPY.again}
            onPress={() => onAgain(job)}>
            <Refresh />
          </ActionButton>
          <Tooltip>{IMAGE_COPY.again}</Tooltip>
        </TooltipTrigger>
      </div>
      {entry ? <ToolOutputRow entry={entry} fromTool="generate-image" compact /> : null}
    </figure>
  );
}
