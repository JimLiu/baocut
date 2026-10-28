import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  UPSCALE_IMAGE_DENOISE_LEVELS,
  UPSCALE_IMAGE_MODEL_SPECS,
  upscaleImageTools,
  upscalePeakScale,
  type EditImageAnchor,
  type EditImageMethod,
  type JobRecord,
  type UpscaleImageDenoise,
  type UpscaleImageModel,
  type UpscaleImageScale,
} from '@baocut/protocol';
import {
  ActionButton,
  Button,
  DropZone,
  Header,
  Heading,
  NumberField,
  Picker,
  PickerItem,
  PickerSection,
  ProgressBar,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Close from '@react-spectrum/s2/icons/Close';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Undo from '@react-spectrum/s2/icons/Undo';
import Upload from '@react-spectrum/s2/icons/Upload';
import ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton, Radio, RadioGroup, type DropItem } from 'react-aria-components';
import { M } from '../../model/tools-image-edit-copy.ts';
import {
  BOX_PRESETS,
  EMPTY_SELECTION,
  EXPAND_ANCHORS,
  EXPAND_RATIOS,
  IMAGE_EDIT_OPS,
  IMAGE_EDIT_PIPELINES,
  UPSCALE_GROUPS,
  UPSCALE_SCALES,
  blankForm,
  editRequest,
  expandPlan,
  imageEditOp,
  imageEditProblems,
  imageEditToolOfPipeline,
  needsResize,
  presetBox,
  ratioDiffers,
  scaleSelection,
  selectionStats,
  sendsWhole,
  sourcesFor,
  upscalableImageModel,
  upscaleLicense,
  upscaleManagedTools,
  upscaleRequest,
  upscaleSize,
  workArea,
  type ExpandRatio,
  type ImageEditForm,
  type ImageEditTool as ImageEditToolId,
  type ImageSource,
  type Selection,
} from '../../model/tools-image-edit.ts';
import { imageModelOptions, type ImageOption } from '../../model/tools-image.ts';
import type { ImageCandidate } from '../../model/image-preview.ts';
import { formatBytes } from '../../model/space.ts';
import { problemText } from '../../model/tools-gallery.ts';
import { jobPercent } from '../../model/task-list.ts';
import { EmptyCard } from '../models/model-parts.tsx';
import { findOption } from '../../model/tools-models.ts';
import { didNotFinish, failureText, liveCount, stateLabel } from '../../model/tools-records.ts';
import { entryIdOfInput, fileName, rejectionText } from '../../model/tools-transcode.ts';
import { saveTarget } from '../../model/tool-frame.ts';
import type { ToolId } from '../../model/tool-catalog.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ImageLightbox } from '../media/image-lightbox.tsx';
import { useSpace } from '../../state/space-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { useNow } from '../use-now.ts';
import { useEntryThumbnail } from '../use-entry-thumbnail.ts';
import { BarStatus, detail, detailGrow, Gate, HeaderChip, hintText, RecordCard, recordHead, recordIcon, recordRow, recordText, recordTitle, Row, Section, SectionLink, SideFoot, SideHead, submitOnModEnter, ToolPage, ToolTextArea, Workbench } from './tool-parts.tsx';
import { ModelRow, SaveDirRow } from './tool-frame.tsx';
import { ToolOutputRow, useJobOutputs } from './tool-outputs.tsx';
import { FORM_COPY, FRAME_COPY, IMAGE_COPY, RECORD_COPY } from './tools-copy.ts';
import { GrantCard } from './tool-run-view.tsx';
import { useImageEditStart } from './use-image-edit-start.ts';
import { loadEntry, loadLocal } from './image-edit-sources.ts';
import { SpacePicker } from './tool-video-picker.tsx';
import { useCancelJob } from './use-tool-records.ts';
import { useManagedTools, type ManagedToolsState } from './use-managed-tools.ts';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { usePreset } from './video-tool-parts.tsx';

/*
 * 设计稿 tool-image-edit.jsx 与 image-edit-canvas.jsx：放大 / 去除物体 / 去水印 / 重绘 / 扩图共用一页，由左边侧栏切换（各自保留
 * 工具 ID，页里不再有切换条）。左边来源 → 画布（涂抹、拖框或扩图预览）→ 选项 → 保存位置，右边是这五个工具的处理记录（`jobs` 主题里
 * 这几条流程的任务）。来源小图与画布都能点开图片查看器，查看器表头的「用工具处理…」把这张图带进别的工具。
 * 提交走 Runtime 的固定流程：放大是 `upscale-image`（按选的模型用 Real-ESRGAN、waifu2x 这些受管外部工具——第一次用之前在这一页
 * 下载——或 ffmpeg 插值、收参考图的图像模型），别的是 `remove-object` 等四个流程（ffmpeg 快速填充，或能改图的图像模型）。
 * 选区与扩图的规则在 model/tools-image-edit.ts。
 */

/** 台面里图的最高显示高度（CSS 像素）；放大只看一眼原图，矮一些。 */
const FRAME_MAX_H = 456;
const PEEK_MAX_H = 200;

