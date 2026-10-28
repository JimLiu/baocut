import {
  upscaleNeedsResize,
  upscalePeakScale,
  type EditImageAnchor,
  type EditImageMask,
  type EditImageMethod,
  type EditImageOp,
  type EditImageStartParams,
  type UpscaleImageModel,
  type UpscaleImageScale,
  type UpscaleImageStartParams,
} from '@baocut/protocol';
import type { ToolId } from './tool-catalog.ts';
import { entryIdOfInput } from './tools-transcode.ts';
import { M } from './tools-image-edit-copy.ts';

/**
 * 图片处理的五个工具（设计稿 model-image-edit.js `BC_IMAGE_EDIT`；架构设计 §7.9）：放大（`upscale-image`，Real-ESRGAN）、去除物体、
 * 去水印、重绘局部、扩展画面（`remove-object` 等四个流程，ffmpeg 快速填充或能改图的图像模型）共用一页，页顶切换。都是文件到文件：
 * 输入是本机图片或 Space 里的图片条目，结果是保存位置里的 PNG，不动原图。这里只算：工具表、选区（笔画与框 → 覆盖率与外框 →
 * 送去修补的一块）、扩图的几何、表单检查与提交参数。坐标一律是原图像素。
 */

export type ImageEditTool = 'upscale' | EditImageOp;

export interface ImageEditOp {
  id: ImageEditTool;
  toolId: ToolId;
  /** 选区怎么画：涂抹、拖框；放大与扩图没有选区。 */
  select: 'brush' | 'box' | null;
  prompt: 'none' | 'required' | 'optional';
  /** 收的补法，第一个是缺省（放大只有 Real-ESRGAN）。 */
  methods: readonly EditImageMethod[];
  /** 一次能放几张。 */
  batch: boolean;
}

export const IMAGE_EDIT_OPS: readonly ImageEditOp[] = [
  { id: 'upscale', toolId: 'upscale-image', select: null, prompt: 'none', methods: [], batch: true },
  { id: 'erase', toolId: 'remove-object', select: 'brush', prompt: 'none', methods: ['model', 'fill'], batch: false },
  { id: 'watermark', toolId: 'remove-watermark', select: 'box', prompt: 'none', methods: ['fill', 'model'], batch: true },
  { id: 'repaint', toolId: 'repaint-image', select: 'brush', prompt: 'required', methods: ['model'], batch: false },
  { id: 'expand', toolId: 'expand-image', select: null, prompt: 'optional', methods: ['model'], batch: false },
];

export function imageEditOp(id: ImageEditTool): ImageEditOp {
  return IMAGE_EDIT_OPS.find((o) => o.id === id)!;
}

export function imageEditOpOfTool(toolId: ToolId): ImageEditOp | null {
  return IMAGE_EDIT_OPS.find((o) => o.toolId === toolId) ?? null;
}

/* ---------- 来源 ---------- */

/** 一张来源图：`input` 是绝对路径或 Space 条目（`space:<id>`，同文件转码）；尺寸是原图像素。`url` 是界面里显示用的地址。 */
export interface ImageSource {
  input: string;
  name: string;
  width: number;
  height: number;
  url: string | null;
}

/* ---------- 放大 ---------- */

export const UPSCALE_MAX_SIDE = 16384;
export const UPSCALE_SCALES: readonly UpscaleImageScale[] = [2, 3, 4];

/** 模型没有这个倍数时要先放大到它有的倍数再缩（ffmpeg Lanczos）。 */
export function needsResize(model: UpscaleImageModel, scale: UpscaleImageScale): boolean {
  return upscaleNeedsResize(model, scale);
}

/** 放大后的尺寸；中间要先放大到模型有的倍数时，上限按中间那一步查。 */
export function upscaleSize(src: { width: number; height: number }, scale: UpscaleImageScale, model: UpscaleImageModel) {
  const peak = upscalePeakScale(model, scale);
  return { width: src.width * scale, height: src.height * scale, tooLarge: src.width * peak > UPSCALE_MAX_SIDE || src.height * peak > UPSCALE_MAX_SIDE };
}

/* ---------- 选区 ---------- */

/** 选区：框与笔画（同 `EditImageMask`），原图像素。 */
export interface Selection {
  boxes: Array<{ x: number; y: number; width: number; height: number }>;
  strokes: Array<{ radius: number; points: Array<[number, number]> }>;
}

export const EMPTY_SELECTION: Selection = { boxes: [], strokes: [] };

/** 覆盖率按 16 像素的格子近似（给提示用；Runtime 按真遮罩再查一次）。 */
const GRID = 16;
export const MAX_COVERAGE = 0.6;
export const WORK_AREA_MIN = 512;

