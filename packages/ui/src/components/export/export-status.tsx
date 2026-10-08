import { useState, type ReactNode } from 'react';
import type { JobRecord } from '@baocut/protocol';
import { ActionButton, Button, Content, Heading, InlineAlert, ProgressBar, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import CloseCircle from '@react-spectrum/s2/icons/CloseCircle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  cancelledLine,
  cancelPending,
  exportDir,
  exportDoneLine,
  exportOutputs,
  exportPhaseLabel,
  exportPlannedFiles,
  exportProgressLine,
  exportSpeedParts,
  exportTitle,
  exportView,
  exportWarnings,
  type ExportOutputFact,
} from '../../model/export-job.ts';
import { explainExportError } from '../../model/export-rejection.ts';
import { exportOtherWarnings } from '../../model/font-library.ts';
import { jobPercent } from '../../model/task-list.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useExportSpeed } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { ExportFontFallbacks, useExportFontPhase } from './export-fonts.tsx';
import { Actions, Note, ProblemAlert, Sec, TextLink } from './export-parts.tsx';
import { RejectedAlert, RemedyButtons } from './export-remedy.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';

/**
 * 弹层盯着的那一次导出（设计稿 export.jsx 的运行 / 完成 / 取消态）：读 jobs-store 里的任务记录；速度与剩余时间按最近几秒的进度推算
 * （`useExportSpeed`），算不出时不写。
 * 关掉弹层不会停下导出；取消要先确认一句，开始保存文件之后停不下来（Runtime 只在保存前检查取消）。
 */