const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const sources = style({ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflow: 'auto' });
const source = style({ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 'default', backgroundColor: 'gray-25', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', minWidth: 0 });
const thumbButton = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: 40,
  height: 40,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  overflow: 'hidden',
  backgroundColor: 'gray-100',
  color: 'gray-700',
  cursor: 'zoom-in',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
});
const thumbImage = style({ display: 'block', width: 'full', height: 'full', objectFit: 'cover' });
// 不涂不框的工具（放大、扩图）整张图都是「点开大图」。
const viewHit = style({
  position: 'absolute',
  inset: 0,
  width: 'full',
  height: 'full',
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'zoom-in',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineOffset: -2,
  outlineColor: 'focus-ring',
});
const sourceText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const sourceName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const dropZone = style({ width: 'full' });
const dropBody = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 24, textAlign: 'center' });
const dropTitle = style({ font: 'title-sm', color: 'gray-900' });
const stage = style({ display: 'grid', placeItems: 'center', padding: 12, borderRadius: 'lg', backgroundColor: 'gray-100', overflow: 'hidden', minWidth: 0 });
const frame = style({ position: 'relative', maxWidth: 'full' });
const picture = style({ position: 'absolute', inset: 0, display: 'block', width: 'full', height: 'full', objectFit: 'fill', userSelect: 'none' });
const placeholder = style({ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', backgroundColor: 'gray-300', color: 'gray-700' });
const overlay = style({ position: 'absolute', inset: 0, width: 'full', height: 'full', touchAction: 'none' });
const checker = style({ position: 'relative', maxWidth: 'full', backgroundColor: 'gray-200', borderWidth: 1, borderStyle: 'dashed', borderColor: 'gray-500' });
const placed = style({ position: 'absolute', outlineStyle: 'solid', outlineWidth: 2, outlineColor: 'blue-900' });
const bar = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minHeight: 32 });
const mono = style({ font: 'code-xs', color: 'gray-700' });
const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const anchors = style({ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gap: 8 });
// 九个单选（同 S2 Radio 的圆点，没有文字：名字在 aria-label 里）按 3×3 排；S2 RadioGroup 的选项容器不能改成网格，所以用 RAC。
const anchor = style({
  display: 'flex',
  borderRadius: 'full',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const anchorDot = style({
  boxSizing: 'border-box',
  width: 16,
  height: 16,
  borderRadius: 'full',
  borderStyle: 'solid',
  borderWidth: { default: 2, isSelected: '[5px]' },
  borderColor: { default: 'gray-800', isHovered: 'gray-900', isSelected: 'gray-900' },
  backgroundColor: 'gray-25',
});
const peekRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 });
const peekItem = style({ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 160, margin: 0 });
const marginGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 });
const marginField = style({ width: 120 });
const progress = style({ width: 'full' });
const errorTitle = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'orange-1000', overflowWrap: 'anywhere' });
const warn = style({ margin: 0, font: 'ui-sm', color: 'orange-1000' });

const fit = (w: number, h: number, maxH = FRAME_MAX_H) => ({ aspectRatio: `${w} / ${h}`, width: `min(100%, ${Math.round((maxH * w) / h)}px)` });

/** 五个工具各一个入口（路由的工具 ID 不同，页面是同一个）。 */
export function ImageEditTool({ tool }: { tool: ToolId }) {
  const op = IMAGE_EDIT_OPS.find((o) => o.toolId === tool)?.id ?? 'upscale';
  return <ImageEditPage key={op} op={op} />;
}

/** 图片能不能显示：本机文件经媒体通道读，Space 条目用它的文件或缩略图。 */
function useSourceUrl(src: ImageSource): string | null {
  const entryId = entryIdOfInput(src.input);
  const entry = useSpace((s) => (entryId ? (s.entries.find((e) => e.id === entryId) ?? null) : null));
  const thumbnail = useEntryThumbnail(src.url ? null : entry);
  return src.url ?? (thumbnail?.kind === 'image' ? thumbnail.url : null);
}

/** 来源图在查看器里的样子：Space 的按条目，本机的按路径。 */
function candidateOf(s: ImageSource): ImageCandidate {
  const entryId = entryIdOfInput(s.input);
  return { target: entryId ? { entryId } : { localPath: s.input }, name: s.name };
}