export interface SelectionStats {
  bounds: { x: number; y: number; width: number; height: number };
  coverage: number;
}

export function selectionStats(sel: Selection, src: { width: number; height: number }): SelectionStats | null {
  const cols = Math.ceil(src.width / GRID);
  const rows = Math.ceil(src.height / GRID);
  const on = new Set<number>();
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let cy = Math.max(0, Math.floor(y0 / GRID)); cy <= Math.min(rows - 1, Math.floor(y1 / GRID)); cy++)
      for (let cx = Math.max(0, Math.floor(x0 / GRID)); cx <= Math.min(cols - 1, Math.floor(x1 / GRID)); cx++) on.add(cy * cols + cx);
  };
  for (const b of sel.boxes) if (b.width > 0 && b.height > 0) mark(b.x, b.y, b.x + b.width - 1, b.y + b.height - 1);
  for (const s of sel.strokes) {
    s.points.forEach((p, i) => {
      const prev = s.points[i - 1] ?? p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / (GRID / 2)));
      for (let k = 0; k <= steps; k++) {
        const x = prev[0] + ((p[0] - prev[0]) * k) / steps;
        const y = prev[1] + ((p[1] - prev[1]) * k) / steps;
        mark(x - s.radius, y - s.radius, x + s.radius, y + s.radius);
      }
    });
  }
  if (!on.size) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of on) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    x0 = Math.min(x0, cx);
    y0 = Math.min(y0, cy);
    x1 = Math.max(x1, cx);
    y1 = Math.max(y1, cy);
  }
  return {
    bounds: { x: x0 * GRID, y: y0 * GRID, width: Math.min(src.width, (x1 + 1) * GRID) - x0 * GRID, height: Math.min(src.height, (y1 + 1) * GRID) - y0 * GRID },
    coverage: on.size / (cols * rows),
  };
}

/** AI 修补送去的一块（同 Runtime 的 `workArea`）：外框四周各留一半上下文，每边至少 512，不出界；整张都要送时 `full`。 */
export function workArea(bounds: SelectionStats['bounds'], src: { width: number; height: number }) {
  const side = (len: number, total: number) => Math.min(total, Math.max(WORK_AREA_MIN, len * 2));
  const width = side(bounds.width, src.width);
  const height = side(bounds.height, src.height);
  const clamp = (start: number, len: number, total: number) => Math.max(0, Math.min(total - len, start));
  return {
    x: clamp(Math.round(bounds.x + bounds.width / 2 - width / 2), width, src.width),
    y: clamp(Math.round(bounds.y + bounds.height / 2 - height / 2), height, src.height),
    width,
    height,
    full: width === src.width && height === src.height,
  };
}

/** 批量去水印：选区按第一张记，换算到别的图（Runtime 也这样换算；这里给预览用）。 */
export function scaleSelection(sel: Selection, from: { width: number; height: number }, to: { width: number; height: number }): Selection {
  if (from.width === to.width && from.height === to.height) return sel;
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  return {
    boxes: sel.boxes.map((b) => ({ x: Math.round(b.x * kx), y: Math.round(b.y * ky), width: Math.round(b.width * kx), height: Math.round(b.height * ky) })),
    strokes: sel.strokes.map((s) => ({ radius: Math.max(1, Math.round(s.radius * Math.min(kx, ky))), points: s.points.map(([x, y]) => [Math.round(x * kx), Math.round(y * ky)] as [number, number]) })),
  };
}

/** 比例和第一张差 2% 以上：框换算过去可能偏。 */
export function ratioDiffers(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height) > 0.02;
}

/** 去水印的常见位置：四角与底部字幕条，按画面的比例。 */
export const BOX_PRESETS = ['br', 'bl', 'tr', 'tl', 'sub'] as const;
export type BoxPreset = (typeof BOX_PRESETS)[number];
export function presetBox(preset: BoxPreset, w: number, h: number): Selection['boxes'][number] {
  const corner = (fx: number, fy: number) => ({ x: Math.round(w * fx), y: Math.round(h * fy), width: Math.round(w * 0.22), height: Math.round(h * 0.1) });
  switch (preset) {
    case 'br':
      return corner(0.76, 0.88);
    case 'bl':
      return corner(0.02, 0.88);
    case 'tr':
      return corner(0.76, 0.02);
    case 'tl':
      return corner(0.02, 0.02);
    case 'sub':
      return { x: 0, y: Math.round(h * 0.82), width: w, height: Math.round(h * 0.14) };
  }
}

