import { useEffect, useMemo, useState } from 'react';
import type { ToolInputFacts } from '@baocut/protocol';
import { Button, Text, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { toolById, type FootageToolId } from '../../model/tool-catalog.ts';
import { modelReason, saveTarget } from '../../model/tool-frame.ts';
import { M } from '../../model/tools-footage-copy.ts';
import {
  BLANK_FOOTAGE_FORM,
  acceptsKind,
  againFootage,
  etaText,
  countText,
  footageBlockers,
  footageNextSteps,
  footageOp,
  footageRequest,
  managedToolsFor,
  sourcesFor,
  workload,
  MAX_INPUTS,
  type FootageForm,
  type ManagedFootageTool,
  type Stabilizer,
} from '../../model/tools-footage.ts';
import { localModelOptions, findOption, initialModelKey } from '../../model/tools-models.ts';
import { entryIdOfInput, rejectionText, spaceInput } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { FootageLoad, FootageToolGate } from './footage-gate.tsx';
import { FootageRange, FootageSources } from './footage-inputs.tsx';
import { FootageOptions } from './footage-options.tsx';
import { FootageSide } from './footage-record.tsx';
import { BarStatus, Gate, HeaderChip, submitOnModEnter, ToolPage, Workbench } from './tool-parts.tsx';
import { SaveDirRow } from './tool-frame.tsx';
import { TOOL_ICON } from './tool-icon.tsx';
import { FORM_COPY, TRANSCODE_COPY } from './tools-copy.ts';
import { FfmpegGate, useFfmpeg } from './transcode-parts.tsx';
import { useManagedTools } from './use-managed-tools.ts';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { usePreset, useRerun } from './video-tool-parts.tsx';

/*
 * 设计稿 tool-footage.jsx：视频去抖、视频超分、视频插帧、统一色调、去除背景与音频分轨共用一页，由左边侧栏切换（各自保留工具 ID，页里没有切换条）。
 * 左边是输入 → 处理哪一段 → 选项 → 第一次用的下载 → 这一次要多久 → 保存位置，右边是任务队列。都是文件到文件，提交走 Runtime 的固定流程
 * （工具 ID 就是流程名）。选好文件时用 `tools.inspectInputs` 读帧数、尺寸与是不是 HDR，页头与工作量都按它算；规则在 model/tools-footage.ts。
 */

const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });

export function FootageTool({ tool }: { tool: FootageToolId }) {
  return <FootagePage key={tool} id={tool} />;
}

/** 这台电脑的 ffmpeg 去抖用哪个滤镜；去抖页才问，还没问到时 undefined。 */
function useStabilizer(enabled: boolean): Stabilizer | undefined {
  const runtime = useRuntime();
  const [value, setValue] = useState<Stabilizer | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    runtime.inspectToolInputs({ inputs: [], stabilizer: true }).then(
      (r) => {
        if (live) setValue(r.stabilizer ?? null);
      },
      () => {
        if (live) setValue(null);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, runtime]);
  return value;
}