function ImageEditPage({ op }: { op: ImageEditToolId }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const o = imageEditOp(op);
  const draft = useTools((s) => s.imageEdit);
  const patch = useTools((s) => s.patchImageEdit);
  const tools = useToolStatus();
  const block = blockOf(tools, o.toolId, 'file');
  const view = useModels((s) => s.capabilities);
  // 放大（AI 重画）列收参考图、给像素尺寸的模型，别的工具列能按提示词改图的。
  const models = useMemo(
    () => (view ? imageModelOptions(view).filter((m) => (op === 'upscale' ? upscalableImageModel(m.info) : m.info.referenceImages?.edit)) : []),
    [view, op],
  );
  const editReady = models.some((m) => m.usable);
  const form: ImageEditForm = draft.forms[op] ?? blankForm(op, editReady);
  const sel: Selection = draft.selections[op] ?? EMPTY_SELECTION;
  const srcs = sourcesFor(op, draft.sources);
  const src = srcs[0] ?? null;
  const setForm = (p: Partial<ImageEditForm>) => patch({ forms: { ...draft.forms, [op]: { ...form, ...p } } });
  const setSel = (next: Selection) => patch({ selections: { ...draft.selections, [op]: next } });
  // 换了来源图：选区按原图像素记，各工具的都清掉。
  const setSources = (list: ImageSource[]) => patch({ sources: list, selections: {} });
  const web = runtime.host.platform === 'web';
  // 选的放大模型要下载的程序与权重：这一页有自己的下载卡（原型的 ToolCard），页头与提交跟着它说。浏览器里不开放
  // `externalTools.*`，不查也不下载，缺的看 `tools.list` 的限制。
  const managed = useManagedTools(op === 'upscale' ? upscaleManagedTools(form.model) : [], op === 'upscale' && !web);
  const toolsChecking = managed.state === 'checking';
  // 这个模型要、下载卡又管不了的工具（ffmpeg；浏览器里是全部）没装：`tools.list` 的限制挡住提交。
  const toolLimit =
    op === 'upscale'
      ? tools.byId
          .get(o.toolId)
          ?.limitations.find(
            (l) => l.tool && upscaleImageTools(form.model, form.scale).includes(l.tool) && (web || !upscaleManagedTools(form.model).includes(l.tool)),
          )
      : undefined;
  const shownBlock = block || (toolLimit ? problemText(toolLimit, true) : block);
  const [tried, setTried] = useState(false);
  const [fromSpace, setFromSpace] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const entries = useSpace((s) => s.entries);

  const engine = findOption(models, form.engine) ?? models.find((m) => m.usable) ?? models[0] ?? null;
  const modelReason = !models.some((m) => m.usable)
    ? op === 'upscale'
      ? M.noUpscaleModel
      : M.noEditModel
    : engine && !engine.usable
      ? (engine.why ?? M.modelUnusable(engine.label))
      : null;
  const upscaleTool = managed.state === 'missing' ? (managed.tool?.label ?? managed.missing) : null;
  const problems = imageEditProblems(op, form, srcs, sel, { upscaleTool, modelReason });
  const generative = op === 'upscale' && UPSCALE_IMAGE_MODEL_SPECS[form.model].engine === 'generative';
  const local = op === 'upscale' ? !generative || !!engine?.local : form.method === 'fill' || !!engine?.local;
  const chip = local ? M.chipLocal : generative || (src && sendsWhole(op, sel, src)) ? M.chipWhole : M.chipRegion;

  usePreset(o.toolId, (entryId) => {
    const entry = entries.find((e) => e.id === entryId);
    // 同一张图再带进来（查看器里又选了这个工具）不重复加。
    if (entry) void fromEntry(entry.id).then((s) => s && setSources(o.batch ? [...draft.sources.filter((x) => x.input !== s.input), s] : [s]));
  });

  const fromEntry = async (entryId: string): Promise<ImageSource | null> => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return null;
    // 按条目读（Web 也能读）：来源目录里扫描到的图没有 `file`，也没有记下宽高。
    const loaded = await loadEntry(runtime, entry.id);
    if (loaded) return { ...loaded, name: entry.name };
    const width = entry.media?.width;
    const height = entry.media?.height;
    return width && height ? { input: `space:${entry.id}`, name: entry.name, width, height, url: null } : null;
  };

  const addPaths = async (paths: readonly string[]) => {
    const loaded = (await Promise.all(paths.map((p) => loadLocal(runtime, p)))).filter((s): s is ImageSource => !!s);
    if (loaded.length < paths.length) ToastQueue.neutral(M.notImages, { timeout: 5000 });
    if (loaded.length) setSources(o.batch ? [...draft.sources, ...loaded].slice(0, 50) : loaded.slice(0, 1));
  };

  const outDir = saveTarget(tools.saveDirectory, draft.outDir) ?? null;
  // 表单的样子：改了，在等的授权请求就作废。
  const formKey = JSON.stringify([op, form, srcs.map((s) => s.input), sel, engine?.key ?? null, outDir]);
  const starter = useImageEditStart(formKey, {
    started: () => {
      ToastQueue.positive(M.submitted, { timeout: 3000 });
      setTried(false);
    },
    failed: (e) => ToastQueue.negative(M.submitFailed(rejectionText(e)), { timeout: 8000 }),
  });

  const submit = () => {
    setTried(true);
    if (shownBlock || toolsChecking || starter.busy || starter.asking) return;
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    starter.start(
      op === 'upscale'
        ? { pipeline: IMAGE_EDIT_PIPELINES.upscale, params: { ...upscaleRequest(form, srcs, generative ? engine : null, outDir) } }
        : { pipeline: IMAGE_EDIT_PIPELINES[op], params: { ...editRequest(op, form, srcs, sel, engine, outDir) } },
    );
  };

  const status = shownBlock
    ? { text: shownBlock, bad: true }
    : problems.length
      ? { text: problems[0]!, bad: tried }
      : starter.asking
        ? { text: FORM_COPY.needGrant, bad: false }
        : { text: statusText(op, form, srcs), bad: false };
  const barNode = (
    <>
      <BarStatus text={status.text} bad={status.bad} />
      <Button variant="accent" isDisabled={!!shownBlock || toolsChecking || !!starter.asking} isPending={starter.busy} onPress={submit}>
        <ImageIcon />
        <Text>{M.verb[op]}</Text>
      </Button>
    </>
  );

  const main = (
    <>
      <p className={lede}>{M.lede[op]}</p>
      {shownBlock ? <Gate title={M.unavailable} body={shownBlock} /> : null}
      {op === 'upscale' ? <ToolGate managed={managed} /> : null}

      <Section
        title={o.batch ? M.imagesTitle : M.imageTitle}
        aside={srcs.length ? <SectionLink onPress={() => setSources([])}>{M.clear}</SectionLink> : null}>
        {srcs.length ? (
          <div className={sources}>
            {srcs.map((s, i) => (
              <div key={`${s.input}-${i}`} className={source}>
                <SourceThumb src={s} onView={() => setViewing(i)} />
                <span className={sourceText}>
                  <span className={sourceName}>{s.name}</span>
                  <span className={detail}>{`${s.width}×${s.height}${entryIdOfInput(s.input) ? ' · Space' : ''}${i === 0 && srcs.length > 1 ? ` · ${M.firstOnCanvas}` : ''}`}</span>
                </span>
                <ActionButton isQuiet size="S" aria-label={M.remove} onPress={() => setSources(draft.sources.filter((x) => x !== s))}>
                  <Close />
                </ActionButton>
              </div>
            ))}
          </div>
        ) : null}
        <ImageDrop compact={srcs.length > 0} batch={o.batch} onPaths={(p) => void addPaths(p)} />
        <SectionLink onPress={() => setFromSpace((v) => !v)}>{fromSpace ? M.spaceDone : M.spaceAdd}</SectionLink>
        {fromSpace ? (
          <SpacePicker
            tool={o.toolId}
            data={null}
            value={null}
            onChange={(entryId) => void fromEntry(entryId).then((s) => (s ? setSources(o.batch ? [...draft.sources, s] : [s]) : ToastQueue.neutral(M.notImages, { timeout: 5000 })))}
          />
        ) : null}
      </Section>

      {src ? (
        <Section label={M.canvasLabel}>
          <EditCanvas op={op} src={src} others={srcs.slice(1)} sel={sel} setSel={setSel} form={form} setForm={setForm} onView={() => setViewing(0)} />
        </Section>
      ) : null}

      {op === 'upscale' ? (
        <UpscaleOptions form={form} setForm={setForm} src={src} models={models} engine={engine} onSettings={() => go({ tab: 'models', category: 'image' })} />
      ) : null}
      {op === 'expand' ? <ExpandOptions form={form} setForm={setForm} src={src} /> : null}
      {op !== 'upscale' ? (
        <MethodOptions op={op} form={form} setForm={setForm} models={models} engine={engine} onSettings={() => go({ tab: 'models', category: 'image' })} />
      ) : null}
      <SaveDirRow saveDirectory={tools.saveDirectory} override={draft.outDir} onChange={(outDir) => patch({ outDir })} note={M.saveNote} />
      {starter.asking ? <GrantCard items={starter.asking} onAgree={starter.agree} busy={starter.busy} /> : null}
    </>
  );

  return (
    <ToolPage title={M.title[op]} bar={barNode} chip={<HeaderChip text={chip} tone={local ? 'neutral' : 'notice'} />}>
      <Workbench main={main} side={<ImageEditSide />} sideLabel={M.side} onKeyDown={submitOnModEnter(submit)} />
      {viewing !== null && srcs[viewing] ? (
        <ImageLightbox files={srcs.map(candidateOf)} initial={candidateOf(srcs[viewing])} onClose={() => setViewing(null)} />
      ) : null}
    </ToolPage>
  );
}