/** 一张图会不会整张发出去：扩图总是；修补的那一块盖满整张（小图、选区很大）时也是。 */
export function sendsWhole(op: ImageEditTool, sel: Selection, src: { width: number; height: number }): boolean {
  if (op === 'expand') return true;
  const st = selectionStats(sel, src);
  return !!st && workArea(st.bounds, src).full;
}

/* ---------- 扩图 ---------- */

export const EXPAND_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', 'free'] as const;
export type ExpandRatio = (typeof EXPAND_RATIOS)[number];
export const EXPAND_ANCHORS: readonly EditImageAnchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
export const EXPAND_MAX_SIDE = 4096;

/** 四边各扩多少（原图边长的百分比）。 */
export interface ExpandMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ExpandPlan {
  width: number;
  height: number;
  x: number;
  y: number;
  added: ExpandMargins;
  same: boolean;
  tooLarge: boolean;
  /** 一边扩出超过原图一倍：提醒分两次。 */
  staged: boolean;
}

/** 新画布与原图的位置（同 Runtime 的 `expandPlan`）：按比例只往缺的方向加、按锚点放；按边扩时四边各加原图边长的百分比。 */
export function expandPlan(src: { width: number; height: number }, form: { ratio: ExpandRatio; anchor: EditImageAnchor; margins: ExpandMargins }): ExpandPlan {
  if (form.ratio === 'free') {
    const add = (pct: number, len: number) => Math.round((Math.max(0, pct) / 100) * len);
    const m = form.margins;
    const left = add(m.left, src.width);
    const right = add(m.right, src.width);
    const top = add(m.top, src.height);
    const bottom = add(m.bottom, src.height);
    return finish(src, src.width + left + right, src.height + top + bottom, left, top);
  }
  const [rw, rh] = form.ratio.split(':').map(Number) as [number, number];
  const r = rw / rh;
  let width = src.width;
  let height = src.height;
  if (src.width / src.height < r) width = Math.round(src.height * r);
  else height = Math.round(src.width / r);
  const col = form.anchor.includes('left') ? 0 : form.anchor.includes('right') ? 2 : 1;
  const row = form.anchor.includes('top') ? 0 : form.anchor.includes('bottom') ? 2 : 1;
  return finish(src, width, height, Math.round(((width - src.width) * col) / 2), Math.round(((height - src.height) * row) / 2));
}

function finish(src: { width: number; height: number }, width: number, height: number, x: number, y: number): ExpandPlan {
  const added = { left: x, top: y, right: width - src.width - x, bottom: height - src.height - y };
  return {
    width,
    height,
    x,
    y,
    added,
    same: width === src.width && height === src.height,
    tooLarge: width > EXPAND_MAX_SIDE || height > EXPAND_MAX_SIDE,
    staged: (added.left + added.right) / src.width > 1 || (added.top + added.bottom) / src.height > 1,
  };
}

/* ---------- 表单 ---------- */

export interface ImageEditForm {
  method: EditImageMethod;
  scale: UpscaleImageScale;
  model: UpscaleImageModel;
  prompt: string;
  /** 笔刷半径（原图像素）。 */
  brush: number;
  ratio: ExpandRatio;
  anchor: EditImageAnchor;
  margins: ExpandMargins;
  /** 选的图像模型（`ToolModelOption.key`）；null 时按出厂顺序挑。 */
  engine: string | null;
}

/** 草稿：来源图跨工具共用（换工具时跟着走）；表单与选区按工具各一份。 */
export interface ImageEditDraft {
  sources: ImageSource[];
  forms: Partial<Record<ImageEditTool, ImageEditForm>>;
  selections: Partial<Record<ImageEditTool, Selection>>;
  outDir: string | null;
}

export const BLANK_IMAGE_EDIT: ImageEditDraft = { sources: [], forms: {}, selections: {}, outDir: null };

/** 空表单；`editReady` 为 false（没有能改图的模型）时能快速填充的工具缺省快速填充。 */
export function blankForm(op: ImageEditTool, editReady = true): ImageEditForm {
  const o = imageEditOp(op);
  const method: EditImageMethod = !editReady && o.methods.includes('fill') ? 'fill' : (o.methods[0] ?? 'fill');
  return { method, scale: 4, model: 'photo', prompt: '', brush: 48, ratio: '16:9', anchor: 'center', margins: { left: 25, top: 0, right: 25, bottom: 0 }, engine: null };
}

/** 这一页这个工具用的来源：单张的工具只取第一张。 */
export function sourcesFor(op: ImageEditTool, sources: readonly ImageSource[]): ImageSource[] {
  return imageEditOp(op).batch ? [...sources] : sources.slice(0, 1);
}

