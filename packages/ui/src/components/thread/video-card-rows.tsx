import { useMemo, useState, type ReactNode } from 'react';
import type { Id, JobRecord } from '@baocut/protocol';
import { ActionButton, Badge, Button, ProgressBar, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Download from '@react-spectrum/s2/icons/Download';
import Export from '@react-spectrum/s2/icons/Export';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { VIDEO_CARD_COPY } from '../../copy.ts';
import { exportTimeLeft } from '../../model/export-job.ts';
import { isLinkImport, linkMeta } from '../../model/link-import.ts';
import { jobLive } from '../../model/task-list.ts';
import {
  asrLine,
  asrModelName,
  cardRows,
  downloadCardView,
  foldRows,
  jobRowView,
  type JobRowView,
  type VideoStatus,
} from '../../model/video-cards.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useExportSpeed, useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTaskAction } from '../tasks/use-task-actions.ts';
import { TRANSCRIBE_TOOL_COPY } from '../tools/tools-copy.ts';
import { useNow } from '../use-now.ts';
import { M } from './video-cards-copy.ts';
import './agent-thread.css';
import './video-cards.css';

/**
 * 视频卡下面的一件活一行、下载卡（产品设计 §3.2.2、§6.5；原型 agent-cards.jsx `JobRow` / `DownloadCard`、agent-cards.css）。
 * 逐边边框、等宽数字这些 style 宏表达不了的规则在 video-cards.css；颜色变量挂在卡片根上（会话头的「产物」弹层经 portal 渲染，
 * 拿不到线程列上的变量）。
 */
export const cardVars = style({
  '--bc-vc-text': { type: 'color', value: 'gray-900' },
  '--bc-vc-body': { type: 'color', value: 'gray-800' },
  '--bc-vc-muted': { type: 'color', value: 'gray-700' },
  '--bc-vc-faint': { type: 'color', value: 'gray-600' },
  '--bc-vc-live': { type: 'color', value: 'blue-900' },
  '--bc-vc-ok': { type: 'color', value: 'green-900' },
  '--bc-vc-warn': { type: 'color', value: 'orange-900' },
  '--bc-vc-err': { type: 'color', value: 'red-900' },
  '--bc-vc-line': { type: 'borderColor', value: 'gray-200' },
  '--bc-vc-bg': { type: 'backgroundColor', value: 'gray-25' },
  '--bc-vc-ic-bg': { type: 'backgroundColor', value: 'blue-100' },
  '--bc-vc-ic-err-bg': { type: 'backgroundColor', value: 'red-100' },
  '--bc-vc-ic-idle-bg': { type: 'backgroundColor', value: 'gray-75' },
  // 「之前的 N 项」那一行（照线程步骤行 thread.tsx 的 --bc-at-faint / row-hover / focus）。
  '--bc-vc-chev': { type: 'color', value: 'gray-500' },
  '--bc-vc-hover': { type: 'backgroundColor', value: 'gray-75' },
  '--bc-vc-focus': { type: 'outlineColor', value: 'focus-ring' },
  // 运行中的扫光（agent-thread.css `.bc-shimmer`）在弹层里也要。
  '--bc-at-shimmer': { type: 'color', value: 'gray-700' },
  '--bc-at-shimmer-hi': { type: 'color', value: 'gray-300' },
});

const ROW_ICON: Record<JobRowView['kind'], ReactNode> = {
  transcribe: <Transcript />,
  translate: <Translate />,
  export: <Export />,
  'link-import': <Download />,
  other: <Video />,
};

const BADGE: Record<VideoStatus['key'], 'informative' | 'neutral' | 'positive' | 'negative'> = {
  transcribing: 'informative',
  queued: 'neutral',
  translating: 'informative',
  transcribed: 'positive',
  failed: 'negative',
};

/** 视频卡头上的状态词（转录中 · 45% / 排队中 / 翻译中 · 30% / 已转录 / 失败）。 */
export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  return (
    <Badge variant={BADGE[status.key]} fillStyle="subtle" size="S">
      {status.text}
    </Badge>
  );
}