/** 页头那句：这一次会得到什么。 */
function statusText(op: ImageEditToolId, form: ImageEditForm, srcs: readonly ImageSource[]): string {
  const src = srcs[0]!;
  const count = srcs.length > 1 ? `${M.images(srcs.length)} · ` : '';
  if (op === 'upscale') {
    const s = upscaleSize(src, form.scale, form.model);
    return `${count}${M.upscaleModel[form.model].name} · ${s.width}×${s.height}`;
  }
  if (op === 'expand') {
    const p = expandPlan(src, form);
    return `${p.width}×${p.height}`;
  }
  return `${count}${M.method[form.method].name}`;
}

/* ---------- 来源 ---------- */

function ImageDrop({ compact, batch, onPaths }: { compact: boolean; batch: boolean; onPaths: (paths: string[]) => void }) {
  const runtime = useRuntime();
  const pick = () => {
    if (!runtime.host.pickFiles) {
      void runtime.host.pickMediaFiles().then(onPaths);
      return;
    }
    void runtime.host
      .pickFiles({ title: M.pickTitle, multiple: batch, filters: [{ name: M.imageFilter, extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
      .then(onPaths);
  };
  const drop = async (items: readonly DropItem[]) => {
    const paths: string[] = [];
    let lost = 0;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const path = runtime.host.pathForFile(await item.getFile());
      if (path) paths.push(path);
      else lost += 1;
    }
    if (lost) ToastQueue.negative(M.noPath, { timeout: 6000 });
    if (paths.length) onPaths(paths);
  };
  return (
    <DropZone styles={dropZone} onDrop={(e) => void drop(e.items)}>
      <div className={dropBody}>
        <Upload />
        {compact ? null : (
          <>
            <span className={dropTitle}>{batch ? M.dropMany : M.dropOne}</span>
            <span className={detail}>{M.dropSub}</span>
          </>
        )}
        <Button variant="secondary" size={compact ? 'S' : 'M'} onPress={pick}>
          {compact ? <Add /> : null}
          <Text>{compact ? (batch ? M.addMore : M.replace) : M.pick}</Text>
        </Button>
      </div>
    </DropZone>
  );
}

/** 来源行的小图：点开图片查看器。 */
function SourceThumb({ src, onView }: { src: ImageSource; onView: () => void }) {
  const url = useSourceUrl(src);
  return (
    <RACButton className={thumbButton} aria-label={IMAGE_COPY.zoom(src.name)} onPress={onView}>
      {url ? <img className={thumbImage} src={url} alt="" draggable={false} /> : <ImageIcon />}
    </RACButton>
  );
}

/* ---------- 画布 ---------- */

function Picture({ src }: { src: ImageSource }) {
  const url = useSourceUrl(src);
  return url ? (
    <img className={picture} src={url} alt={src.name} draggable={false} />
  ) : (
    <span className={placeholder} aria-label={src.name}>
      <ImageIcon />
    </span>
  );
}

/** 指针位置 → 原图像素。 */
function toImage(ev: ReactPointerEvent, el: Element, src: { width: number; height: number }): [number, number] {
  const box = el.getBoundingClientRect();
  const x = ((ev.clientX - box.left) / box.width) * src.width;
  const y = ((ev.clientY - box.top) / box.height) * src.height;
  return [Math.max(0, Math.min(src.width, Math.round(x))), Math.max(0, Math.min(src.height, Math.round(y)))];
}

/** 涂抹或拖框的一层：SVG 用原图尺寸做 viewBox，坐标就是原图像素。 */
function SelectionLayer({ src, mode, sel, setSel, brush }: { src: ImageSource; mode: 'brush' | 'box'; sel: Selection; setSel: (s: Selection) => void; brush: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'brush' } | { kind: 'box'; from: [number, number] } | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const down = (ev: ReactPointerEvent<SVGSVGElement>) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = toImage(ev, ref.current!, src);
    if (mode === 'brush') {
      drag.current = { kind: 'brush' };
      setSel({ ...sel, strokes: [...sel.strokes, { radius: brush, points: [p] }] });
    } else {
      drag.current = { kind: 'box', from: p };
      setSel({ ...sel, boxes: [...sel.boxes, { x: p[0], y: p[1], width: 0, height: 0 }] });
    }
  };
  const move = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const p = toImage(ev, ref.current!, src);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'brush') {
      const strokes = sel.strokes.slice();
      const last = strokes[strokes.length - 1]!;
      strokes[strokes.length - 1] = { ...last, points: [...last.points, p] };
      setSel({ ...sel, strokes });
    } else {
      const boxes = sel.boxes.slice();
      boxes[boxes.length - 1] = { x: Math.min(d.from[0], p[0]), y: Math.min(d.from[1], p[1]), width: Math.abs(p[0] - d.from[0]), height: Math.abs(p[1] - d.from[1]) };
      setSel({ ...sel, boxes });
    }
  };
  const up = () => {
    // 一下点击没拖出框：不留一个空框。
    if (drag.current?.kind === 'box') setSel({ ...sel, boxes: sel.boxes.filter((b) => b.width > 4 && b.height > 4) });
    drag.current = null;
  };
  const path = (s: Selection['strokes'][number]) => s.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') + (s.points.length === 1 ? ' l0.1 0' : '');
  return (
    <svg
      ref={ref}
      className={overlay}
      style={{ cursor: mode === 'box' ? 'crosshair' : 'none' }}
      viewBox={`0 0 ${src.width} ${src.height}`}
      preserveAspectRatio="none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={mode === 'brush' ? M.brushLabel : M.boxLabel}>
      {sel.strokes.map((s, i) => (
        <path key={i} d={path(s)} fill="none" stroke="var(--s2-blue-900, #3b63fb)" strokeOpacity={0.45} strokeLinecap="round" strokeLinejoin="round" strokeWidth={s.radius * 2} />
      ))}
      <SelectionBoxes boxes={sel.boxes} />
      {mode === 'brush' && hover ? (
        <>
          {/* 深浅两圈：亮图与暗图上都看得见笔刷边 */}
          <circle cx={hover[0]} cy={hover[1]} r={brush} fill="none" stroke="#000" strokeWidth={4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle cx={hover[0]} cy={hover[1]} r={brush} fill="none" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </>
      ) : null}
    </svg>
  );
}

function SelectionBoxes({ boxes }: { boxes: Selection['boxes'] }) {
  return (
    <>
      {boxes.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill="#3b63fb" fillOpacity={0.25} stroke="#3b63fb" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </>
  );
}

/** 批量去水印：第 2 张起换算后的框，小图预览，比例不同的标出来。 */
function BatchPeek({ first, others, sel }: { first: ImageSource; others: readonly ImageSource[]; sel: Selection }) {
  if (!others.length || !sel.boxes.length) return null;
  const shown = others.slice(0, 4);
  return (
    <div className={peekRow}>
      {shown.map((other, i) => (
        <figure key={i} className={peekItem}>
          <div className={frame} style={fit(other.width, other.height, 72)}>
            <Picture src={other} />
            <svg className={overlay} viewBox={`0 0 ${other.width} ${other.height}`} preserveAspectRatio="none" aria-hidden style={{ pointerEvents: 'none' }}>
              <SelectionBoxes boxes={scaleSelection(sel, first, other).boxes} />
            </svg>
          </div>
          <figcaption className={detail}>{`${other.name}${ratioDiffers(first, other) ? ` · ${M.ratioDiffers}` : ''}`}</figcaption>
        </figure>
      ))}
      {others.length > shown.length ? <span className={detail}>{M.moreImages(others.length - shown.length)}</span> : null}
    </div>
  );
}

function EditCanvas({
  op,
  src,
  others,
  sel,
  setSel,
  form,
  setForm,
  onView,
}: {
  op: ImageEditToolId;
  src: ImageSource;
  others: readonly ImageSource[];
  sel: Selection;
  setSel: (s: Selection) => void;
  form: ImageEditForm;
  setForm: (p: Partial<ImageEditForm>) => void;
  onView: () => void;
}) {
  const o = imageEditOp(op);
  const stats = o.select ? selectionStats(sel, src) : null;
  const plan = op === 'expand' ? expandPlan(src, form) : null;
  const up = op === 'upscale' ? upscaleSize(src, form.scale, form.model) : null;
  const roi = stats && form.method === 'model' ? workArea(stats.bounds, src) : null;
  const count = o.select === 'brush' ? sel.strokes.length : sel.boxes.length;
  const undo = () => (o.select === 'brush' ? setSel({ ...sel, strokes: sel.strokes.slice(0, -1) }) : setSel({ ...sel, boxes: sel.boxes.slice(0, -1) }));
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <>
      <div className={stage}>
        {plan && !plan.same ? (
          <div className={checker} style={fit(plan.width, plan.height)}>
            <div className={placed} style={{ left: pct(plan.x, plan.width), top: pct(plan.y, plan.height), width: pct(src.width, plan.width), height: pct(src.height, plan.height) }}>
              <Picture src={src} />
              <RACButton className={viewHit} aria-label={IMAGE_COPY.zoom(src.name)} onPress={onView} />
            </div>
          </div>
        ) : (
          <div className={frame} style={fit(src.width, src.height, up ? PEEK_MAX_H : FRAME_MAX_H)}>
            <Picture src={src} />
            {o.select ? (
              <SelectionLayer src={src} mode={o.select} sel={sel} setSel={setSel} brush={form.brush} />
            ) : (
              <RACButton className={viewHit} aria-label={IMAGE_COPY.zoom(src.name)} onPress={onView} />
            )}
          </div>
        )}
      </div>
      <div className={bar}>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={IMAGE_COPY.zoom(src.name)} onPress={onView}>
            <ZoomIn />
          </ActionButton>
          <Tooltip>{IMAGE_COPY.zoom(src.name)}</Tooltip>
        </TooltipTrigger>
        <span className={mono}>{`${src.width}×${src.height}`}</span>
        {up ? <span className={detail}>{`→ ${up.width}×${up.height}`}</span> : null}
        {plan && !plan.same ? <span className={detail}>{`→ ${plan.width}×${plan.height} · ${M.added(plan.added)}`}</span> : null}
        {o.select === 'brush' ? (
          <Slider label={M.brush} size="S" minValue={8} maxValue={160} step={4} value={form.brush} onChange={(brush) => setForm({ brush })} formatOptions={{ maximumFractionDigits: 0 }} />
        ) : null}
        <span className={detailGrow}>{stats ? M.coverage(Math.max(1, Math.round(stats.coverage * 100)), roi ? `${roi.width}×${roi.height}` : null) : ''}</span>
        {o.select ? (
          <>
            <ActionButton isQuiet size="S" isDisabled={!count} onPress={undo}>
              <Undo />
              <Text>{o.select === 'brush' ? M.undoStroke : M.undoBox}</Text>
            </ActionButton>
            <ActionButton isQuiet size="S" isDisabled={!count} onPress={() => setSel(EMPTY_SELECTION)}>
              <Text>{M.clearSelection}</Text>
            </ActionButton>
          </>
        ) : null}
      </div>
      {o.select && !count ? <p className={hintText}>{o.select === 'brush' ? (op === 'repaint' ? M.hintRepaint : M.hintErase) : M.hintBox}</p> : null}
      {o.select === 'box' ? (
        <div className={chips} role="group" aria-label={M.presetsLabel}>
          {BOX_PRESETS.map((p) => (
            <ActionButton key={p} size="S" onPress={() => setSel({ ...sel, boxes: [...sel.boxes, presetBox(p, src.width, src.height)] })}>
              <Add />
              <Text>{M.preset[p]}</Text>
            </ActionButton>
          ))}
        </div>
      ) : null}
      {o.select === 'box' ? <BatchPeek first={src} others={others} sel={sel} /> : null}
    </>
  );
}

/* ---------- 选项 ---------- */

/** 选的模型要、还没装好的第一个受管工具的下载卡（执行的程序在前、权重包在后，一次装一个）；都装好时不显示。 */
function ToolGate({ managed }: { managed: ManagedToolsState }) {
  if (managed.state !== 'missing' || !managed.missing) return null;
  const label = managed.tool?.label ?? managed.missing;
  const offer = managed.tool?.offer;
  const facts = offer ? M.toolFacts(offer.version, offer.license, ((b) => (b == null ? null : formatBytes(b)))(offer.sizeBytes ?? offer.estimatedBytes ?? null)) : null;
  const body = M.toolBody[managed.missing];
  return (
    <Gate
      title={M.toolTitle(label)}
      body={
        <>
          <p className={hintText}>{body ? `${body} ${M.toolKeep}` : M.toolKeep}</p>
          {facts ? <p className={hintText}>{facts}</p> : null}
          {offer?.url ? <p className={mono}>{offer.url}</p> : null}
          {managed.tool?.reason ? <p className={warn}>{managed.tool.reason}</p> : null}
        </>
      }
      actions={
        <>
          <Button variant="accent" size="S" isPending={managed.installing} isDisabled={!offer || !!offer.blockedReason} onPress={managed.install}>
            {M.toolInstall}
          </Button>
          <Button variant="secondary" size="S" onPress={managed.recheck}>
            {M.recheck}
          </Button>
        </>
      }
    />
  );
}

/** 菜单里一行的说明：用途，权重不能商用或没写许可时接上提醒。 */
function upscaleModelSub(model: UpscaleImageModel): string {
  const license = upscaleLicense(model);
  return [M.upscaleModel[model].sub, license ? M.licenseTag[license.kind] : null].filter(Boolean).join(' · ');
}

/** 选项下面那句：按引擎说这一次怎么放大。 */
function upscaleNote(form: ImageEditForm): string {
  const spec = UPSCALE_IMAGE_MODEL_SPECS[form.model];
  if (spec.engine === 'lanczos') return M.lanczosNote;
  if (spec.engine === 'generative') return M.generativeNote;
  return `${needsResize(form.model, form.scale) ? M.resizeNote(upscalePeakScale(form.model, form.scale), form.scale) : M.nativeNote} ${M.upscaleCaveat}`;
}

function UpscaleOptions({
  form,
  setForm,
  src,
  models,
  engine,
  onSettings,
}: {
  form: ImageEditForm;
  setForm: (p: Partial<ImageEditForm>) => void;
  src: ImageSource | null;
  models: readonly ImageOption[];
  engine: ImageOption | null;
  onSettings: () => void;
}) {
  const size = src ? upscaleSize(src, form.scale, form.model) : null;
  const spec = UPSCALE_IMAGE_MODEL_SPECS[form.model];
  const license = upscaleLicense(form.model);
  return (
    <>
      <Section title={M.upscaleTitle}>
        <Picker
          label={M.upscaleModelTitle}
          menuWidth={360}
          selectedKey={form.model}
          onSelectionChange={(k) => {
            if (k !== null) setForm({ model: k as UpscaleImageModel });
          }}>
          {UPSCALE_GROUPS.map((g) => (
            <PickerSection key={g.id} id={`group:${g.id}`}>
              <Header>
                <Heading>{M.upscaleGroup[g.id]}</Heading>
              </Header>
              {g.models.map((k) => (
                <PickerItem key={k} id={k} textValue={M.upscaleModel[k].name}>
                  <Text slot="label">{M.upscaleModel[k].name}</Text>
                  <Text slot="description">{upscaleModelSub(k)}</Text>
                </PickerItem>
              ))}
            </PickerSection>
          ))}
        </Picker>
        <p className={hintText}>
          {M.upscaleModel[form.model].sub}
          {spec.weights ? (
            <>
              {' · '}
              <span className={mono}>{spec.weights}</span>
            </>
          ) : null}
        </p>
        {license ? <p className={warn}>{license.kind === 'nc' ? M.licenseNc(license.spdx) : M.licenseUnstated}</p> : null}
        <Row label={M.scale}>
          <SegmentedControl aria-label={M.scale} selectedKey={String(form.scale)} onSelectionChange={(k) => setForm({ scale: Number(k) as UpscaleImageScale })}>
            {UPSCALE_SCALES.map((s) => (
              <SegmentedControlItem key={s} id={String(s)}>{`${s}×`}</SegmentedControlItem>
            ))}
          </SegmentedControl>
          {size ? <span className={detailGrow}>{`${size.width}×${size.height}`}</span> : null}
        </Row>
        {spec.denoise ? (
          <Row label={M.denoise}>
            <SegmentedControl aria-label={M.denoise} selectedKey={String(form.denoise)} onSelectionChange={(k) => setForm({ denoise: Number(k) as UpscaleImageDenoise })}>
              {UPSCALE_IMAGE_DENOISE_LEVELS.map((l) => (
                <SegmentedControlItem key={l} id={String(l)}>
                  {M.denoiseLevel[l]}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Row>
        ) : null}
        {spec.denoise ? <p className={hintText}>{M.denoiseNote}</p> : null}
        <p className={hintText}>{upscaleNote(form)}</p>
      </Section>
      {spec.engine === 'generative' ? (
        <>
          <ModelRow
            noun={M.modelNoun}
            manage={IMAGE_COPY.manage}
            onSettings={onSettings}
            options={models}
            selected={engine}
            disableUnusable
            onSelect={(m) => setForm({ engine: m.key })}
            factsOf={(m) => (m.local ? M.localModel : M.cloudModel)}>
            <p className={hintText}>{`${M.generativeModelNote} ${engine?.local ? M.localNote : M.generativeCloudNote}`}</p>
          </ModelRow>
          <Section title={M.guidanceTitle} aside={<span className={detail}>{M.optional}</span>}>
            <ToolTextArea label={M.guidanceTitle} value={form.prompt} onChange={(prompt) => setForm({ prompt })} placeholder={M.guidancePlaceholder} compact />
          </Section>
        </>
      ) : null}
    </>
  );
}

function MethodOptions({
  op,
  form,
  setForm,
  models,
  engine,
  onSettings,
}: {
  op: ImageEditToolId;
  form: ImageEditForm;
  setForm: (p: Partial<ImageEditForm>) => void;
  models: readonly ImageOption[];
  engine: ImageOption | null;
  onSettings: () => void;
}) {
  const o = imageEditOp(op);
  return (
    <>
      {o.methods.length > 1 ? (
        <Section title={M.methodTitle}>
          <SegmentedControl aria-label={M.methodTitle} selectedKey={form.method} onSelectionChange={(k) => setForm({ method: k as EditImageMethod })}>
            {o.methods.map((k) => (
              <SegmentedControlItem key={k} id={k}>
                {M.method[k].name}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <p className={hintText}>{M.method[form.method].sub}</p>
        </Section>
      ) : null}
      {o.prompt !== 'none' ? (
        <Section title={op === 'repaint' ? M.promptRepaint : M.promptExpand} aside={op === 'expand' ? <span className={detail}>{M.optional}</span> : null}>
          <ToolTextArea
            label={op === 'repaint' ? M.promptRepaint : M.promptExpand}
            value={form.prompt}
            onChange={(prompt) => setForm({ prompt })}
            placeholder={op === 'repaint' ? M.promptRepaintPlaceholder : M.promptExpandPlaceholder}
            compact
          />
        </Section>
      ) : null}
      {form.method === 'model' ? (
        <ModelRow
          noun={M.modelNoun}
          manage={IMAGE_COPY.manage}
          onSettings={onSettings}
          options={models}
          selected={engine}
          disableUnusable
          onSelect={(m) => setForm({ engine: m.key })}
          factsOf={(m) => (m.local ? M.localModel : M.cloudModel)}>
          <p className={hintText}>{`${op === 'expand' ? M.modelExpandNote : M.modelRegionNote} ${engine?.local ? M.localNote : M.cloudNote}`}</p>
        </ModelRow>
      ) : null}
    </>
  );
}

function ExpandOptions({ form, setForm, src }: { form: ImageEditForm; setForm: (p: Partial<ImageEditForm>) => void; src: ImageSource | null }) {
  const plan = src ? expandPlan(src, form) : null;
  const m = form.margins;
  return (
    <Section title={M.expandTitle}>
      <SegmentedControl aria-label={M.expandTitle} selectedKey={form.ratio} onSelectionChange={(k) => setForm({ ratio: k as ExpandRatio })}>
        {EXPAND_RATIOS.map((r) => (
          <SegmentedControlItem key={r} id={r}>
            {r === 'free' ? M.byMargins : r}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {form.ratio === 'free' ? (
        <div className={marginGrid}>
          {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
            <NumberField
              key={k}
              size="S"
              styles={marginField}
              label={M.side_[k]}
              minValue={0}
              maxValue={100}
              step={5}
              value={m[k]}
              formatOptions={{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }}
              onChange={(v) => Number.isFinite(v) && setForm({ margins: { ...m, [k]: v } })}
            />
          ))}
        </div>
      ) : (
        <Row label={M.anchorTitle}>
          <RadioGroup aria-label={M.anchorTitle} value={form.anchor} onChange={(v) => setForm({ anchor: v as EditImageAnchor })} className={anchors}>
            {EXPAND_ANCHORS.map((a) => (
              <Radio key={a} value={a} aria-label={M.anchor[a]} className={(rp) => anchor(rp)}>
                {({ isSelected, isHovered }) => <span className={anchorDot({ isSelected, isHovered })} aria-hidden />}
              </Radio>
            ))}
          </RadioGroup>
          <span className={detailGrow}>{M.anchorNote}</span>
        </Row>
      )}
      {plan?.staged ? <p className={warn}>{M.staged}</p> : null}
    </Section>
  );
}

/* ---------- 处理记录 ---------- */

function useImageEditRecords(): { ready: boolean; list: JobRecord[] } {
  const ready = useJobs((s) => s.ready);
  const all = useJobs((s) => s.jobs);
  const hidden = useTools((s) => s.hidden);
  const list = useMemo(() => {
    const skip = new Set(hidden);
    return all
      .filter((j) => j.kind === 'pipeline' && imageEditToolOfPipeline(j.pipeline?.name) !== null && j.submitter.kind === 'connection' && !skip.has(j.jobId))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [all, hidden]);
  return { ready, list };
}

function ImageEditSide() {
  const records = useImageEditRecords();
  const now = useNow(30_000);
  const live = liveCount(records.list);
  return (
    <>
      <SideHead title={M.side} live={live ? RECORD_COPY.live(live) : null} count={RECORD_COPY.count(records.list.length)} />
      {records.list.length ? (
        records.list.map((job) => <ImageEditRecord key={job.jobId} job={job} now={now} />)
      ) : (
        <EmptyCard icon={<ImageIcon />} title={M.empty} body={M.emptyBody} />
      )}
      <SideFoot>{M.sideFoot}</SideFoot>
    </>
  );
}

function ImageEditRecord({ job, now }: { job: JobRecord; now: number }) {
  const tool = imageEditToolOfPipeline(job.pipeline?.name) ?? 'upscale';
  const outputs = useJobOutputs([job.jobId]);
  const cancel = useCancelJob();
  const hide = useTools((s) => s.hide);
  const params = (job.pipeline?.params ?? {}) as { inputs?: unknown[]; model?: unknown };
  const first = params.inputs?.[0];
  const name = typeof first === 'string' ? fileName(first) : M.title[tool];
  // 放大接上用的模型（参数是 Runtime 记下的，名字不认识就不写）。
  const upscaleModel = tool === 'upscale' && typeof params.model === 'string' && Object.hasOwn(M.upscaleModel, params.model) ? M.upscaleModel[params.model as UpscaleImageModel].name : null;
  const running = job.endedAt === null;
  const failed = didNotFinish(job);
  return (
    <RecordCard running={running} failed={failed} label={name}>
      <div className={recordHead}>
        <span className={recordIcon}>
          <ImageIcon />
        </span>
        <span className={recordTitle}>{name}</span>
        <span className={detail}>{stateLabel(job, now)}</span>
      </div>
      <span className={recordText({ isOff: true })}>
        {[M.title[tool], upscaleModel, (params.inputs?.length ?? 0) > 1 ? M.images(params.inputs!.length) : null].filter(Boolean).join(' · ')}
      </span>
      {running ? (
        <div className={recordRow}>
          <ProgressBar aria-label={M.progress} styles={progress} size="S" isIndeterminate={jobPercent(job) === null} value={jobPercent(job) ?? undefined} />
          <ActionButton isQuiet size="S" onPress={() => cancel(job.jobId)}>
            <Text>{RECORD_COPY.cancel}</Text>
          </ActionButton>
        </div>
      ) : null}
      {failed ? <p className={errorTitle}>{failureText(job)}</p> : null}
      {outputs.map((entry) => (
        <ToolOutputRow key={entry.id} entry={entry} fromTool={IMAGE_EDIT_OPS.find((o) => o.id === tool)!.toolId} compact />
      ))}
      {!running ? (
        <div className={recordRow}>
          <SectionLink onPress={() => hide(job.jobId)}>{RECORD_COPY.remove}</SectionLink>
        </div>
      ) : null}
    </RecordCard>
  );
}