/**
 * 提交前的问题（第一条是页头那句话）。`esrgan` 是 Real-ESRGAN 现在能不能用；`modelReason` 是选的图像模型不能用的原因。
 */
export function imageEditProblems(
  op: ImageEditTool,
  form: ImageEditForm,
  sources: readonly ImageSource[],
  sel: Selection,
  ctx: { esrgan: 'ready' | 'missing' | 'checking'; modelReason: string | null },
): string[] {
  const o = imageEditOp(op);
  const src = sources[0];
  if (!src) return [o.batch ? M.pickImages : M.pickImage];
  const out: string[] = [];
  if (op === 'upscale') {
    const big = sources.find((s) => upscaleSize(s, form.scale, form.model).tooLarge);
    if (big) out.push(needsResize(form.model, form.scale) ? M.upscaleTooLargePeak(big.name, UPSCALE_MAX_SIDE) : M.upscaleTooLarge(big.name, form.scale, UPSCALE_MAX_SIDE));
    if (ctx.esrgan === 'missing') out.push(M.esrganMissing);
  }
  const stats = o.select ? selectionStats(sel, src) : null;
  if (o.select && !stats) out.push(o.select === 'box' ? M.markWatermark : op === 'repaint' ? M.paintRepaint : M.paintErase);
  if (stats && stats.coverage > MAX_COVERAGE) out.push(M.selectionTooLarge);
  if (o.prompt === 'required' && !form.prompt.trim()) out.push(M.promptRequired);
  if (op === 'expand') {
    const p = expandPlan(src, form);
    if (p.same) out.push(M.expandSame);
    else if (p.tooLarge) out.push(M.expandTooLarge(EXPAND_MAX_SIDE));
  }
  if (op !== 'upscale' && form.method === 'model' && ctx.modelReason) out.push(ctx.modelReason);
  return out;
}

const inputOf = (input: string) => {
  const entryId = entryIdOfInput(input);
  return entryId ? { entryId } : input;
};

/** 放大的提交参数（`upscale-image`）。 */
export function upscaleRequest(form: ImageEditForm, sources: readonly ImageSource[], outDir: string | null): UpscaleImageStartParams {
  return { inputs: sources.map((s) => inputOf(s.input)), scale: form.scale, model: form.model, ...(outDir ? { outDir } : {}) };
}

/**
 * 图片编辑的提交参数：选区四舍五入到整像素；扩图把百分比换成像素（Runtime 收像素）；`model` 补法带上选的 Provider 与模型。
 */
export function editRequest(
  op: EditImageOp,
  form: ImageEditForm,
  sources: readonly ImageSource[],
  sel: Selection,
  engine: { providerId: string; modelId: string } | null,
  outDir: string | null,
): EditImageStartParams {
  const o = imageEditOp(op);
  const src = sources[0]!;
  const mask: EditImageMask = {
    ...(sel.boxes.length ? { boxes: sel.boxes.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })) } : {}),
    ...(sel.strokes.length ? { strokes: sel.strokes.map((s) => ({ radius: Math.max(1, Math.round(s.radius)), points: s.points.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]) })) } : {}),
  };
  let expand: EditImageStartParams['expand'];
  if (op === 'expand') {
    if (form.ratio === 'free') {
      const p = expandPlan(src, form);
      expand = { margins: p.added };
    } else expand = { ratio: form.ratio, anchor: form.anchor };
  }
  return {
    inputs: sources.map((s) => inputOf(s.input)),
    ...(o.select ? { mask } : {}),
    ...(o.methods.length > 1 ? { method: form.method } : {}),
    ...(o.prompt !== 'none' && form.prompt.trim() ? { prompt: form.prompt.trim() } : {}),
    ...(expand ? { expand } : {}),
    ...(form.method === 'model' && engine ? { provider: engine.providerId, model: engine.modelId } : {}),
    ...(outDir ? { outDir } : {}),
  };
}

/** 流程名 → 工具。 */
export const IMAGE_EDIT_PIPELINES: Record<ImageEditTool, string> = {
  upscale: 'upscale-image',
  erase: 'remove-object',
  watermark: 'remove-watermark',
  repaint: 'repaint-image',
  expand: 'expand-image',
};

export function imageEditToolOfPipeline(name: string | undefined): ImageEditTool | null {
  const hit = (Object.entries(IMAGE_EDIT_PIPELINES) as Array<[ImageEditTool, string]>).find(([, p]) => p === name);
  return hit ? hit[0] : null;
}