/**
 * Job 镜像里决定卡片放在哪、是哪部视频的那几项（ID、提交者、视频、父任务、状态与结束时刻、链接标题）。进度一秒变几次，线程不必跟着重排；
 * 只在这些变了时取一次镜像。每张卡自己订阅镜像画进度。
 */
export function useJobsForPlacement(): readonly JobRecord[] {
  const key = useJobs((s) =>
    s.jobs
      .map((j) => {
        const sub = j.submitter;
        const who = sub.kind === 'agent' ? `${sub.id}/${sub.taskId}` : 'id' in sub ? String(sub.id) : '';
        return [
          j.jobId,
          j.kind,
          j.videoId,
          j.parentJobId ?? '',
          sub.kind,
          who,
          j.createdAt,
          // 卡挂在哪一轮要看活结束没有、什么时候结束（还在跑的活把卡带到最新一轮）。
          j.state,
          j.endedAt,
          j.pipeline?.name ?? '',
          j.export?.settings.purpose ?? '',
          isLinkImport(j) ? linkMeta(j).title : '',
        ]
          .map((v) => v ?? '')
          .join('|');
      })
      .join('\n'),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在结构变了时重取
  return useMemo(() => useJobs.getState().jobs, [key]);
}

const progress = style({ width: 'full' });

/** 转录那一行的字（`asrLine`）：模型名从能力视图与模型包取，「自动检测」「识别说话人」与转录工具页同一套用词。 */
function useAsrText(): (row: JobRowView) => string | null {
  const view = useModels((s) => s.capabilities);
  const bundles = useModels((s) => s.bundles);
  return (row) =>
    row.asr
      ? asrLine(row.asr, asrModelName(view, bundles, row.asr.providerId, row.asr.modelId), {
          auto: TRANSCRIBE_TOOL_COPY.autoDetect,
          speakers: TRANSCRIBE_TOOL_COPY.speakers,
        })
      : null;
}

function useRowActions() {
  const runtime = useRuntime();
  const act = useTaskAction();
  const go = useShell((s) => s.go);
  return {
    cancel: (jobId: Id) => act({ type: 'cancel', jobId }),
    retry: (jobId: Id) =>
      void runtime
        .reconcileJob(jobId, 'retry')
        .catch((e: Error) => ToastQueue.negative(VIDEO_CARD_COPY.retryFailed(e.message), { timeout: 5000 })),
    reveal: (path: string) => void runtime.host.revealPath(path),
    play: (artifactId: string) =>
      void runtime.openArtifact(artifactId).then(
        (handle) => void window.open(handle.url, '_blank', 'noopener'),
        (e: Error) => ToastQueue.negative(VIDEO_CARD_COPY.openFailed(e.message), { timeout: 5000 }),
      ),
    go,
  };
}

/**
 * 视频卡下面这条会话归这部视频的活（线程里与「产物」弹层里同一份）。没有行时不画。只摊开进行中的，都结束了只摊开最后一件；
 * 其余收进一行「之前的 N 项」（`foldRows`，产品设计 §3.2.2；原型 agent-cards.jsx `MovieJobRows`），默认收起，
 * 展开是紧凑的历史行，新的在前。开合只是这张卡自己的事，不进 store；样子照线程的步骤行（steps-group.tsx）。
 */
export function VideoJobRows({ jobIds }: { jobIds: readonly Id[] }) {
  const jobs = useJobs((s) => s.jobs);
  const rows = useMemo(() => cardRows(jobIds, jobs), [jobIds, jobs]);
  const now = useNow(1000, rows.some(jobLive));
  const actions = useRowActions();
  const asrText = useAsrText();
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const { shown, earlier, pending } = foldRows(rows.map((job) => jobRowView(job, jobs, now)));
  return (
    <ul className="bc-vjobs" aria-label={VIDEO_CARD_COPY.rows}>
      {shown.map((row) => (
        <JobRow key={row.jobId} row={row} actions={actions} asr={asrText(row)} />
      ))}
      {earlier.length ? (
        <li className="bc-vjobs__more">
          {/* 有待处理时两段字读屏会连成一串，另给一句完整的名字；没有时就念按钮文字。 */}
          <button
            type="button"
            className="bc-vjobs__toggle"
            aria-expanded={open}
            aria-label={pending ? M.earlierWithPending(earlier.length, pending) : undefined}
            onClick={() => setOpen((v) => !v)}>
            <span className="bc-vjobs__label">{M.earlier(earlier.length)}</span>
            {pending ? (
              <span className="bc-vjobs__pending">
                <AlertTriangle />
                {M.pending(pending)}
              </span>
            ) : null}
            <span className="bc-vjobs__chev">{open ? <ChevronDown /> : <ChevronRight />}</span>
          </button>
          {open ? (
            <ul className="bc-vjobs__earlier" aria-label={M.earlierList}>
              {earlier.map((row) => (
                <JobRow key={row.jobId} row={row} actions={actions} compact />
              ))}
            </ul>
          ) : null}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * 一件活一行。`compact` 是「之前的 N 项」展开后的历史行：只留头一行、导出的文件名与按钮、失败原因与补救 / 重试，
 * 不画进度、结果事实、转录的模型、提醒、文件尺寸与说明（展开的历史只用来找回导出的文件和失败的去处）。
 * `asr`：转录与重新转录用的模型与参数，只读（产品设计 §3.2.2）。
 */
function JobRow({
  row,
  actions,
  asr = null,
  compact = false,
}: {
  row: JobRowView;
  actions: ReturnType<typeof useRowActions>;
  asr?: string | null;
  compact?: boolean;
}) {
  const full = !compact;
  const running = row.state === 'running';
  // 导出在渲染时，已用时长后面接预计剩余时间（与导出窗口同一份推算，`useExportSpeed`）；算不出、别的活不写。
  const left = exportTimeLeft(useExportSpeed(full && running && row.kind === 'export' ? row.jobId : null));
  const time = full ? [row.elapsed, left].filter(Boolean).join(' · ') || null : null;
  const hasFoot = !!time || row.canCancel || row.canRetry || !!row.remedy;
  return (
    <li className={`bc-vjob${compact ? ' bc-vjob--compact' : ''} is-${row.state}`}>
      <div className="bc-vjob__head">
        <span className="bc-vjob__ic">{row.state === 'failed' ? <AlertTriangle /> : ROW_ICON[row.kind]}</span>
        <span className={`bc-vjob__name${running ? ' bc-shimmer' : ''}`} title={row.name}>
          {row.name}
        </span>
        {row.tail ? <span className="bc-vjob__tail">{row.tail}</span> : null}
      </div>
      {full && running ? (
        <ProgressBar
          size="S"
          styles={progress}
          aria-label={`${row.name} · ${row.line ?? row.tail ?? ''}`}
          isIndeterminate={row.pct == null}
          value={row.pct ?? undefined}
        />
      ) : null}
      {full && row.line ? <span className="bc-vjob__line">{row.line}</span> : null}
      {full && row.facts.length ? <span className="bc-vjob__line">{row.facts.join(' · ')}</span> : null}
      {full && asr ? (
        <span className="bc-vjob__asr" title={asr}>
          {asr}
        </span>
      ) : null}
      {full
        ? row.warnings.map((w) => (
            <span key={w} className="bc-vjob__warn">
              {w}
            </span>
          ))
        : null}
      {row.files.map((file) => (
        <div key={file.key} className="bc-vjob__file">
          <span className="bc-vjob__fname" title={file.name}>
            {file.name}
          </span>
          {full && file.meta ? <span className="bc-vjob__fmeta">{file.meta}</span> : null}
          {row.playable[file.key] || file.path ? (
            <span className="bc-vjob__facts">
              {row.playable[file.key] ? (
                <ActionButton size="XS" isQuiet onPress={() => actions.play(row.playable[file.key]!)}>
                  {VIDEO_CARD_COPY.play}
                </ActionButton>
              ) : null}
              {file.path ? (
                <ActionButton size="XS" isQuiet onPress={() => actions.reveal(file.path!)}>
                  {VIDEO_CARD_COPY.reveal}
                </ActionButton>
              ) : null}
            </span>
          ) : null}
        </div>
      ))}
      {row.error ? <span className="bc-vjob__err">{row.error}</span> : null}
      {full && row.remedy ? <span className="bc-vjob__hint">{row.remedy.hint}</span> : null}
      {hasFoot ? (
        <div className="bc-vjob__foot">
          <span className="bc-vjob__time">{time}</span>
          {row.remedy ? (
            <Button size="S" variant="secondary" onPress={() => actions.go(row.remedy!.target)}>
              {row.remedy.label}
            </Button>
          ) : null}
          {row.canRetry ? (
            <Button size="S" variant="secondary" onPress={() => actions.retry(row.jobId)}>
              {VIDEO_CARD_COPY.retry}
            </Button>
          ) : null}
          {row.canCancel ? (
            <ActionButton size="S" isQuiet onPress={() => actions.cancel(row.jobId)}>
              {VIDEO_CARD_COPY.cancel}
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** 下载卡（原型 agent-cards.jsx `DownloadCard`）：智能体从链接导入、视频还没建出来时的一张。 */
export function DownloadCard({ jobId }: { jobId: Id }) {
  const jobs = useJobs((s) => s.jobs);
  const job = jobs.find((j) => j.jobId === jobId);
  const now = useNow(1000, !!job && jobLive(job));
  const actions = useRowActions();
  if (!job) return null;
  const c = downloadCardView(job, jobs, now);
  const hasFoot = !!c.elapsed || c.canCancel || c.canRetry;
  return (
    <section className={`bc-dlcard is-${c.state} ${cardVars}`} aria-label={`${c.title} · ${c.name}`}>
      <header className="bc-dlcard__head">
        <span className="bc-dlcard__ic">{c.state === 'failed' || c.state === 'interrupted' ? <AlertTriangle /> : <Download />}</span>
        <span className="bc-dlcard__titles">
          <span className={`bc-dlcard__title${c.state === 'running' ? ' bc-shimmer' : ''}`}>{c.title}</span>
          <span className="bc-dlcard__name" title={c.name}>
            {c.name}
          </span>
        </span>
        {c.pct != null ? <span className="bc-dlcard__pct">{`${c.pct}%`}</span> : null}
      </header>
      {c.source ? (
        <span className="bc-dlcard__src" title={c.source}>
          {c.source}
        </span>
      ) : null}
      {c.state === 'running' ? (
        <ProgressBar
          size="S"
          styles={progress}
          aria-label={`${c.title} · ${c.name}`}
          isIndeterminate={c.pct == null}
          value={c.pct ?? undefined}
        />
      ) : null}
      {c.line ? <span className="bc-dlcard__line">{c.line}</span> : null}
      {c.error ? <span className="bc-dlcard__err">{c.error}</span> : null}
      {c.hint ? <span className="bc-dlcard__hint">{c.hint}</span> : null}
      {c.files.map((file) => (
        <div key={file.path} className="bc-dlcard__file">
          <span className="bc-vjob__fname" title={file.path}>
            {file.name}
          </span>
          <ActionButton size="XS" isQuiet onPress={() => actions.reveal(file.path)}>
            {VIDEO_CARD_COPY.reveal}
          </ActionButton>
        </div>
      ))}
      {hasFoot ? (
        <div className="bc-vjob__foot">
          <span className="bc-vjob__time">{c.elapsed}</span>
          {c.canRetry ? (
            <Button size="S" variant="secondary" onPress={() => actions.retry(c.jobId)}>
              {VIDEO_CARD_COPY.retry}
            </Button>
          ) : null}
          {c.canCancel ? (
            <ActionButton size="S" isQuiet onPress={() => actions.cancel(c.jobId)}>
              {VIDEO_CARD_COPY.cancel}
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