const head = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 });
const headText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const headTitle = style({ margin: 0, font: 'title', color: 'gray-900' });
const headSub = style({ font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const bar = style({ marginTop: 16 });
const stats = style({ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 2, marginTop: 8, font: 'ui-sm', color: 'gray-700' });
const pctText = style({ font: 'code-sm', fontWeight: 'bold', color: 'gray-900' });
const speedText = style({ fontVariantNumeric: 'tabular-nums' });
const confirm = style({ marginTop: 16 });
const confirmActs = style({ display: 'flex', justifyContent: 'end', gap: 8, marginTop: 8 });
const list = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, marginTop: 12, padding: 0, listStyleType: 'none' });
const outRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const outText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const outName = style({ font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const outMeta = style({ font: 'ui-xs', color: 'gray-600' });
const warnList = style({ margin: 0, paddingStart: 16, font: 'ui-xs', color: 'gray-700', overflowWrap: 'anywhere' });
const okIcon = iconStyle({ size: 'XL', color: 'positive' });
const stopIcon = iconStyle({ size: 'XL', color: 'neutral' });
const failIcon = iconStyle({ size: 'XL', color: 'notice' });

export function ExportJobView({
  job,
  env,
  submitter,
  onReset,
  onClose,
}: {
  job: JobRecord;
  env: ExportEnv;
  submitter: ExportSubmit;
  /** 回到设置页（重新设置 / 再导一份）。 */
  onReset: () => void;
  onClose: () => void;
}) {
  switch (exportView(job)) {
    case 'run':
      return <ExportRunning job={job} onClose={onClose} />;
    case 'done':
      return <ExportDone job={job} onReset={onReset} onClose={onClose} />;
    case 'cancelled':
      return <ExportCancelled job={job} onReset={onReset} onClose={onClose} />;
    case 'interrupted':
      return <ExportInterrupted job={job} env={env} submitter={submitter} onReset={onReset} />;
    case 'failed':
      return <ExportFailed job={job} env={env} submitter={submitter} onReset={onReset} />;
  }
}

function Head({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: ReactNode }) {
  return (
    <div className={head}>
      {icon}
      <div className={headText}>
        <h3 className={headTitle}>{title}</h3>
        {sub ? <span className={headSub}>{sub}</span> : null}
      </div>
    </div>
  );
}

function plannedLine(job: JobRecord): string {
  const files = exportPlannedFiles(job);
  if (!files.length) return job.export ? exportTitle(job.export.settings) : '';
  return files.length === 1 ? files[0]! : EXPORT_COPY.plannedFiles(files[0]!, files.length);
}

/** 运行态：进度条与百分比只读 Runtime 报的进度；没有总量时是不定进度。渲染时跟着 fps 与预计剩余时间。 */
function ExportRunning({ job, onClose }: { job: JobRecord; onClose: () => void }) {
  const runtime = useRuntime();
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pending = cancelPending(job) || cancelling;
  const pct = job.state === 'running' ? jobPercent(job) : null;
  // 下载字体时阶段里已经念了族与百分比，不再念字节。
  const fontPhase = useExportFontPhase(job);
  const progress = fontPhase ? null : exportProgressLine(job);
  // 速度只在渲染时有（`export-speed.ts`）；下载字体时阶段里已经念了进度，不再写。
  const speed = exportSpeedParts(useExportSpeed(fontPhase ? null : job.jobId));
  const title = job.state === 'queued' ? EXPORT_COPY.queued : pending ? EXPORT_COPY.cancelling : EXPORT_COPY.running;

  const cancel = async () => {
    setAsking(false);
    setCancelling(true);
    try {
      await runtime.cancelJob(job.jobId);
    } catch (error) {
      setCancelling(false);
      ToastQueue.negative(EXPORT_COPY.cancelFailed((error as Error).message), { timeout: 5000 });
    }
  };

  return (
    <>
      <Head title={title} sub={plannedLine(job)} />
      <div className={bar}>
        <ProgressBar aria-label={title} isIndeterminate={pct == null} value={pct ?? undefined} />
      </div>
      <div className={stats}>
        {pct != null ? <span className={pctText}>{pct}%</span> : null}
        <span>{fontPhase ?? exportPhaseLabel(job)}</span>
        {progress ? <span>{progress}</span> : null}
        {speed.map((part) => (
          <span key={part} className={speedText}>
            {part}
          </span>
        ))}
      </div>
      <Note>
        {EXPORT_COPY.keepsRunning}{' '}
        <TextLink
          onPress={() => {
            onClose();
            useShell.getState().go({ tab: 'tasks', taskId: job.jobId });
          }}>
          {EXPORT_COPY.goTasks}
        </TextLink>
      </Note>
      {asking ? (
        <div className={confirm}>
          <InlineAlert variant="notice">
            <Heading>{EXPORT_COPY.cancelConfirm}</Heading>
            <Content>
              {EXPORT_COPY.cancelConfirmBody}
              <div className={confirmActs}>
                <Button variant="secondary" size="S" onPress={() => setAsking(false)}>
                  {EXPORT_COPY.keepExporting}
                </Button>
                <Button variant="negative" size="S" onPress={() => void cancel()}>
                  {EXPORT_COPY.cancelExport}
                </Button>
              </div>
            </Content>
          </InlineAlert>
        </div>
      ) : (
        <Actions>
          <Button variant="negative" fillStyle="outline" isDisabled={pending} onPress={() => setAsking(true)}>
            {pending ? EXPORT_COPY.cancelling : EXPORT_COPY.cancelExport}
          </Button>
        </Actions>
      )}
    </>
  );
}

/** 已发布的文件：文件名取实际路径，一行一个，可以在文件夹中显示。 */
function Outputs({ outputs }: { outputs: readonly ExportOutputFact[] }) {
  const runtime = useRuntime();
  if (!outputs.length) return null;
  return (
    <ul className={list}>
      {outputs.map((o) => (
        <li key={o.key} className={outRow}>
          <span className={outText}>
            <span className={outName}>{o.name}</span>
            <span className={outMeta}>{o.meta}</span>
          </span>
          {o.path && outputs.length > 1 ? (
            <ActionButton isQuiet size="S" onPress={() => void runtime.host.revealPath(o.path!)}>
              {EXPORT_COPY.reveal}
            </ActionButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** 导出时记下的提醒：跳过的内容、没写进工程的对象、响度测不出……逐条照 Runtime 的原话列。 */
function Warnings({ job }: { job: JobRecord }) {
  // 字体用回退代替的那几条单独列在上面（ExportFontFallbacks），内核对同一个族的缺字体提示不再重复。
  const warnings = exportWarnings({ warnings: exportOtherWarnings(job.warnings) });
  if (!warnings.length) return null;
  return (
    <>
      <Sec>{EXPORT_COPY.warnings}</Sec>
      <ul className={warnList}>
        {warnings.slice(0, 12).map((w) => (
          <li key={w}>{w}</li>
        ))}
        {warnings.length > 12 ? <li>{EXPORT_COPY.moreWarnings(warnings.length - 12)}</li> : null}
      </ul>
    </>
  );
}

function RevealButton({ job }: { job: JobRecord }) {
  const runtime = useRuntime();
  const target = exportOutputs(job)[0]?.path ?? exportDir(job);
  if (!target) return null;
  return (
    <Button variant="secondary" onPress={() => void runtime.host.revealPath(target)}>
      {EXPORT_COPY.reveal}
    </Button>
  );
}

function ExportDone({ job, onReset, onClose }: { job: JobRecord; onReset: () => void; onClose: () => void }) {
  const outputs = exportOutputs(job);
  return (
    <>
      <Head icon={<CheckmarkCircle styles={okIcon} data-bc-icons="own" />} title={EXPORT_COPY.exported} sub={exportDoneLine(job)} />
      <Outputs outputs={outputs} />
      <ExportFontFallbacks job={job} />
      <Warnings job={job} />
      <Actions>
        <Button variant="secondary" fillStyle="outline" onPress={onReset}>
          {EXPORT_COPY.again}
        </Button>
        <RevealButton job={job} />
        <Button variant="accent" onPress={onClose}>
          {EXPORT_COPY.done}
        </Button>
      </Actions>
    </>
  );
}

function ExportCancelled({ job, onReset, onClose }: { job: JobRecord; onReset: () => void; onClose: () => void }) {
  const outputs = exportOutputs(job);
  return (
    <>
      <Head icon={<CloseCircle styles={stopIcon} data-bc-icons="own" />} title={EXPORT_COPY.cancelled} sub={cancelledLine(job)} />
      <Outputs outputs={outputs} />
      <Actions>
        <Button variant="secondary" fillStyle="outline" onPress={onClose}>
          {EXPORT_COPY.close}
        </Button>
        <Button variant="accent" onPress={onReset}>
          {EXPORT_COPY.resetup}
        </Button>
      </Actions>
    </>
  );
}

/** Runtime 停止或重启时还没做完：不会续跑，照原样再导一次或回去改设置。 */
function ExportInterrupted({ job, env, submitter, onReset }: { job: JobRecord; env: ExportEnv; submitter: ExportSubmit; onReset: () => void }) {
  const settings = job.export?.settings ?? null;
  return (
    <>
      <Head
        icon={<AlertTriangle styles={failIcon} data-bc-icons="own" />}
        title={EXPORT_COPY.interrupted}
        sub={EXPORT_COPY.interruptedBody}
      />
      <RejectedAlert problem={submitter.problem} settings={submitter.rejected} videoId={env.videoId} busy={submitter.busy} onSubmit={(s, dir) => void submitter.submit(s, dir)} />
      <Actions>
        <Button variant="secondary" fillStyle="outline" onPress={onReset}>
          {EXPORT_COPY.resetup}
        </Button>
        {settings ? (
          <Button variant="accent" isPending={submitter.busy} isDisabled={!env.ready} onPress={() => void submitter.submit(settings)}>
            {EXPORT_COPY.retry}
          </Button>
        ) : null}
      </Actions>
    </>
  );
}

/**
 * 失败：Runtime 的原话与逐项清单（失败码见 export-service.ts 的 TaskFailure），只发布了一部分时列出已经保存的文件；
 * 能直接做的补救（换个位置）放在提醒里，或照原样再导一次。
 */
function ExportFailed({ job, env, submitter, onReset }: { job: JobRecord; env: ExportEnv; submitter: ExportSubmit; onReset: () => void }) {
  const settings = job.export?.settings ?? null;
  const problem = explainExportError(job.error, { kind: settings?.kind ?? 'video', stage: 'failed', documents: env.documents });
  const outputs = exportOutputs(job);
  return (
    <>
      <ProblemAlert
        problem={problem}
        actions={
          settings && problem.remedy ? (
            <RemedyButtons problem={problem} settings={settings} videoId={env.videoId} busy={submitter.busy} onSubmit={(s, dir) => void submitter.submit(s, dir)} />
          ) : null
        }
      />
      {outputs.length ? (
        <>
          <Sec>{EXPORT_COPY.partial}</Sec>
          <Outputs outputs={outputs} />
        </>
      ) : null}
      <Warnings job={job} />
      <RejectedAlert problem={submitter.problem} settings={submitter.rejected} videoId={env.videoId} busy={submitter.busy} onSubmit={(s, dir) => void submitter.submit(s, dir)} />
      <Actions>
        <Button variant="secondary" fillStyle="outline" onPress={onReset}>
          {EXPORT_COPY.resetup}
        </Button>
        {settings ? (
          <Button variant="accent" isPending={submitter.busy} isDisabled={!env.ready} onPress={() => void submitter.submit(settings)}>
            {EXPORT_COPY.retry}
          </Button>
        ) : null}
      </Actions>
    </>
  );
}
