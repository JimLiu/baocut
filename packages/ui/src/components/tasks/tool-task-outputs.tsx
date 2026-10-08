import type { ReactNode } from 'react';
import type { JobRecord } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { Remedy } from '../../model/task-facts.ts';
import type { Rerun } from '../../model/tool-rerun.ts';
import { outputsDir } from '../../model/tool-outputs.ts';
import { useShell } from '../../state/shell-store.ts';
import { ToolOutputs, useJobOutputs } from '../tools/tool-outputs.tsx';
import { ENTRY_TOOL_COPY } from '../tools/tools-copy.ts';
import { goRerun } from '../tools/video-tool-parts.tsx';

/*
 * 后台任务详情里工具任务的结果与「重试 / 再做一次」（产品设计 §2.7「进度与失败」；设计稿 page-tasks-outputs.jsx）：
 * 直接任务与文件到文件的流程列出产物与保存位置，操作与工具结果页相同；直接任务失败时把原因写在「重试」上面，
 * 「重试」回到参数已经填好的工具页（直接任务没有就地重试的方法）。
 */

const box = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 });
const errorRow = style({ display: 'flex', alignItems: 'start', gap: 8, font: 'ui', color: 'negative', overflowWrap: 'anywhere' });
const errorIcon = style({ display: 'flex', flexShrink: 0, marginTop: 2, color: 'red-900', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const hint = style({ font: 'ui-sm', color: 'gray-600' });
const actions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
// ToolOutputs 自带「产物 · 保存在…」标题，这里只留出与上一段的间距。
const outputs = style({ marginTop: 28 });

/** 「重试 / 再做一次」：失败时原因写在上面，配置问题另给去处。 */
export function ToolTaskRerun({ job, rerun, error, remedy }: { job: JobRecord; rerun: Rerun; error: string | null; remedy: Remedy | null }) {
  const go = useShell((s) => s.go);
  return (
    <div className={box}>
      {error ? (
        <span className={errorRow}>
          <span className={errorIcon} aria-hidden>
            <AlertTriangle />
          </span>
          <span>{remedy ? `${error} ${remedy.hint}` : error}</span>
        </span>
      ) : null}
      <div className={actions}>
        <Button variant={error ? 'accent' : 'secondary'} size="S" onPress={() => goRerun(rerun, job.jobId)}>
          {rerun.label}
        </Button>
        {remedy ? (
          <Button variant="secondary" size="S" onPress={() => go(remedy.target)}>
            {remedy.label}
          </Button>
        ) : null}
        <span className={hint}>{ENTRY_TOOL_COPY.rerunHint}</span>
      </div>
    </div>
  );
}

/** 工具任务发布进 Space 的产物；还没列进 Space（或不发布产物）时画 `fallback`（任务结果里的文件）。 */
export function ToolTaskOutputs({ job, fallback }: { job: JobRecord; fallback: ReactNode }) {
  const entries = useJobOutputs([job.jobId]);
  if (!entries.length) return <>{fallback}</>;
  return (
    <div className={outputs}>
      <ToolOutputs entries={entries} saveDir={outputsDir(entries)} />
    </div>
  );
}
