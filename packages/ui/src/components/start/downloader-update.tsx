import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ExternalToolUpdatePlan, JobRecord } from '@baocut/protocol';
import { ActionButton, Content, Heading, InlineAlert, ProgressBar, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Play from '@react-spectrum/s2/icons/Play';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { manualUpdateCommands, updateLog, updateSectionCopy, updateSummary } from '../../model/tool-update.ts';
import { isJobLive } from '../../state/jobs-store.ts';
import { copyText } from '../settings/agent-command-block.tsx';
import { ST } from './start-copy.ts';
import { jobErrorText } from '../../model/localized-text.ts';

/**
 * 下载工具卡片里的「更新」一节（产品设计 §2.7；设计稿 tool-link.jsx 的 `UpdateSection`）：按探测出的安装方式给一行命令，
 * 右边是执行（三角）与复制。看到的就是要执行的那一条，点执行即执行、不再弹确认；执行中三角换成停止，输出显示在命令下面。
 * 判断不了安装方式时按 Runtime 所在主机列常用命令（Windows 四条、其他系统三条），要管理员权限时给 Runtime 写好的那条
 * （macOS 与 Linux 上带 `sudo`），都只能复制。状态与动作由卡片交进来。
 */

/** 卡片里这一次更新的状态（`useDownloader` 的 `update`）。 */
export interface DownloaderUpdateRun {
  jobId: string;
  /** 更新前的版本（点执行时记下的，或任务记录里的）。 */
  before: string | null;
  /** 输出框展开着。 */
  open: boolean;
  /** 任务结束、重新检测完了：此时才说结果，免得版本还没刷新时先说「已是最新」。 */
  settled: boolean;
  after: string | null;
}

export interface DownloaderUpdateProps {
  plan: ExternalToolUpdatePlan | null;
  /** Runtime 所在主机的平台（状态里的 `platform`）：判断不了安装方式时按它列常用命令。 */
  platform: string | null;
  run: DownloaderUpdateRun | null;
  job: JobRecord | null;
  /** 正在提交（点了执行、Runtime 还没回话）。 */
  busy: boolean;
  onRun: (plan: ExternalToolUpdatePlan) => void;
  onStop: (jobId: string) => void;
  onToggle: () => void;
  onClose: () => void;
}

const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 4,
  paddingTop: 12,
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-300',
});
const group = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const label = style({ font: 'ui-xs', color: 'gray-600' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-700' });
const row = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, paddingStart: 12, paddingEnd: 4, paddingY: 4, borderRadius: 'lg', backgroundColor: 'gray-100' });
const code = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const log = style({
  boxSizing: 'border-box',
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  font: 'code-xs',
  color: 'gray-800',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
const actions = style({ display: 'flex', alignItems: 'center', gap: 8 });

/** 只有图标的按钮：名字在 `aria-label` 与提示里。 */
function IconAction({ name, onPress, isDisabled, isPending, children }: { name: string; onPress: () => void; isDisabled?: boolean; isPending?: boolean; children: ReactNode }) {
  return (
    <TooltipTrigger delay={400}>
      <ActionButton isQuiet size="S" aria-label={name} isDisabled={isDisabled} isPending={isPending} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{name}</Tooltip>
    </TooltipTrigger>
  );
}

/** 一行命令：等宽、可选中；能代为执行的多一颗执行（执行中换成停止），总有复制。 */
function CommandRow({ command, runner }: { command: string; runner?: { running: boolean; canStop: boolean; busy: boolean; onRun: () => void; onStop: () => void } }) {
  return (
    <div className={row}>
      <code className={code}>{command}</code>
      {runner ? (
        runner.running ? (
          <IconAction name={ST.update.stop} isDisabled={!runner.canStop} onPress={runner.onStop}>
            <StopProcessing />
          </IconAction>
        ) : (
          <IconAction name={ST.update.run} isPending={runner.busy} onPress={runner.onRun}>
            <Play />
          </IconAction>
        )
      ) : null}
      <IconAction name={ST.update.copy} onPress={() => void copyText(command, ST.update.command)}>
        <Copy />
      </IconAction>
    </div>
  );
}

/** 命令下面的输出：执行中逐行追加并跟到最后（用户往上翻着看时不抢滚动条）；结束后一句结果，输出可收起。 */
function UpdateOutput({ run, job, onToggle, onClose }: { run: DownloaderUpdateRun; job: JobRecord | null; onToggle: () => void; onClose: () => void }) {
  const live = !job || isJobLive(job);
  const running = live || !run.settled;
  const text = updateLog(job?.command, job?.state ?? null, live);
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, run.open]);
  const sum =
    running || !job
      ? null
      : updateSummary({ state: job.state, exitCode: job.command?.exitCode ?? null, error: jobErrorText(job.error) ?? null, before: run.before, after: run.after });
  return (
    <>
      {running ? (
        <ProgressBar aria-label={ST.update.updating} size="S" isIndeterminate />
      ) : sum ? (
        <InlineAlert variant={sum.tone === 'neutral' ? 'informative' : sum.tone}>
          <Heading>{sum.title}</Heading>
          {sum.body ? <Content>{sum.body}</Content> : null}
        </InlineAlert>
      ) : null}
      {running || run.open ? (
        <pre
          ref={ref}
          className={log}
          role="log"
          aria-label={ST.update.output}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          }}>
          {text}
        </pre>
      ) : null}
      {running ? null : (
        <div className={actions}>
          <ActionButton size="S" isQuiet aria-expanded={run.open} onPress={onToggle}>
            <Text>{run.open ? ST.update.hideOutput : ST.update.showOutput}</Text>
          </ActionButton>
          <ActionButton size="S" isQuiet onPress={onClose}>
            <Text>{ST.update.close}</Text>
          </ActionButton>
        </div>
      )}
    </>
  );
}

export function DownloaderUpdateSection({ plan, platform, run, job, busy, onRun, onStop, onToggle, onClose }: DownloaderUpdateProps) {
  const copy = updateSectionCopy(plan);
  const live = !!run && (!job || isJobLive(job));
  const running = !!run && (live || !run.settled);
  return (
    <div className={section} role="group" aria-label={ST.update.section}>
      <span className={label}>{copy.label}</span>
      {plan ? (
        <CommandRow
          command={plan.command}
          runner={plan.runnable ? { running, canStop: live && !!job, busy, onRun: () => onRun(plan), onStop: () => run && onStop(run.jobId) } : undefined}
        />
      ) : (
        manualUpdateCommands(platform).map((m) => (
          <div key={m.label} className={group}>
            <span className={label}>{m.label}</span>
            <CommandRow command={m.command} />
          </div>
        ))
      )}
      {copy.hint ? <p className={hint}>{copy.hint}</p> : null}
      {run ? <UpdateOutput run={run} job={job} onToggle={onToggle} onClose={onClose} /> : null}
    </div>
  );
}
