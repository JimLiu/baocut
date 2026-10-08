import { useState } from 'react';
import type { JobRecord, ModelCapabilitiesView } from '@baocut/protocol';
import { ActionButton, ActionMenu, Button, MenuItem, ProgressCircle, Text, ToastQueue } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import Edit from '@react-spectrum/s2/icons/Edit';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { cancellationCost } from '../../model/task-facts.ts';
import {
  retryTextRequest,
  textFacts,
  textFileName,
  textPrompt,
  textResultOf,
  textSpaceEntry,
  textTruncated,
} from '../../model/tools-text.ts';
import { providerName } from '../../model/tools-models.ts';
import { aheadOf, didNotFinish, failureText, phaseLabel, queuedDetail, recordStatus, stateLabel } from '../../model/tools-records.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { detail, detailGrow, RecordCard, recordHead, recordRow, recordText, recordTitle } from './tool-parts.tsx';
import { ToolOutputRow } from './tool-outputs.tsx';
import { RECORD_COPY, TEXT_COPY } from './tools-copy.ts';
import { copyText, useCancelJob, useDownloadArtifact, useRecordRetry } from './use-tool-records.ts';

/*
 * 设计稿 tool-llm.jsx 的记录卡（`.ttsrec`，85-90）：在跑时「等待模型返回…」可取消；做完了是结果名、模型、全文预览
 * （tools.css `.tool-llm__result`：最高 320、可滚、保留换行、12px）和「复制 / 下载」；没做成的给原因。
 * 取消了的不列（可能已经计费的照实留一张，见 tools-records.ts `listedRecords`）。
 */

const result = style({
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  font: 'body-xs',
  color: 'gray-800',
  userSelect: 'text',
  padding: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const meta = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const errorTitle = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'orange-1000', overflowWrap: 'anywhere' });
const warn = style({ margin: 0, font: 'ui-xs', color: 'orange-1000', overflowWrap: 'anywhere' });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });

/** 「再试一次」：中断的就地重跑，其余照冻结的参数原样再提交（见 `useRecordRetry`）。 */
function useTextRetry(job: JobRecord) {
  const runtime = useRuntime();
  return useRecordRetry(
    job,
    'generateText',
    (j) => {
      const request = retryTextRequest(j);
      return request ? runtime.generateText(request) : null;
    },
    { submitted: TEXT_COPY.retried, failed: TEXT_COPY.submitFailed },
  );
}

