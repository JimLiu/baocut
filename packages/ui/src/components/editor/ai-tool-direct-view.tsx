import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiToolKind, JobRecord, TextModelInfo } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Content,
  Header,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  PickerSection,
  ProgressBar,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { findOption, initialModelKey, modelOptions, parseModelKey, type ToolModelOption } from '../../model/tools-models.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAiToolRunner } from '../../state/ai-tool-runner-store.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { GATE_COPY } from '../tools/tools-copy.ts';
import { ModelGate } from '../tools/tool-model.tsx';
import { needsStructuredOutput } from './ai-tool-direct.ts';
import {
  bindAiToolRun,
  cancelAiTool,
  closeAiToolResult,
  dismissAiToolProblem,
  retryAiTool,
  undoAiTool,
  useAiToolRun,
  type AiToolProblem,
  type AiToolReceipt,
  type AiToolResult,
  type AiToolRun,
  type AiToolRunDeps,
} from './ai-tool-run.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const head = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-900' });
const liveDot = style({
  flexShrink: 0,
  width: 8,
  height: 8,
  borderRadius: 'full',
  backgroundColor: { default: 'blue-800', isQueued: 'gray-400' },
});
const headTitle = style({ flexGrow: 1, minWidth: 0, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const activity = style({ font: 'ui-xs', color: 'gray-600' });
const actions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const alertActions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
/** 模型写的正文：原样（Markdown 源文）、可选中，复制拿走的就是这一份。 */
const output = style({
  margin: 0,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-25',
  font: 'body-sm',
  color: 'gray-900',
  lineHeight: '[1.6]',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
const doneRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-900' });

const runToast: AiToolRunDeps['toast'] = (kind, message) => ToastQueue[kind](message, { timeout: 5000 });

/** 工具页挂上时把运行 store 绑到这条会话上（同 speaker-flow.tsx）。 */
export function useBindAiToolRun(): void {
  const runtime = useRuntime();
  useEffect(
    () =>
      bindAiToolRun({
        runtime: {
          startPipeline: (pipeline, params) => runtime.startPipeline(pipeline, params),
          retryPipeline: (jobId) => runtime.retryPipeline(jobId),
          cancelJob: (jobId) => runtime.cancelJob(jobId),
          videos: runtime.videos,
        },
        toast: runToast,
      }),
    [runtime],
  );
}

export interface DirectModel {
  options: ToolModelOption<TextModelInfo>[];
  selected: ToolModelOption<TextModelInfo> | null;
  select(option: ToolModelOption<TextModelInfo>): void;
  /** 菜单与提示里写的名字。 */
  name: string | null;
  ready: boolean;
  local: boolean;
  ref: { providerId: string; modelId: string } | null;
}

/**
 * 这个工具直接调哪只文本模型：按工具记住的那只（还在菜单里就留着，哪怕现在不能用——页面给门卡），再是文本生成的默认值，
 * 再是第一只能用的。润色与章节要结构化输出，不支持的那几只照列、标原因、不能用。
 */
export function useDirectModel(tool: AiToolKind): DirectModel {
  const view = useModels((s) => s.capabilities);
  const saved = useAiToolRunner((s) => s.models[tool] ?? null);
  const setModel = useAiToolRunner((s) => s.setModel);
  const structured = needsStructuredOutput(tool);
  const options = useMemo(
    () =>
      (view ? modelOptions(view, 'generateText') : []).map((o) =>
        structured && o.usable && o.info.structuredOutput === false ? { ...o, usable: false, why: C.modelNoStructured } : o,
      ),
    [view, structured],
  );
  const selected = findOption(options, initialModelKey(options, saved, view?.generateText.effective ?? null));
  const ref = selected ? parseModelKey(selected.key) : null;
  return {
    options,
    selected,
    select: (option) => setModel(tool, option.key),
    name: selected ? (selected.local ? selected.label : selected.modelId) : null,
    ready: !!selected?.usable,
    local: !!selected?.local,
    ref: ref ? { providerId: ref.providerId, modelId: ref.modelId } : null,
  };
}

function providerGroups(options: readonly ToolModelOption<TextModelInfo>[]) {
  const out: { providerId: string; provider: string; items: ToolModelOption<TextModelInfo>[] }[] = [];
  for (const o of options) {
    const g = out.find((x) => x.providerId === o.providerId);
    if (g) g.items.push(o);
    else out.push({ providerId: o.providerId, provider: o.local ? GATE_COPY.localGroup : o.provider, items: [o] });
  }
  return out;
}

/** 提示词框底栏右边的文本模型选择（原型 tool-prompt.jsx `ToolModelPick`）：按服务商分组，不能用的写原因。 */
export function DirectModelPicker({ model }: { model: DirectModel }) {
  if (!model.options.length) {
    return <span className={note}>{C.modelNone}</span>;
  }
  return (
    <Picker
      aria-label={C.modelPicker}
      size="S"
      isQuiet
      menuWidth={320}
      selectedKey={model.selected?.key ?? null}
      onSelectionChange={(key) => {
        const next = model.options.find((o) => o.key === key);
        if (next) model.select(next);
      }}>
      {providerGroups(model.options).map((g) => (
        <PickerSection key={g.providerId} id={`provider:${g.providerId}`}>
          <Header>
            <Heading>{g.provider}</Heading>
          </Header>
          {g.items.map((o) => {
            const label = o.local ? o.label : o.modelId;
            return (
              <PickerItem key={o.key} id={o.key} textValue={`${o.provider} · ${label}`}>
                <Text slot="label">{label}</Text>
                {o.why ? <Text slot="description">{o.why}</Text> : null}
              </PickerItem>
            );
          })}
        </PickerSection>
      ))}
    </Picker>
  );
}

/** 选中的模型不能用时框下的门卡：去连接、或换用能用的那只（同翻译页）。本机模型去本机模型页。 */
export function DirectModelGate({ model }: { model: DirectModel }) {
  const go = useShell((s) => s.go);
  if (!model.options.length) {
    return (
      <InlineAlert variant="notice">
        <Heading>{C.noTextModel}</Heading>
        <Content>
          {C.modelGateBody}
          <div className={alertActions}>
            <Button size="S" variant="accent" onPress={() => go({ tab: 'models', category: 'llm', page: 'cloud' })}>
              {GATE_COPY.goConnect}
            </Button>
          </div>
        </Content>
      </InlineAlert>
    );
  }
  const selected = model.selected;
  if (selected && !selected.usable && (selected.local || selected.connected)) {
    // 连上了但这只用不了（不支持结构化输出、本机模型没装好）：一行原因就够，菜单里能换。
    return <p className={note}>{selected.why}</p>;
  }
  return (
    <ModelGate
      selected={selected}
      options={model.options}
      body={C.modelGateBody}
      onConnect={() => go({ tab: 'models', category: 'llm', page: 'cloud' })}
      onSwitch={(o) => model.select(o)}
    />
  );
}

// ---- 运行 ----

export function DirectRunView({ run }: { run: AiToolRun }) {
  const jobs = useJobs((s) => s.jobs);
  const job: JobRecord | null = run.jobId ? (jobs.find((j) => j.jobId === run.jobId) ?? null) : null;
  const stale = !!job && !isJobLive(job);
  const submitting = run.status === 'submitting' || !job || stale;
  const queued = !submitting && job.state === 'queued';
  const heading = submitting ? C.runSubmitting : queued ? C.runQueued : C.runRunning(run.model);
  // 润色分批调模型：在跑的那一步报 `units` 进度（第几批）。
  const step = job?.pipeline?.steps.find((s) => s.status === 'running');
  const progress = !submitting && step?.name === 'generate' && job?.progress?.unit === 'units' && job.progress.total ? job.progress : null;
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  return (
    <div className={stack}>
      <div className={head} role="status" aria-live="polite">
        <div className={titleRow}>
          <span className={liveDot({ isQueued: queued })} aria-hidden />
          <span className={headTitle}>{heading}</span>
        </div>
        <ProgressBar size="S" aria-label={heading} isIndeterminate={pct === null} {...(pct === null ? {} : { value: pct })} styles={field} />
        {progress && progress.total ? <span className={activity}>{C.runBatches(Math.min(progress.done + 1, progress.total), progress.total)}</span> : null}
        {job && isJobLive(job) && !stale ? (
          <div className={actions}>
            <Button size="S" variant="secondary" onPress={() => void cancelAiTool(job.jobId)}>
              {C.cancel}
            </Button>
          </div>
        ) : null}
      </div>
      <p className={note}>{C.runNote}</p>
    </div>
  );
}

// ---- 结果 ----

/** 只给结果的工具：正文原样、复制、完成（回到设置态，提示词框还在）。 */
export function DirectResultView({ runKey: key, result, model }: { runKey: string; result: AiToolResult; model: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.summary.text);
    } catch {
      ToastQueue.negative(C.copyFailed, { timeout: 5000 });
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const skipped = result.summary.context.skippedAttachments;
  return (
    <div className={stack}>
      <span className={activity}>{C.resultFrom(model)}</span>
      {result.summary.finishReason === 'length' ? (
        <InlineAlert variant="notice">
          <Content>{C.resultCut}</Content>
        </InlineAlert>
      ) : null}
      <pre className={output}>{result.summary.text}</pre>
      {skipped ? <p className={note}>{C.resultSkipped(skipped)}</p> : null}
      <div className={actions}>
        <Button size="S" variant="accent" onPress={() => void copy()}>
          {copied ? <CheckmarkCircle /> : <Copy />}
          <Text>{copied ? C.copied : C.copy}</Text>
        </Button>
        <Button size="S" variant="secondary" onPress={() => closeAiToolResult(key)}>
          {C.done}
        </Button>
      </div>
    </div>
  );
}

/** 写进视频的工具：改了几处、一键撤销、完成。 */
export function DirectReceiptView({ runKey: key, receipt }: { runKey: string; receipt: AiToolReceipt }) {
  const changes = receipt.summary.applied?.changes ?? 0;
  const text = !changes ? C.appliedNothing : receipt.tool === 'chapters' ? C.appliedChapters(changes) : C.appliedPolish(changes);
  return (
    <div className={stack}>
      <div className={doneRow} role="status">
        <CheckmarkCircle />
        <span>{receipt.undone ? C.undone : text}</span>
      </div>
      <div className={actions}>
        {receipt.transactionId && !receipt.undone ? (
          <ActionButton size="S" isPending={receipt.busy} onPress={() => void undoAiTool(key)}>
            {C.undo}
          </ActionButton>
        ) : null}
        <Button size="S" variant="secondary" onPress={() => closeAiToolResult(key)}>
          {C.done}
        </Button>
      </div>
    </div>
  );
}

/** 没跑完或被拒：原因、补救（去配模型）、从停下的那一步重试、去后台任务决定。 */
export function DirectProblem({ runKey: key, problem }: { runKey: string; problem: AiToolProblem }) {
  const go = useShell((s) => s.go);
  const busy = useAiToolRun((s) => !!s.runs[key]);
  return (
    <InlineAlert variant={problem.taskId ? 'notice' : 'negative'}>
      <Heading>{problem.title}</Heading>
      <Content>
        {problem.remedy?.hint || problem.message ? <div>{problem.remedy?.hint || problem.message}</div> : null}
        <div className={alertActions}>
          {problem.remedy ? (
            <Button size="S" variant="accent" onPress={() => go(problem.remedy!.target)}>
              {problem.remedy.label}
            </Button>
          ) : null}
          {problem.retryJobId ? (
            <Button size="S" variant={problem.remedy ? 'secondary' : 'accent'} isDisabled={busy} onPress={() => void retryAiTool(key)}>
              {C.retry}
            </Button>
          ) : null}
          {problem.taskId ? (
            <Button size="S" variant="secondary" onPress={() => go({ tab: 'tasks', taskId: problem.taskId! })}>
              {C.openTasks}
            </Button>
          ) : null}
          <Button size="S" variant="secondary" fillStyle="outline" onPress={() => dismissAiToolProblem(key)}>
            {C.dismiss}
          </Button>
        </div>
      </Content>
    </InlineAlert>
  );
}

