import type { Id, JobPhase, JobRecord } from '@baocut/protocol';
import { Button, Content, Heading, InlineAlert, ProgressBar } from '@react-spectrum/s2';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { JOB_PHASE_LABEL } from '../../copy.ts';
import { formatClock } from '../../model/format.ts';
import { jobPercent } from '../../model/task-list.ts';
import { useShell } from '../../state/shell-store.ts';
import { SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { cancelTranscribe, dismissProblem, type TranscribeProblem, type TranscribeRun } from './transcribe-run.ts';

const head = style({
  flexShrink: 0,
  paddingX: 12,
  paddingTop: 12,
  paddingBottom: '[14px]',
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-900' });
const titleIcon = style({ display: 'flex', flexShrink: 0, '--iconPrimary': { type: 'fill', value: 'blue-900' } });
const title = style({ flexGrow: 1, minWidth: 0, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const percent = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-700' });
const bar = style({ width: 'full', marginTop: 8 });
const meta = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '[6px]', marginTop: '[6px]', font: 'ui-xs', color: 'gray-600' });
const dot = style({ color: 'gray-400' });
const ladder = style({ display: 'flex', gap: 8, marginTop: '[10px]' });
const step = style({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
const stepBar = style({
  display: 'block',
  height: 4,
  borderRadius: 'full',
  backgroundColor: { default: 'gray-300', isDone: 'green-900', isCurrent: 'blue-900' },
});
const stepLabel = style({
  display: 'block',
  marginTop: 4,
  fontSize: '[10px]',
  color: { default: 'gray-500', isDone: 'green-1000', isCurrent: 'blue-1000' },
  fontWeight: { default: 'normal', isCurrent: 'bold' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const actions = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 });
const note = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const alertBox = style({ flexShrink: 0, paddingX: 12, paddingTop: 12 });
const alertActions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });

/**
 * 任务阶段 → 四段阶梯（原型 model-transcript.js `LIVE_STAGES`：解码音频 / 识别 / 词级对齐 / 落盘）。按 Runtime 报来的真实阶段走，
 * 不按百分比猜；生成任务的几个阶段在这里用不到，也给个落点。
 */
const STAGE_OF: Record<JobPhase, number> = {
  queued: 0,
  starting: 0,
  loading: 0,
  probing: 0,
  downloading: 0,
  moving: 0,
  decoding: 0,
  vad: 0,
  transcribing: 1,
  generating: 1,
  aligning: 2,
  diarizing: 2,
  validating: 3,
  finalizing: 3,
  encoding: 3,
  publishing: 3,
  applying: 3,
  done: 3,
};

/**
 * 转录运行态头（原型 panel-shared.jsx `LiveHead`）：标题、百分比、进度条、计数、四段阶梯、取消。`job` 是画进度的那个
 * （转录流程时是它的转写一步），`cancelJobId` 是取消的那个（转录流程的父任务）；不给时取消 `job`。`note` 换掉取消钮旁边那句
 * （文稿面板的实时态说「识别出来的部分会一段一段出现」）。
 */
export function TranscribeProgress({
  run,
  job,
  cancelJobId = null,
  assetName,
  note: noteText,
  heading: headingText,
}: {
  run: TranscribeRun | null;
  job: JobRecord | null;
  cancelJobId?: Id | null;
  assetName: string | null;
  note?: string;
  /** 换掉「生成字幕」那一级的标题（实时文稿：识别做完、结果还在写进视频时，不一定要建字幕）。 */
  heading?: string;
}) {
  const writing = run?.status === 'writing';
  const submitting = run?.status === 'submitting' || (run?.status === 'running' && !job);
  const live = !writing && !submitting && job ? job : null;
  // 总量不明时不造百分比（`progress.total` 为 null）。
  const pct = live ? jobPercent(live) : null;
  const stage = writing ? 3 : live ? STAGE_OF[live.phase] : 0;
  const heading = writing ? (headingText ?? C.writing) : submitting ? C.submitting : C.liveTitle;
  const progress = live?.progress ?? null;
  const count =
    progress?.unit === 'seconds'
      ? C.transcribed(formatClock(progress.done), progress.total == null ? null : formatClock(progress.total))
      : progress?.unit === 'segments'
        ? C.segments(progress.done, progress.total)
        : null;
  const phase = writing ? null : live ? JOB_PHASE_LABEL[live.phase] : null;
  return (
    <div className={head} role="status" aria-live="polite">
      <div className={titleRow}>
        <span className={titleIcon}>
          <Microphone />
        </span>
        <span className={title}>{assetName ? `${heading} · ${assetName}` : heading}</span>
        {pct === null ? null : <span className={`${percent} bc-tabular`}>{pct}%</span>}
      </div>
      <ProgressBar
        size="S"
        aria-label={heading}
        isIndeterminate={pct === null}
        {...(pct === null ? {} : { value: pct })}
        styles={bar}
      />
      {count || phase ? (
        <div className={meta}>
          {count ? <span className="bc-tabular">{count}</span> : null}
          {count && phase ? <span className={dot}>·</span> : null}
          {phase ? <span>{phase}</span> : null}
        </div>
      ) : null}
      <div className={ladder}>
        {C.stages.map((label, index) => (
          <div key={label} className={step}>
            <span className={stepBar({ isDone: index < stage, isCurrent: index === stage })} />
            <span className={stepLabel({ isDone: index < stage, isCurrent: index === stage })}>{label}</span>
          </div>
        ))}
      </div>
      <div className={actions}>
        {live ? (
          <Button size="S" variant="secondary" onPress={() => void cancelTranscribe(cancelJobId ?? live.jobId)}>
            {C.cancel}
          </Button>
        ) : null}
        <span className={note}>{noteText ?? (run ? C.liveNote : C.foreignNote)}</span>
      </div>
    </div>
  );
}

const VARIANT = { 'not-configured': 'notice', failed: 'negative', empty: 'informative', pending: 'informative', decide: 'notice' } as const;

/**
 * 转录没走通：配置缺失给原因、`remedy.hint` 与去处；失败、没有语音、没有音轨如实说；要用户拿主意的指到后台任务。
 * `onDismiss` 缺省收起这条问题；null 时不给收起（别处发起、等着处理的任务）。
 */
export function TranscribeProblemAlert({
  videoId,
  problem,
  onDismiss,
}: {
  videoId: Id;
  problem: TranscribeProblem;
  onDismiss?: (() => void) | null;
}) {
  const go = useShell((s) => s.go);
  return (
    <div className={alertBox}>
      <InlineAlert variant={VARIANT[problem.kind]}>
        <Heading>{problem.title}</Heading>
        <Content>
          {problem.message ? <div>{problem.message}</div> : null}
          <div className={alertActions}>
            {problem.remedy ? (
              <Button size="S" variant="secondary" onPress={() => go(problem.remedy!.target)}>
                {problem.remedy.label}
              </Button>
            ) : null}
            {onDismiss === null ? null : (
              <Button size="S" variant="secondary" fillStyle="outline" onPress={onDismiss ?? (() => dismissProblem(videoId))}>
                {C.dismiss}
              </Button>
            )}
          </div>
        </Content>
      </InlineAlert>
    </div>
  );
}