function FootagePage({ id }: { id: FootageToolId }) {
  const runtime = useRuntime();
  const op = footageOp(id);
  const info = toolById(id)!;
  const draft = useTools((s) => s.footage);
  const patch = useTools((s) => s.patchFootage);
  const form: FootageForm = draft.forms[id] ?? BLANK_FOOTAGE_FORM;
  const setForm = (p: Partial<FootageForm>) => {
    const current = useTools.getState().footage;
    patch({ forms: { ...current.forms, [id]: { ...(current.forms[id] ?? BLANK_FOOTAGE_FORM), ...p } } });
  };
  const srcs = sourcesFor(id, draft);
  const web = runtime.host.platform === 'web';
  const tools = useToolStatus();
  const one = tools.byId.get(id);
  // 分轨缺的只是模型时不挡住页面：模型一行就地下载。
  const modelOnly = op === 'separate' && !!one?.problems.length && one.problems.every((p) => p.capability);
  const firstProblem = modelOnly ? null : blockOf(tools, id, 'file');
  const ffmpegProblem = one?.problems.find((p) => p.tool === 'ffmpeg');
  // ffmpeg 不能用时由它自己的门卡说（带重新检测），别的原因写在这里。
  const block = web || !ffmpegProblem ? firstProblem : null;
  const ffmpeg = useFfmpeg(!web);
  const stabilizer = useStabilizer(op === 'stabilize' && !web);

  const managedNames = managedToolsFor(id, form);
  const managed = useManagedTools(managedNames, managedNames.length > 0 && !web);
  const missingTool = managed.state === 'missing' ? (managed.missing as ManagedFootageTool | null) : null;
  const toolsChecking = managed.state === 'checking';

  const view = useModels((s) => s.capabilities);
  const options = useMemo(() => (view && op === 'separate' ? localModelOptions(view, 'separateAudio') : []), [view, op]);
  const option = op === 'separate' ? findOption(options, initialModelKey(options, form.sepModel, view?.separateAudio.effective ?? null)) : null;
  const sepModel = option ? { label: option.label, usable: option.usable, fourStems: option.info.fourStems } : null;
  const sepReason = op === 'separate' && view ? modelReason(options, option, M.modelNoun) : null;

  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);

  /** 读事实再放进来：这个工具不收的、读不出的不进列表，各说一句。 */
  const addInputs = async (list: readonly string[], replace = false) => {
    // 这个工具现在用不了（Web 上固定流程不开放）：读事实的方法也不开放，直接说原因。
    if (block) {
      ToastQueue.neutral(block, { timeout: 5000 });
      return;
    }
    const before = useTools.getState().footage;
    const current = replace ? [] : before.inputs;
    const fresh = [...new Set(list)].filter((input) => !current.includes(input));
    if (!fresh.length) return;
    const room = MAX_INPUTS - sourcesFor(id, { inputs: current, facts: before.facts }).length;
    if (fresh.length > room) ToastQueue.neutral(M.tooManyInputs(MAX_INPUTS), { timeout: 5000 });
    const taking = fresh.slice(0, Math.max(0, room));
    if (!taking.length) return;
    let items;
    setReading(true);
    try {
      ({ items } = await runtime.inspectToolInputs({
        inputs: taking.map((input) => {
          const entryId = entryIdOfInput(input);
          return entryId ? { entryId } : input;
        }),
      }));
    } catch (e) {
      ToastQueue.negative(rejectionText(e), { timeout: 6000 });
      return;
    } finally {
      setReading(false);
    }
    const after = useTools.getState().footage;
    const facts = { ...after.facts };
    const accepted: string[] = [];
    let refused = false;
    items.forEach((item, i) => {
      if (item.kind === 'unreadable') {
        ToastQueue.negative(M.unreadable(item.name), { timeout: 6000 });
        return;
      }
      facts[taking[i]!] = item;
      if (acceptsKind(id, item.kind)) accepted.push(taking[i]!);
      else refused = true;
    });
    if (refused) ToastQueue.neutral(M.notAccepted[id], { timeout: 5000 });
    patch({ inputs: replace ? accepted : [...after.inputs, ...accepted], facts });
  };

  /** 读一个参考的事实；读不出或不能当参考时说一句，返回 null。 */
  const readReference = async (input: string): Promise<ToolInputFacts | null> => {
    const entryId = entryIdOfInput(input);
    try {
      const { items } = await runtime.inspectToolInputs({ inputs: [entryId ? { entryId } : input] });
      const item = items[0];
      if (item && item.kind !== 'unreadable' && item.kind !== 'audio') return item;
      ToastQueue.negative(M.unreadable(item?.name ?? input), { timeout: 6000 });
    } catch (e) {
      ToastQueue.negative(rejectionText(e), { timeout: 6000 });
    }
    return null;
  };

  /** 选参考：读事实，记在表单上。「再做一次」先把参考与取哪一秒填好再来这里：读不出时不留着它，读得出时那一秒不动。 */
  const setReference = async (input: string) => {
    if (block) {
      ToastQueue.neutral(block, { timeout: 5000 });
      return;
    }
    const current = () => useTools.getState().footage.forms[id]?.reference;
    if (!useTools.getState().footage.facts[input]) {
      const item = await readReference(input);
      if (!item) {
        if (current() === input) setForm({ reference: null, referenceAt: null });
        return;
      }
      patch({ facts: { ...useTools.getState().footage.facts, [input]: item } });
    }
    if (current() !== input) setForm({ reference: input, referenceAt: null });
  };

  // 从 Space 查看器带来的条目直接加进列表。
  usePreset(id, (entryId) => void addInputs([spaceInput(entryId)]));
  // 「再做一次 / 重试」：照这条任务的文件与设置填好。
  useRerun(id, (job) => {
    const again = againFootage(job);
    if (!again) return;
    // 分离模型：记录里只有模型 ID，按这台电脑现在的选项找回；已经没有时用默认。
    const picked = options.find((o) => o.modelId === job.pipeline?.params.model);
    setForm({ ...again.form, sepModel: picked?.key ?? null });
    void addInputs(again.inputs, true).then(() => {
      if (again.form.reference) void setReference(again.form.reference);
      ToastQueue.neutral(M.againDone, { timeout: 3000 });
    });
  });

  const hard = footageBlockers(id, form, srcs, sepModel);
  const steps = footageNextSteps(id, form, srcs, { missingTool, modelReason: sepReason });
  const problems = [...hard, ...steps];
  const ffmpegBad = ffmpeg.state.status === 'done' && !ffmpeg.state.line.ready;
  const blocked = !!block || ffmpegBad || block === undefined;

  const statusLine = (): { text: string; bad: boolean } => {
    if (block === undefined) return { text: FORM_COPY.loading, bad: false };
    if (block) return { text: block, bad: true };
    if (ffmpeg.state.status === 'checking') return { text: TRANSCODE_COPY.ffmpegChecking, bad: false };
    if (ffmpegBad && ffmpeg.state.status === 'done') return { text: ffmpeg.state.line.text, bad: true };
    if (hard.length) return { text: hard[0]!, bad: true };
    if (steps.length) return { text: steps[0]!, bad: tried && srcs.length > 0 };
    const w = workload(id, form, srcs, stabilizer ?? null, option?.modelId ?? null);
    const head = op === 'separate' ? M.filesCount(srcs.length) : w.hasVideo ? M.frames(countText(w.frames)) : M.images(srcs.length);
    return { text: `${head} · ${etaText(w.seconds)}`, bad: false };
  };
  const status = statusLine();

  const submit = () => {
    setTried(true);
    if (blocked || submitting || toolsChecking) return;
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    setSubmitting(true);
    runtime
      .startPipeline(id, footageRequest(id, form, srcs, saveTarget(tools.saveDirectory, draft.outDir), option?.modelId ?? null))
      .then(
        () => {
          ToastQueue.positive(M.submitted, { timeout: 3000 });
          setTried(false);
        },
        (e: unknown) => ToastQueue.negative(M.submitFailed(rejectionText(e)), { timeout: 8000 }),
      )
      .finally(() => setSubmitting(false));
  };

  const Icon = TOOL_ICON[info.icon];
  const bar = (
    <>
      <BarStatus text={status.text} bad={status.bad} />
      <Button variant="accent" isDisabled={blocked || toolsChecking} isPending={submitting} onPress={submit}>
        <Icon />
        <Text>{M.verb[id]}</Text>
      </Button>
    </>
  );

  const main = (
    <>
      <p className={lede}>{M.lede[id]}</p>
      {block ? <Gate title={M.unavailable} body={block} /> : null}
      {!web ? <FfmpegGate state={ffmpeg.state} recheck={ffmpeg.recheck} /> : null}
      <FootageSources id={id} form={form} srcs={srcs} reading={reading} onAdd={(list) => void addInputs(list)} onChange={(inputs) => patch({ inputs })} allInputs={draft.inputs} />
      {op !== 'separate' ? <FootageRange form={form} setForm={setForm} srcs={srcs} /> : null}
      <FootageOptions id={id} form={form} setForm={setForm} srcs={srcs} stabilizer={stabilizer} options={options} option={option} onReference={(input) => void setReference(input)} facts={draft.facts} />
      {!web ? <FootageToolGate form={form} setForm={setForm} managed={managed} /> : null}
      <FootageLoad id={id} form={form} setForm={setForm} srcs={srcs} stabilizer={stabilizer ?? null} sepModel={option?.modelId ?? null} />
      <SaveDirRow saveDirectory={tools.saveDirectory} override={draft.outDir} onChange={(outDir) => patch({ outDir })} note={M.saveNote[id]} />
    </>
  );

  return (
    <ToolPage title={info.name} bar={bar} chip={<HeaderChip text={M.chipLocal} tone="neutral" />}>
      <Workbench main={main} side={<FootageSide />} sideLabel={M.side} onKeyDown={submitOnModEnter(submit)} />
    </ToolPage>
  );
}
