import { Fragment, useMemo, useState } from 'react';
import { pipelineStepLabel, type Id, type JobRecord, type LibraryEntrySummary } from '@baocut/protocol';
import { AlertDialog, Button, Content, DialogContainer, Heading, InlineAlert, ProgressBar } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { recipientName } from '../../model/data-grants.ts';
import {
  dubLadder,
  dubLanguageOf,
  dubProgress,
  dubUnitRows,
  liveDubs,
  originalAudioText,
  separationText,
  voiceFailures,
  voiceReasonText,
  type DubProgress,
  type VoiceFailure,
} from '../../model/dub-progress.ts';
import { grantFacts, voiceName } from '../../model/dub-setup.ts';
import { langName } from '../../model/tools-models.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVoices } from '../../state/voices-store.ts';
import { DUB_COPY as C, DUB_SPEAKER_SOURCE } from './dub-copy.ts';
import {
  cancelDub,
  confirmGrant,
  dismissAsk,
  dismissDubProblem,
  dismissDubReceipt,
  retryDub,
  undoDub,
  useDubRun,
  type DubAsk,
  type DubProblem,
  type DubReceipt,
  type DubRun,
} from './dub-run.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/*
 * 翻译配音的运行态、授权询问、问题与收据（设计稿 panel-dub.jsx 的进度与收尾）。进度只读 Runtime 报来的：父任务的步骤、
 * 翻译与合成那一步子任务的句数、逐句子任务；没有总数时不造百分比。
 */

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
const dot = style({ flexShrink: 0, width: 8, height: 8, borderRadius: 'full', backgroundColor: { default: 'blue-800', isQueued: 'gray-400' } });
const title = style({ flexGrow: 1, minWidth: 0, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const percent = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-700' });
const bar = style({ width: 'full', marginTop: 8 });
const meta = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '[6px]', marginTop: '[6px]', font: 'ui-xs', color: 'gray-600' });
const sep = style({ color: 'gray-400' });
const ladder = style({ display: 'flex', gap: 4, marginTop: '[10px]' });
const step = style({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
const stepBar = style({
  display: 'block',
  height: 4,
  borderRadius: 'full',
  backgroundColor: { default: 'gray-300', isDone: 'green-900', isCurrent: 'blue-900', isBad: 'red-900' },
});
const stepLabel = style({
  display: 'block',
  marginTop: 4,
  fontSize: '[10px]',
  color: { default: 'gray-500', isDone: 'green-1000', isCurrent: 'blue-1000', isBad: 'red-1000' },
  fontWeight: { default: 'normal', isCurrent: 'bold' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const actions = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 });
const note = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const noShrink = style({ flexShrink: 0 });
/** 卡片外框：单独挂在面板里时左右留 12；放进已经有内边距的滚动区（`flush`）时不再留。 */
const alertBox = style({ flexShrink: 0, paddingX: { default: 12, isFlush: 0 }, paddingTop: 12 });
const alertActions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });
const alertNote = style({ marginTop: 4, font: 'ui-xs', color: 'gray-700', lineHeight: '[1.5]' });
const alertError = style({ marginTop: 4, font: 'ui-xs', color: 'negative', lineHeight: '[1.5]' });
const group = style({ marginTop: 8 });
const groupHead = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-800' });
const list = style({ margin: 0, marginTop: 2, paddingStart: 16, font: 'ui-xs', color: 'gray-800', lineHeight: '[1.5]' });
const muted = style({ color: 'gray-600' });
const facts = style({ display: 'grid', gridTemplateColumns: ['auto', 'minmax(0, 1fr)'], columnGap: 12, rowGap: 4, margin: 0, marginTop: 8 });
const factLabel = style({ font: 'ui-sm', color: 'gray-700', whiteSpace: 'nowrap' });
const factValue = style({ margin: 0, font: 'ui-sm', color: 'gray-900' });
const code = style({
  display: 'block',
  marginTop: 4,
  padding: 8,
  borderRadius: 'sm',
  backgroundColor: 'gray-100',
  font: 'code-xs',
  color: 'gray-900',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** 服务商 ID → 名字（模型视图里各能力的服务商）：授权的接收方照它写。 */
function useProviderLabels(): ReadonlyMap<string, string> {
  const capabilities = useModels((s) => s.capabilities);
  return useMemo(() => {
    const map = new Map<string, string>();
    if (capabilities) for (const view of Object.values(capabilities)) for (const p of view.providers) map.set(p.providerId, p.label);
    return map;
  }, [capabilities]);
}

export interface DubLive {
  /** 从这里提交的这一轮；别处发起的为 null。 */
  run: DubRun | null;
  /** 父任务；刚提交、回执还没到时为 null。 */
  job: JobRecord | null;
  language: string | null;
  progress: DubProgress | null;
}

/** 这个视频正在跑的配音：从这里提交的那一轮，或别处（智能体、命令行）发起、还活着的。 */
export function useDubLive(videoId: Id | null): DubLive | null {
  const run = useDubRun((s) => (videoId ? (s.runs[videoId] ?? null) : null));
  const jobs = useJobs((s) => s.jobs);
  return useMemo(() => {
    if (!videoId) return null;
    const job = run ? (run.jobId ? (jobs.find((j) => j.jobId === run.jobId) ?? null) : null) : (liveDubs(jobs, videoId)[0] ?? null);
    if (!run && !job) return null;
    return {
      run,
      job,
      language: run?.language ?? (job ? dubLanguageOf(job) : null),
      progress: job && run?.status !== 'settling' ? dubProgress(job, jobs) : null,
    };
  }, [videoId, run, jobs]);
}

/** 运行态头：语言、百分比、进度条、句数与步骤、逐句子任务、步骤阶梯、取消。 */
export function DubRunHead({ live }: { live: DubLive }) {
  const { run, job, progress } = live;
  // 重试刚提交、镜像里还是那条已经结束的记录时，按「提交中」画。
  const stale = !!run && !!job && !isJobLive(job);
  const submitting = run?.status === 'submitting' || !job || stale;
  const queued = !submitting && !!progress?.queued;
  const language = live.language ? langName(live.language) : '…';
  const heading = submitting ? C.submitting : queued ? C.queued : C.running(language);
  const pct = submitting || queued || !progress ? null : progress.percent;
  const steps = job && !stale ? dubLadder(job) : [];
  const sentences = progress?.sentences ? C.sentences(progress.sentences.running, progress.sentences.failed) : '';
  const metaParts = [
    progress?.units ? C.stepUnits(progress.units.step, progress.units.done, progress.units.total) : '',
    progress?.step?.label ?? '',
    sentences,
  ].filter(Boolean);
  return (
    <div className={head} role="status" aria-live="polite">
      <div className={titleRow}>
        <span className={dot({ isQueued: queued })} aria-hidden />
        <span className={title}>{heading}</span>
        {pct === null ? null : <span className={`${percent} bc-tabular`}>{pct}%</span>}
      </div>
      <ProgressBar size="S" aria-label={heading} isIndeterminate={pct === null} {...(pct === null ? {} : { value: pct })} styles={bar} />
      {!submitting && metaParts.length ? (
        <div className={meta}>
          {metaParts.map((part, index) => (
            <span key={part} className={index === 0 && progress?.units ? 'bc-tabular' : undefined}>
              {index ? <span className={sep}>· </span> : null}
              {part}
            </span>
          ))}
        </div>
      ) : null}
      {steps.length ? (
        <div className={ladder}>
          {steps.map((s) => {
            const isDone = s.status === 'completed' || s.status === 'skipped';
            const isCurrent = s.status === 'running';
            const isBad = s.status === 'failed' || s.status === 'interrupted';
            return (
              <div key={s.name} className={step} title={pipelineStepLabel(s)}>
                <span className={stepBar({ isDone, isCurrent, isBad })} />
                <span className={stepLabel({ isDone, isCurrent, isBad })}>{pipelineStepLabel(s)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className={actions}>
        {job && isJobLive(job) && !stale ? (
          <Button size="S" variant="secondary" styles={noShrink} onPress={() => void cancelDub(job.jobId)}>
            {C.cancel}
          </Button>
        ) : null}
        <span className={note}>{run ? C.liveNote : C.foreign}</span>
      </div>
    </div>
  );
}

/**
 * 第一次配音（或重试）被授权拒绝：说明要外发什么、给谁；「发放授权并开始」先弹确认框，写清外发什么 / 给谁 / 限哪个视频 /
 * 用途，按了「发放并继续」才发 `grants.create`，之后用同样的参数重新提交。
 */
export function DubAskCard({ videoId, ask, videoName, flush = false }: { videoId: Id; ask: DubAsk; videoName: string | null; flush?: boolean }) {
  const labels = useProviderLabels();
  const [confirming, setConfirming] = useState(false);
  const recipient = recipientName(ask.refusal.recipient, labels);
  const granting = ask.status === 'granting';
  const rows = grantFacts(ask.refusal, labels, videoName, ask.purpose);
  return (
    <div className={alertBox({ isFlush: flush })}>
      <InlineAlert variant="notice">
        <Heading>{C.grantTitle(recipient)}</Heading>
        <Content>
          <div>{C.grantBody}</div>
          {ask.refusal.hint ? <div className={alertNote}>{ask.refusal.hint}</div> : null}
          {ask.granted.length ? <div className={alertNote}>{C.grantNext}</div> : null}
          {ask.error ? <div className={alertError}>{ask.error}</div> : null}
          <div className={alertActions}>
            <Button size="S" variant="accent" isPending={granting} onPress={() => setConfirming(true)}>
              {ask.resume.kind === 'retry' ? C.grantRetryAction : C.grantAction}
            </Button>
            <Button size="S" variant="secondary" fillStyle="outline" isDisabled={granting} onPress={() => dismissAsk(videoId)}>
              {C.grantCancel}
            </Button>
          </div>
        </Content>
      </InlineAlert>
      <DialogContainer onDismiss={() => setConfirming(false)}>
        {confirming ? (
          <AlertDialog
            variant="confirmation"
            title={C.grantDialogTitle}
            primaryActionLabel={C.grantConfirm}
            cancelLabel={E.cancel}
            onPrimaryAction={() => void confirmGrant(videoId)}>
            {C.grantDialogIntro}
            <dl className={facts}>
              {rows.map(([label, value]) => (
                <Fragment key={label}>
                  <dt className={factLabel}>{label}</dt>
                  <dd className={factValue}>{value}</dd>
                </Fragment>
              ))}
            </dl>
            {ask.refusal.commands.length ? (
              <div className={group}>
                <div className={groupHead}>{C.commands}</div>
                <code className={code}>{ask.refusal.commands.join('\n')}</code>
              </div>
            ) : null}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

const VARIANT = { 'not-configured': 'notice', failed: 'negative' } as const;

const retryNoteText = (note: 'charges' | 'partial' | 'free' | null) =>
  note === 'charges' ? C.retryCharges : note === 'partial' ? C.retryPartial : note === 'free' ? C.retryFree : null;

/** 说话人的名字：转写里登记的；没有时照写 ID。 */
const speakerLabel = (speakerId: string | null, names: ReadonlyMap<string, string>) =>
  speakerId === null ? C.speakerNone : (names.get(speakerId) ?? speakerId);

function VoiceFailureList({ rows, names, library }: { rows: VoiceFailure[]; names: ReadonlyMap<string, string>; library: readonly LibraryEntrySummary[] }) {
  return (
    <ul className={list}>
      {rows.map((row) => (
        <li key={row.speakerId}>
          {C.voiceFailedLine(speakerLabel(row.speakerId, names), row.units.length, voiceReasonText(row.code, row.reason))}
          <span className={muted}> · {voiceName(row.voice, null, library)}</span>
        </li>
      ))}
    </ul>
  );
}

/** 配音没走通：原因、逐句的事实、补救的去处；能重试的给「重试」并说清会不会再计费。 */
export function DubProblemAlert({
  videoId,
  problem,
  speakerNames,
  flush = false,
}: {
  videoId: Id;
  problem: DubProblem;
  speakerNames: ReadonlyMap<string, string>;
  flush?: boolean;
}) {
  const go = useShell((s) => s.go);
  const busy = useDubRun((s) => !!s.runs[videoId]);
  const library = useVoices((s) => s.voices);
  const f = problem.facts;
  const retryNote = problem.retry ? retryNoteText(problem.retry.note) : null;
  return (
    <div className={alertBox({ isFlush: flush })}>
      <InlineAlert variant={VARIANT[problem.kind]}>
        <Heading>{problem.title}</Heading>
        <Content>
          {problem.message ? <div>{problem.message}</div> : null}
          {f && f.synthesized !== null && f.remaining !== null ? <div className={alertNote}>{C.stoppedAt(f.synthesized, f.remaining)}</div> : null}
          {f?.failed.length ? (
            <div className={group}>
              <div className={groupHead}>{C.failedUnits(f.failed.length)}</div>
              <ul className={list}>
                {f.failed.slice(0, 5).map((u) => (
                  <li key={u.unitId}>{u.message || u.code}</li>
                ))}
                {f.failed.length > 5 ? <li className={muted}>…</li> : null}
              </ul>
            </div>
          ) : null}
          {f?.unavailable.length ? (
            <div className={group}>
              <div className={groupHead}>{C.voiceFailedHead}</div>
              <VoiceFailureList rows={f.unavailable} names={speakerNames} library={library} />
            </div>
          ) : null}
          {retryNote ? <div className={alertNote}>{retryNote}</div> : null}
          {problem.retry ? <div className={alertNote}>{C.retryFrozen}</div> : null}
          <div className={alertActions}>
            {problem.retry ? (
              <Button size="S" variant="accent" isDisabled={busy} onPress={() => void retryDub(videoId)}>
                {C.retry}
              </Button>
            ) : null}
            {problem.remedy ? (
              <Button size="S" variant="secondary" onPress={() => go(problem.remedy!.target)}>
                {problem.remedy.label}
              </Button>
            ) : null}
            <Button size="S" variant="secondary" fillStyle="outline" onPress={() => dismissDubProblem(videoId)}>
              {C.dismiss}
            </Button>
          </div>
        </Content>
      </InlineAlert>
    </div>
  );
}

/**
 * 收据：如实列出摘要（放上几句、各句去向、说话人用的音色、音色不可用的句子、合成调用、译文、分离与原声、告警），
 * 留一个「撤销这组配音」。撤不了那一笔、退回部分撤销时写明留下了什么。
 */
export function DubReceiptCard({
  videoId,
  receipt,
  speakerNames,
  flush = false,
}: {
  videoId: Id;
  receipt: DubReceipt;
  speakerNames: ReadonlyMap<string, string>;
  flush?: boolean;
}) {
  const library = useVoices((s) => s.voices);
  const labels = useProviderLabels();
  const { summary } = receipt;
  const language = langName(summary.language);
  const units = dubUnitRows(summary);
  const unavailable = voiceFailures(summary.voiceUnavailableUnits);
  const s = summary.synthesis;
  const glossary = summary.glossary?.entries.length ?? 0;
  return (
    <div className={alertBox({ isFlush: flush })}>
      <InlineAlert variant={receipt.undone ? 'neutral' : 'positive'}>
        <Heading>{receipt.undone ? C.undone : C.doneTitle(language)}</Heading>
        <Content>
          {receipt.undone === 'partial' ? <div>{C.undonePartial}</div> : null}
          <div>{C.placed(summary.units.placed, summary.units.total)}</div>
          {units.length ? (
            <div className={group}>
              <div className={groupHead}>{C.fitHead}</div>
              <ul className={list}>
                {units.map((row) => (
                  <li key={row.key} className={row.placed ? undefined : muted}>
                    {row.label} · {row.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.speakers.length ? (
            <div className={group}>
              <div className={groupHead}>{C.speakersHead}</div>
              <ul className={list}>
                {summary.speakers.map((sp) => (
                  <li key={`${sp.speakerId ?? ''}|${sp.voice}`} className={sp.available ? undefined : muted}>
                    {speakerLabel(sp.speakerId, speakerNames)} · {voiceName(sp.voice, null, library)} · {DUB_SPEAKER_SOURCE[sp.voiceSource]} ·{' '}
                    {C.speakerUnits(sp.units)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {unavailable.length ? (
            <div className={group}>
              <div className={groupHead}>{C.voiceFailedHead}</div>
              <VoiceFailureList rows={unavailable} names={speakerNames} library={library} />
              {receipt.undone ? null : <div className={alertNote}>{C.voiceFailedFix}</div>}
            </div>
          ) : null}
          <div className={alertNote}>
            {recipientName(s.providerId, labels)} · {s.modelId} · {C.synthesisLine(s.calls, s.retries, s.failures, s.reused)}
          </div>
          <div className={alertNote}>
            {summary.translation.created ? C.translationCreated : C.translationUsed}
            {glossary ? ` · ${C.glossaryUsed(glossary)}` : ''}
          </div>
          <div className={alertNote}>
            {separationText(summary.separation)} · {originalAudioText(summary.originalAudio, receipt.duckDb)}
          </div>
          {receipt.warnings.length ? (
            <div className={group}>
              <div className={groupHead}>{C.warnings}</div>
              <ul className={list}>
                {receipt.warnings.map((w) => (
                  <li key={w.code}>
                    {w.title}
                    {w.detail ? <span className={muted}> · {w.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={alertActions}>
            {receipt.undone ? null : (
              <Button size="S" variant="secondary" isPending={receipt.undoing} onPress={() => void undoDub(videoId)}>
                {C.undo}
              </Button>
            )}
            <Button size="S" variant="secondary" fillStyle="outline" isDisabled={receipt.undoing} onPress={() => dismissDubReceipt(videoId)}>
              {C.close}
            </Button>
          </div>
        </Content>
      </InlineAlert>
    </div>
  );
}

/** 这个视频的询问、问题与收据（同一时间通常只有一样）。`flush`：放进已经有内边距的滚动区。 */
export function DubNotices({
  videoId,
  videoName,
  speakerNames,
  flush = false,
}: {
  videoId: Id;
  videoName: string | null;
  speakerNames: ReadonlyMap<string, string>;
  flush?: boolean;
}) {
  const ask = useDubRun((s) => s.asks[videoId] ?? null);
  const problem = useDubRun((s) => s.problems[videoId] ?? null);
  const receipt = useDubRun((s) => s.receipts[videoId] ?? null);
  return (
    <>
      {ask ? <DubAskCard videoId={videoId} ask={ask} videoName={videoName} flush={flush} /> : null}
      {problem ? <DubProblemAlert videoId={videoId} problem={problem} speakerNames={speakerNames} flush={flush} /> : null}
      {receipt ? <DubReceiptCard videoId={videoId} receipt={receipt} speakerNames={speakerNames} flush={flush} /> : null}
    </>
  );
}

/** 这个视频的配音状态（别处挂进度用，比如工具页里的列表）：运行态头，加询问、问题、收据。 */
export function DubStatus({ videoId, videoName, speakerNames }: { videoId: Id; videoName: string | null; speakerNames: ReadonlyMap<string, string> }) {
  const live = useDubLive(videoId);
  return (
    <>
      {live ? <DubRunHead live={live} /> : null}
      <DubNotices videoId={videoId} videoName={videoName} speakerNames={speakerNames} />
    </>
  );
}
