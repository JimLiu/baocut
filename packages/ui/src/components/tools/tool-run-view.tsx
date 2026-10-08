import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FileTarget, GrantRequestItem, Id, JobRecord, SpaceEntry } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Content,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  ProgressBar,
  Radio,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ListBox, ListBoxItem } from 'react-aria-components';
import { linkIssue } from '../../model/link-import.ts';
import { DownloaderCard, useDownloaderTool } from '../start/downloader-card.tsx';
import { inputOptions, toolById, type ToolId, type ToolSourceKind, type VideoToolId } from '../../model/tool-catalog.ts';
import {
  ambiguousAssets,
  fallbackTitle,
  grantLines,
  opensMovie,
  pct,
  phase,
  providerLabels,
  resultLines,
  resultVideoId,
  runInput,
  runOpts,
  runsOf,
  runView,
  stepNote,
  toolOfJob,
  transcriptSwitchOf,
  withAsset,
  type RunMeta,
  type RunStep,
  type RunView,
} from '../../model/tool-runs.ts';
import { CHANGE_COPY } from '../../copy.ts';
import { videoTargetOf } from '../../model/space.ts';
import { outputsDir } from '../../model/tool-outputs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { sameTarget } from '../../runtime/video-controller.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { setAiToolPage } from '../editor/ai-tools-nav.ts';
import { undoInBackground } from '../thread/change-undo.ts';
import { diarizeStepOf } from '../../model/transcribe-speakers.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { EmptyCard } from '../models/model-parts.tsx';
import { TOOL_ICON } from './tool-icon.tsx';
import { ToolOutputs, useJobOutputs } from './tool-outputs.tsx';
import { detail, SideHead, ToolPage, Workbench } from './tool-parts.tsx';
import { GRANT_COPY, LINK_TOOL_COPY, PROJECT_COPY, RECORD_COPY, RETRANSCRIBE_COPY, RUN_COPY, SOURCE_COPY } from './tools-copy.ts';
import { useCancelJob } from './use-tool-records.ts';
import { useRunRetry, useToolStart, useVideoTools } from './use-video-tools.ts';

/*
 * 视频工具共用的几块（产品设计 §2.7，设计稿 tool-run-view.jsx 与 tools.css `.tsteps` `.tgrant` `.trun*` `.trec`）：
 * 步骤进度、当场授权卡、来源切换、项目选择、运行与结果页、本工具的运行记录，以及把它们拼起来的页面骨架。
 * 运行的步骤、进度、失败停在哪一步都读 `jobs` 主题里的流程父任务（model/tool-runs.ts）。
 */

// ---- 步骤 ----

