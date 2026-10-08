import { useEffect, useRef } from 'react';
import type { Id, JobRecord, TextModelInfo } from '@baocut/protocol';
import { Button, Content, Heading, InlineAlert } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { textModelLine } from '../../model/models-text.ts';
import { isVideoTool, type ToolId } from '../../model/tool-catalog.ts';
import type { Rerun } from '../../model/tool-rerun.ts';
import type { ToolModelOption } from '../../model/tools-models.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ModelRow } from './tool-frame.tsx';
import { BarStatus } from './tool-parts.tsx';
import { FORM_COPY, FRAME_COPY, TRANSLATE_COPY } from './tools-copy.ts';
import { invalidateToolStatus } from './use-tool-status.ts';
import { useVideoTools, type ToolPreset } from './use-video-tools.ts';

/*
 * 四个视频工具页的表单零件（设计稿 tool-translate.jsx `TextModelField`、各页的页头按钮与「不覆盖」提示）。
 */

export const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });

/** 第一条按不了的原因；都没有时 null。`undefined`（工具现状还没到）算作「正在读取」。 */
export function firstWhy(block: string | null | undefined, ...reasons: (string | null | false | undefined)[]): string | null {
  if (block === undefined) return FORM_COPY.loading;
  if (block) return block;
  for (const r of reasons) if (r) return r;
  return null;
}

/** 页头：现状一句（按不了时写第一条原因，变橙）与主按钮。 */
export function SubmitBar({ why, label, busy, onPress }: { why: string | null; label: string; busy: boolean; onPress: () => void }) {
  return (
    <>
      <BarStatus text={why ?? FORM_COPY.ready} bad={!!why} />
      <Button variant="accent" isDisabled={!!why} isPending={busy} onPress={onPress}>
        {label}
      </Button>
    </>
  );
}

/** 写进已有视频时的「不覆盖」提示。 */
export function DuplicateAlert({ title, body }: { title: string; body: string }) {
  return (
    <InlineAlert variant="informative">
      <Heading>{title}</Heading>
      <Content>{body}</Content>
    </InlineAlert>
  );
}

/** 文本模型一块（翻译字幕、先翻译再配音）：统一的「模型」一行，在线服务的模型；不能用的列着、写原因，给「去设置」。 */
export function TextModelField({
  options,
  option,
  onChange,
}: {
  options: readonly ToolModelOption<TextModelInfo>[];
  option: ToolModelOption<TextModelInfo> | null;
  onChange: (key: string) => void;
}) {
  const go = useShell((s) => s.go);
  return (
    <ModelRow
      title={TRANSLATE_COPY.model}
      noun={FRAME_COPY.textNoun}
      manage={TRANSLATE_COPY.manageModels}
      local={false}
      onSettings={() => go({ tab: 'models', category: 'llm', page: 'cloud' })}
      options={options}
      selected={option}
      onSelect={(o) => onChange(o.key)}
      factsOf={(o) => textModelLine(o.info)}
    />
  );
}

/** 「接着做」「用工具处理…」带来的 Space 条目：进这个工具时预选它（各页决定怎么填），用过就清掉。 */
export function usePreset(tool: ToolId, apply: (entryId: Id, preset: ToolPreset) => void): void {
  const preset = useVideoTools((s) => s.preset);
  const setPreset = useVideoTools((s) => s.setPreset);
  useEffect(() => {
    if (!preset || preset.tool !== tool) return;
    apply(preset.entryId, preset);
    setPreset(null);
    // 只在带来的视频变了时用一次；`apply` 每次渲染都是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, setPreset, tool]);
}

/**
 * 「再做一次 / 重试」带来的任务：任务在 `jobs` 主题里出现后用它填一次表单，用过就清掉（同 `usePreset`）。
 */
export function useRerun(tool: ToolId, apply: (job: JobRecord) => void): void {
  const rerun = useVideoTools((s) => s.rerun);
  const setRerun = useVideoTools((s) => s.setRerun);
  const job = useJobs((s) => (rerun && rerun.tool === tool ? s.jobs.find((j) => j.jobId === rerun.jobId) : undefined));
  useEffect(() => {
    if (!rerun || rerun.tool !== tool || !job) return;
    apply(job);
    setRerun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun, job, setRerun, tool]);
}

/** 去工具页「再做一次 / 重试」：直接任务与文件转码照参数填好表单，视频工具打开这次运行。 */
export function goRerun(rerun: Rerun, jobId: Id): void {
  const tools = useVideoTools.getState();
  if (rerun.mode === 'view' && isVideoTool(rerun.tool)) tools.setView(rerun.tool, jobId);
  else {
    if (isVideoTool(rerun.tool)) tools.setView(rerun.tool, null);
    tools.setRerun({ tool: rerun.tool, jobId });
  }
  useShell.getState().go({ tab: 'tools', tool: rerun.tool });
}

/** 视频下载工具刚就绪（装好、同意过）：`tools.list` 里从链接导入的现状跟着变，重读一次。 */
export function useRefreshWhenReady(ready: boolean): void {
  const runtime = useRuntime();
  const was = useRef(ready);
  useEffect(() => {
    if (ready && !was.current) invalidateToolStatus(runtime);
    was.current = ready;
  }, [ready, runtime]);
}