/** 右栏的一条文本生成记录：按状态画成结果卡、进度卡或警示卡。 */
export function TextRecord({
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
  const provider = providerName(view, 'generateText', job.providerId);
  if (job.state === 'cancelled') {
    const cost = job.cancellation ? cancellationCost(job.cancellation) : null;
    return cost ? <CancelledCard job={job} cost={cost} /> : null;
  }
  const status = recordStatus(job);
  if (status === 'queued' || status === 'running') return <RunningCard job={job} all={all} provider={provider} />;
  if (didNotFinish(job)) return <ErrorCard job={job} provider={provider} />;
  return <DoneCard job={job} provider={provider} now={now} onAgain={onAgain} />;
}

function RunningCard({ job, all, provider }: { job: JobRecord; all: readonly JobRecord[]; provider: string }) {
  const cancel = useCancelJob();
  const queued = job.state === 'queued';
  const line = queued ? (queuedDetail(job) ?? RECORD_COPY.ahead(aheadOf(all, job))) : TEXT_COPY.waiting;
  return (
    <RecordCard running={!queued} label={textPrompt(job)}>
      <span className={meta}>{`${provider} · ${job.modelId}`}</span>
      <div className={recordHead}>
        {queued ? null : <ProgressCircle size="S" isIndeterminate aria-label={TEXT_COPY.waiting} />}
        <span className={detailGrow} title={queued ? line : phaseLabel(job)}>
          {line}
        </span>
        <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
          <Text>{RECORD_COPY.cancel}</Text>
        </ActionButton>
      </div>
      <p className={recordText({ isOff: true })}>{textPrompt(job)}</p>
    </RecordCard>
  );
}

function ErrorCard({ job, provider }: { job: JobRecord; provider: string }) {
  const go = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const again = useTextRetry(job);
  // 结果不明的要先对账（任务详情里决定再试或放弃），这里不给重试、也不让藏起来。
  if (job.state === 'needs-reconciliation') {
    return (
      <RecordCard failed label={textPrompt(job)}>
        <p className={errorTitle}>{failureText(job)}</p>
        <span className={meta}>{`${provider} · ${job.modelId}`}</span>
        <p className={recordText({ isOff: true })}>{textPrompt(job)}</p>
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
    <RecordCard failed label={textPrompt(job)}>
      <p className={errorTitle}>{TEXT_COPY.failed(failureText(job))}</p>
      <span className={meta}>{`${provider} · ${job.modelId}`}</span>
      <p className={recordText({ isOff: true })}>{textPrompt(job)}</p>
      <div className={recordRow}>
        {again.done ? (
          <span className={detail}>{TEXT_COPY.retried}</span>
        ) : (
          <Button variant="secondary" size="S" isPending={again.pending} onPress={again.retry}>
            <Refresh />
            <Text>{TEXT_COPY.retry}</Text>
          </Button>
        )}
        <ActionButton isQuiet size="S" onPress={() => hide(job.jobId)}>
          <Delete />
          <Text>{TEXT_COPY.drop}</Text>
        </ActionButton>
      </div>
    </RecordCard>
  );
}

/** 取消了但可能已经计费的一条：照实写费用，可以藏起来。 */
function CancelledCard({ job, cost }: { job: JobRecord; cost: string }) {
  const hide = useTools((s) => s.hide);
  return (
    <RecordCard label={textPrompt(job)}>
      <span className={detail}>{`${TEXT_COPY.cancelled} · ${cost}`}</span>
      <p className={recordText({ isOff: true })}>{textPrompt(job)}</p>
      <div className={recordRow}>
        <ActionButton isQuiet size="S" onPress={() => hide(job.jobId)}>
          <Delete />
          <Text>{TEXT_COPY.drop}</Text>
        </ActionButton>
      </div>
    </RecordCard>
  );
}

function DoneCard({ job, provider, now, onAgain }: { job: JobRecord; provider: string; now: number; onAgain: (job: JobRecord) => void }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const hide = useTools((s) => s.hide);
  const entries = useSpace((s) => s.entries);
  const download = useDownloadArtifact();
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null);
  const text = textResultOf(job);
  const artifactId = job.result?.artifactId ?? null;
  const entry = textSpaceEntry(entries, job);
  const fileName = textFileName(job);
  const title = entry?.name ?? fileName;
  const facts = textFacts(job);

  const act = (key: string) => {
    if (key === 'copy') copyText(textPrompt(job));
    else if (key === 'again') onAgain(job);
    else if (key === 'task') go({ tab: 'tasks', taskId: job.jobId });
    else if (key === 'remove') {
      hide(job.jobId);
      ToastQueue.neutral(RECORD_COPY.removed(title), { timeout: 4000 });
    }
  };

  /** 复制全文：预览就是全文时直接复制，否则经受限地址读产物。 */
  const copyAll = async () => {
    if (!text) return;
    if (!text.previewTruncated || !artifactId) {
      copyText(text.preview);
      return;
    }
    setBusy('copy');
    try {
      const handle = await runtime.openArtifact(artifactId);
      const response = await fetch(handle.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      copyText(await response.text());
    } catch (e) {
      ToastQueue.negative(TEXT_COPY.copyFailed((e as Error).message), { timeout: 6000 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <RecordCard label={title}>
      <div className={recordHead}>
        <span className={recordTitle} title={title}>
          {title}
        </span>
        <span className={detail}>{stateLabel(job, now)}</span>
        <ActionMenu aria-label={RECORD_COPY.more} isQuiet size="S" onAction={(key) => act(String(key))}>
          <MenuItem id="copy" textValue={RECORD_COPY.copyPrompt}>
            <Copy />
            <Text slot="label">{RECORD_COPY.copyPrompt}</Text>
          </MenuItem>
          <MenuItem id="again" textValue={RECORD_COPY.reuse}>
            <Edit />
            <Text slot="label">{RECORD_COPY.reuse}</Text>
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
      <span className={meta} title={textPrompt(job)}>
        {[`${provider} · ${job.modelId}`, facts].filter(Boolean).join(' · ')}
      </span>
      {text ? (
        <>
          <pre className={result} tabIndex={0} aria-label={title}>
            {text.preview}
          </pre>
          {text.previewTruncated ? <p className={note}>{TEXT_COPY.previewCut(text.preview.length, text.length)}</p> : null}
          {textTruncated(job) ? <p className={warn}>{TEXT_COPY.truncated}</p> : null}
          {text.notes.length ? <p className={note}>{text.notes.join(' ')}</p> : null}
          <div className={recordRow}>
            <Button variant="secondary" size="S" isPending={busy === 'copy'} onPress={() => void copyAll()}>
              <Copy />
              <Text>{TEXT_COPY.copy}</Text>
            </Button>
            {artifactId ? (
              <Button
                variant="secondary"
                size="S"
                isPending={busy === 'download'}
                onPress={() => {
                  setBusy('download');
                  download(artifactId, fileName)
                    .catch((e: Error) => ToastQueue.negative(RECORD_COPY.downloadFailed(e.message), { timeout: 6000 }))
                    .finally(() => setBusy(null));
                }}>
                <Download />
                <Text>{TEXT_COPY.download}</Text>
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <span className={detail}>{RECORD_COPY.noFile}</span>
      )}
      {entry ? <ToolOutputRow entry={entry} fromTool="generate-text" compact /> : null}
    </RecordCard>
  );
}