const steps = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none' });
const stepRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  font: 'ui',
  color: { default: 'gray-600', isDone: 'gray-800', isRunning: 'gray-900', isFailed: 'red-1000' },
  backgroundColor: { default: 'transparent', isRunning: 'blue-100', isFailed: 'red-100' },
});
const stepMark = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: 24,
  height: 24,
  borderRadius: 'full',
  font: 'ui-xs',
  backgroundColor: { default: 'gray-100', isDone: 'green-100', isRunning: 'blue-900', isFailed: 'red-900' },
  color: { default: 'gray-700', isDone: 'green-1000', isRunning: 'gray-25', isFailed: 'gray-25' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const stepLabel = style({ flexGrow: 1, minWidth: 0 });
const stepState = style({ flexShrink: 0, font: 'ui-xs' });

/** 步骤表：做完的打勾、在跑的写百分比、停住的标红，没到的只写序号。跳过的步骤不列（model/tool-runs.ts）。 */
export function ToolSteps({ list }: { list: readonly RunStep[] }) {
  return (
    <ol className={steps} aria-label={RUN_COPY.steps}>
      {list.map((s, i) => {
        const flags = { isDone: s.status === 'done', isRunning: s.status === 'running', isFailed: s.status === 'failed' };
        return (
          <li key={s.name} className={stepRow(flags)}>
            <span className={stepMark(flags)} aria-hidden>
              {s.status === 'done' ? <Checkmark /> : s.status === 'failed' ? <AlertTriangle /> : i + 1}
            </span>
            <span className={stepLabel}>{s.label}</span>
            <span className={stepState}>{stepNote(s)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---- 当场授权 ----

const grantBox = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const grantList = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, marginBottom: 8, padding: 0, listStyleType: 'none' });
const grantItem = style({ display: 'flex', flexDirection: 'column', gap: 2 });
const grantActions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });

/**
 * 当场授权（§2.7「授权在当场完成」）：Runtime 拒绝启动时给的待批准项——要发什么、发给谁、预计多少钱；「同意并继续」
 * 逐项发放授权，再用同一次提交重提。`hint`：不想发送时的去处。
 */
export function GrantCard({
  items,
  onAgree,
  busy,
  hint = GRANT_COPY.hintLocal,
}: {
  items: readonly GrantRequestItem[];
  onAgree: () => void;
  busy: boolean;
  hint?: string;
}) {
  const view = useModels((s) => s.capabilities);
  const lines = useMemo(() => grantLines(items, providerLabels(view)), [items, view]);
  return (
    <div className={grantBox} role="group" aria-label={GRANT_COPY.label}>
      <InlineAlert variant="notice">
        <Heading>{GRANT_COPY.title}</Heading>
        <Content>
          <ul className={grantList}>
            {lines.map((l) => (
              <li key={l.key} className={grantItem}>
                <strong>{GRANT_COPY.to(l.recipient)}</strong>
                <span>{GRANT_COPY.what(l.what)}</span>
                <span>{GRANT_COPY.cost(l.cost)}</span>
              </li>
            ))}
          </ul>
          <span className={detail}>{GRANT_COPY.remember}</span>
        </Content>
      </InlineAlert>
      <div className={grantActions}>
        <Button variant="accent" isPending={busy} onPress={onAgree}>
          {GRANT_COPY.agree}
        </Button>
        <span className={detail}>{hint}</span>
      </div>
    </div>
  );
}

// ---- 来源与项目 ----

/** 输入来源切换：选项来自工具目录声明的输入（model/tool-catalog.ts）。 */
export function ToolSourceSwitch<K extends ToolSourceKind>({ tool, value, onChange }: { tool: ToolId; value: K; onChange: (key: K) => void }) {
  const options = inputOptions(tool);
  return (
    <SegmentedControl aria-label={SOURCE_COPY.label} selectedKey={value} onSelectionChange={(key) => onChange(key as K)}>
      {options.map((o) => (
        <SegmentedControlItem key={o.key} id={o.key}>
          {o.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

const field = style({ width: 'full' });

/** 新建的视频放进哪个项目。没有项目时说先建一个。 */
export function ProjectPicker({ value, onChange }: { value: Id | null; onChange: (projectId: Id) => void }) {
  const projects = useDirectory((s) => s.projects);
  if (!projects.length) return <span className={detail}>{PROJECT_COPY.noneBody}</span>;
  return (
    <Picker label={PROJECT_COPY.label} items={projects} selectedKey={value} styles={field} onSelectionChange={(key) => key !== null && onChange(String(key))}>
      {(p) => <PickerItem id={p.id}>{p.name}</PickerItem>}
    </Picker>
  );
}

// ---- 运行页 ----

/** Space 里写着这个视频的条目（「打开编辑」「接着做」用）。 */
export function entryOfVideo(entries: readonly SpaceEntry[], videoId: Id | null): SpaceEntry | null {
  if (!videoId) return null;
  return entries.find((e) => e.kind === 'video' && e.ref && 'videoId' in e.ref && e.ref.videoId === videoId && !e.user.trashedAt) ?? null;
}

/** 一次运行的标题与本机记录：有本机记录时用它，否则从冻结参数推。 */
export function useRunTitle(job: JobRecord): { title: string; meta: RunMeta | null; entry: SpaceEntry | null } {
  const meta = useVideoTools((s) => s.meta[job.jobId] ?? null);
  const entries = useSpace((s) => s.entries);
  const entry = entryOfVideo(entries, resultVideoId(job));
  const tool = toolOfJob(job);
  const title = meta?.title ?? fallbackTitle(job, (tool && toolById(tool)?.name) || RUN_COPY.run, entry?.name ?? null);
  return { title, meta, entry };
}

const runBox = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const runHead = style({ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, minWidth: 0 });
const runTitle = style({ flexGrow: 1, margin: 0, font: 'title', color: 'gray-900', minWidth: 0, overflowWrap: 'anywhere' });
const runPhase = style({ font: 'ui-sm', color: 'gray-700' });
const resultBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const lines = style({ display: 'flex', flexDirection: 'column', gap: '[6px]', margin: 0, padding: 0, listStyleType: 'none', font: 'ui', color: 'gray-900' });
const line = style({ display: 'flex', alignItems: 'start', gap: 8, overflowWrap: 'anywhere', minWidth: 0 });
const lineIcon = style({ display: 'flex', flexShrink: 0, marginTop: 2, color: 'green-1000', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const buttons = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });

/** 一次运行的视图：转录由「说话人区分」区分说话人时单列「识别说话人」一步（model/transcribe-speakers.ts `diarizeStepOf`）。 */
export function useRunView(job: JobRecord): RunView | null {
  const jobs = useJobs((s) => s.jobs);
  const view = useModels((s) => s.capabilities);
  return runView(job, jobs, { diarizeStep: diarizeStepOf(job, jobs, view) });
}

/** 运行与结果页：进度、步骤、失败时从那一步重试；完成后「打开编辑」与能接着做的工具。 */
export function ToolRunView({ job, tool, onBack }: { job: JobRecord; tool: VideoToolId; onBack: () => void }) {
  const go = useShell((s) => s.go);
  const outputs = useJobOutputs([job.jobId]);
  const cancel = useCancelJob();
  const retry = useRunRetry(job.jobId);
  const { title, meta, entry } = useRunTitle(job);
  const downloader = useDownloaderTool(job.pipeline?.name === 'link-import');
  const downloadIssue = job.pipeline?.name === 'link-import' && job.error ? linkIssue(job.error) : null;
  const run = useRunView(job);
  if (!run) return null;
  const done = run.status === 'done';
  const stopped = run.status === 'failed' || run.status === 'cancelled';
  const input = meta?.input ?? runInput(job);
  const opts = meta?.target ? { target: meta.target, transcribe: meta.transcribe } : runOpts(job);
  const ownTool = (toolOfJob(job) ?? tool) as VideoToolId;
  const intoMovie = opensMovie(ownTool, input, opts);
  // 下载时一起转写的视频按转录给下一步（翻译字幕、翻译配音）。
  const fromTool = ownTool === 'link-import' && opts.transcribe ? 'transcribe' : ownTool;
  const assets = ambiguousAssets(job);
  const keepsVideo = run.steps.some((s) => s.name === 'create' && s.status === 'done');

  return (
    <section className={runBox} aria-label={title}>
      <div className={runHead}>
        <h2 className={runTitle}>{title}</h2>
        <span className={runPhase}>
          {phase(run)}
          {run.attempt > 1 ? RUN_COPY.attempt(run.attempt) : ''}
        </span>
      </div>
      <ProgressBar aria-label={RUN_COPY.progress(title)} size="S" value={pct(run)} isIndeterminate={run.status === 'queued'} />
      <ToolSteps list={run.steps} />
      {!done && !stopped ? (
        <div className={buttons}>
          <span className={detail}>{RUN_COPY.background}</span>
          <Button variant="secondary" size="S" onPress={() => cancel(job.jobId)}>
            {RUN_COPY.cancel}
          </Button>
        </div>
      ) : null}
      {stopped && assets ? <AmbiguousAssets job={job} ids={assets} title={title} /> : null}
      {stopped && !assets ? (
        <>
          <InlineAlert variant={run.status === 'failed' ? 'negative' : 'neutral'}>
            <Heading>{phase(run)}</Heading>
            <Content>{run.status === 'failed' ? RUN_COPY.failedBody(run.error ?? RUN_COPY.unknown, keepsVideo) : RUN_COPY.cancelledBody}</Content>
          </InlineAlert>
          {downloadIssue ? <>
            <InlineAlert variant="notice"><Heading>{downloadIssue.title}</Heading><Content>{downloadIssue.body}</Content></InlineAlert>
            <DownloaderCard view={downloader} />
            <ActionButton onPress={onBack}><Text>{LINK_TOOL_COPY.editLink}</Text></ActionButton>
          </> : null}
          {retry.asking ? <GrantCard items={retry.asking} onAgree={retry.agree} busy={retry.busy} /> : null}
          <div className={buttons}>
            <Button variant="accent" isPending={retry.busy && !retry.asking} isDisabled={!!retry.asking} onPress={retry.retry}>
              {RUN_COPY.retry}
            </Button>
          </div>
        </>
      ) : null}
      {done ? (
        <div className={resultBox}>
          <ul className={lines}>
            {resultLines(job, meta, entry?.name ?? null).map((l) => (
              <li key={l} className={line}>
                <span className={lineIcon} aria-hidden>
                  <Checkmark />
                </span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <SwitchActions job={job} entry={entry} />
          {intoMovie && !entry ? <span className={detail}>{RUN_COPY.noVideo}</span> : null}
          <ToolOutputs entries={intoMovie && entry ? [entry, ...outputs] : outputs} fromTool={fromTool} saveDir={intoMovie ? null : outputsDir(outputs)} />
          {!intoMovie && !outputs.length ? <span className={detail}>{RUN_COPY.noOutputs}</span> : null}
        </div>
      ) : null}
      <div className={buttons}>
        <ActionButton isQuiet onPress={onBack}>
          <Text>{done || stopped ? RUN_COPY.again : RUN_COPY.backToForm}</Text>
        </ActionButton>
        <ActionButton isQuiet onPress={() => go({ tab: 'tasks', taskId: job.jobId })}>
          <Text>{RUN_COPY.inTasks}</Text>
        </ActionButton>
      </div>
    </section>
  );
}

/** 编辑器此刻占着这个视频（正在打开或已经开着）：后台撤销完不替它关（同 change-card）。 */
function editorHolds(target: FileTarget, videoId: Id): boolean {
  const video = useVideo.getState().video;
  return video !== null && (video.videoId === videoId || sameTarget(video.target, target));
}

/**
 * 换用了文稿之后（产品设计 §5.11，设计稿 tool-specs.jsx 转录结果的动作）：「刷新过期译文」打开视频、进编辑器的那个工具页；
 * 「撤销」按事务撤销换用那一笔（编辑器开着这个视频时走编辑器，否则在后台打开撤销再关，同变更卡）。
 */
function SwitchActions({ job, entry }: { job: JobRecord; entry: SpaceEntry | null }) {
  const runtime = useRuntime();
  const ready = useVideo((s) => s.video?.status === 'ready' && s.video.videoId === job.pipeline?.summary?.videoId);
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState(false);
  const sw = transcriptSwitchOf(job);
  if (!sw || !entry || (!sw.stale && !sw.transactionId)) return null;
  const target = videoTargetOf(entry);

  const refresh = () => {
    const editor = useEditor.getState();
    editor.attach(sw.videoId);
    setAiToolPage(sw.videoId, { tool: 'stale', preset: null, from: 'subtitle' });
    editor.showPanel('aitools');
    useShell.getState().openVideo(target);
  };

  const undo = async (transaction: Id) => {
    setBusy(true);
    try {
      if (ready) {
        const receipt = await runtime.videos.undo({ transaction });
        if (!receipt) {
          ToastQueue.negative(CHANGE_COPY.undoFailed(useVideo.getState().video?.commandError?.message ?? RUN_COPY.unknown), {
            timeout: 5000,
          });
          return;
        }
        setUndone(true);
        ToastQueue.neutral(CHANGE_COPY.undoneToast, { timeout: 3000 });
        return;
      }
      const result = await undoInBackground({ request: runtime.client.request.bind(runtime.client), editorHolds }, target, transaction);
      setUndone(true);
      ToastQueue.neutral(result.kind === 'undone' ? CHANGE_COPY.undoneToast : CHANGE_COPY.alreadyUndone, { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(CHANGE_COPY.undoFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={buttons}>
      {sw.stale && !undone ? (
        <Button variant="secondary" size="S" onPress={refresh}>
          {RETRANSCRIBE_COPY.refreshStale}
        </Button>
      ) : null}
      {sw.transactionId ? (
        <Button
          variant="secondary"
          size="S"
          isPending={busy}
          isDisabled={undone}
          onPress={() => sw.transactionId && void undo(sw.transactionId)}>
          {undone ? CHANGE_COPY.undone : RETRANSCRIBE_COPY.undo}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 转录停在「视频主轨上有几个素材」（`TRANSCRIBE_ASSET_AMBIGUOUS`）：让用户选一个，带 `assetId` 重新开始（新的一次运行）。
 * 合同只给素材 ID，没有名字。
 */
function AmbiguousAssets({ job, ids, title }: { job: JobRecord; ids: readonly Id[]; title: string }) {
  const [pick, setPick] = useState<Id | null>(ids[0] ?? null);
  const meta = useVideoTools((s) => s.meta[job.jobId] ?? null);
  const key = `asset:${job.jobId}:${pick ?? ''}`;
  const starter = useToolStart('transcribe', key);
  const request = pick ? withAsset(job, pick) : null;
  const start = () => request && starter.start(request, meta ?? { tool: 'transcribe', input: runInput(job), title }, key);
  return (
    <>
      <InlineAlert variant="notice">
        <Heading>{RUN_COPY.ambiguousTitle}</Heading>
        <Content>{RUN_COPY.ambiguousBody}</Content>
      </InlineAlert>
      <RadioGroup aria-label={RUN_COPY.ambiguousTitle} size="S" value={pick ?? ''} onChange={(v) => setPick(v)}>
        {ids.map((id, i) => (
          <Radio key={id} value={id}>
            {RUN_COPY.asset(i + 1, id)}
          </Radio>
        ))}
      </RadioGroup>
      {starter.asking ? <GrantCard items={starter.asking} onAgree={starter.agree} busy={starter.busy} /> : null}
      <div className={buttons}>
        <Button variant="accent" isDisabled={!request || !!starter.asking} isPending={starter.busy && !starter.asking} onPress={start}>
          {RUN_COPY.useAsset}
        </Button>
      </div>
    </>
  );
}

// ---- 运行记录 ----

const recordItem = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400', isCurrent: 'blue-900', isFailed: 'orange-400' },
  backgroundColor: { default: 'gray-50', isCurrent: 'blue-100' },
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  minWidth: 0,
});
const recordName = style({ font: 'title-sm', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const recordPhase = style({ font: 'ui-xs', color: { default: 'gray-600', isFailed: 'orange-1000' } });
const listBox = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const MAX_RUNS = 30;

function RunRecord({ job, current }: { job: JobRecord; current: boolean }) {
  const { title } = useRunTitle(job);
  const run = useRunView(job);
  const failed = run?.status === 'failed';
  return (
    <ListBoxItem id={job.jobId} textValue={title} className={(rp) => recordItem({ ...rp, isCurrent: current, isFailed: failed })}>
      <span className={recordName}>{title}</span>
      {run ? <span className={recordPhase({ isFailed: failed })}>{phase(run)}</span> : null}
      {run?.status === 'running' ? <ProgressBar aria-label={RUN_COPY.progress(title)} size="S" value={pct(run)} /> : null}
    </ListBoxItem>
  );
}

/** 右栏：这个工具的运行记录（新的在前），点一条看它的进度与结果。 */
export function ToolRunList({ tool, current, onOpen }: { tool: VideoToolId; current: Id | null; onOpen: (jobId: Id) => void }) {
  const ready = useJobs((s) => s.ready);
  const jobs = useJobs((s) => s.jobs);
  const runs = useMemo(() => runsOf(jobs, tool), [jobs, tool]);
  const live = runs.filter((j) => j.state === 'running' || j.state === 'queued').length;
  const info = toolById(tool);
  const Icon = TOOL_ICON[info?.icon ?? 'transcript'];
  return (
    <>
      <SideHead title={RUN_COPY.side} live={live ? RECORD_COPY.live(live) : null} count={RECORD_COPY.count(runs.length)} />
      {!ready ? (
        <span className={detail}>{RUN_COPY.loading}</span>
      ) : runs.length ? (
        <>
          <ListBox aria-label={RUN_COPY.side} className={listBox} onAction={(key) => onOpen(String(key))}>
            {runs.slice(0, MAX_RUNS).map((j) => (
              <RunRecord key={j.jobId} job={j} current={j.jobId === current} />
            ))}
          </ListBox>
          {runs.length > MAX_RUNS ? <span className={detail}>{RUN_COPY.olderInTasks(runs.length - MAX_RUNS)}</span> : null}
        </>
      ) : (
        <EmptyCard icon={<Icon />} title={RUN_COPY.empty} body={RUN_COPY.emptyBody} />
      )}
    </>
  );
}

// ---- 页面骨架 ----

const waiting = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8 });

/** 视频工具页的骨架：左边表单或运行页，右边运行记录；看运行页时页头不放提交按钮。 */
export function ToolFrame({
  tool,
  title,
  bar,
  chip,
  onKeyDown,
  children,
}: {
  tool: VideoToolId;
  title: string;
  bar: ReactNode;
  chip?: ReactNode;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const viewing = useVideoTools((s) => s.views[tool] ?? null);
  const setView = useVideoTools((s) => s.setView);
  const job = useJobs((s) => (viewing ? s.jobs.find((j) => j.jobId === viewing) : undefined));
  const back = () => setView(tool, null);
  const main = !viewing ? (
    children
  ) : job ? (
    <ToolRunView job={job} tool={tool} onBack={back} />
  ) : (
    <div className={waiting}>
      <span className={detail} role="status">
        {RUN_COPY.waiting}
      </span>
      <ActionButton isQuiet onPress={back}>
        <Text>{RUN_COPY.backToForm}</Text>
      </ActionButton>
    </div>
  );
  return (
    <ToolPage title={title} bar={viewing ? undefined : bar} chip={viewing ? undefined : chip}>
      <Workbench
        main={main}
        side={<ToolRunList tool={tool} current={viewing} onOpen={(id) => setView(tool, id)} />}
        sideLabel={RUN_COPY.side}
        onKeyDown={viewing ? undefined : onKeyDown}
      />
    </ToolPage>
  );
}
