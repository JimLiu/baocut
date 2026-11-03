import {
  FOOTAGE_PIPELINE_NAMES,
  FOOTAGE_UPSCALE_SPECS,
  localizeText,
  pipelineStepLabel,
  type FootageColorMethod,
  type FootageInterpolateFactor,
  type FootageInterpolateMode,
  type FootageMatteModel,
  type FootageOp,
  type FootageStrength,
  type FootageSummary,
  type FootageUpscaleModel,
  type FootageUpscaleScale,
  type Id,
  type JobRecord,
  type ModelCapabilitiesView,
  type SeparateAudioStems,
  type ToolInputFacts,
  type ToolStatus,
} from '@baocut/protocol';
import { formatClock } from './format.ts';
import { intlLocale } from '@baocut/protocol';
import { jobPercent } from './task-list.ts';
import { entryIdOfInput, fileName, stepJob, transcodeProgress } from './tools-transcode.ts';
import { usableLocalCount, type ToolCardStatus } from './tools-gallery.ts';
import { FOOTAGE_TOOL_IDS, isFootageTool, type FootageToolId } from './tool-catalog.ts';
import { M } from './tools-footage-copy.ts';

/*
 * 素材处理六个工具的表单规则（设计稿 model-footage.js）：去抖、视频超分、插帧、统一色调、去除背景与分轨都是文件到文件，1–20 个输入各写成
 * 新文件，不动原文件、不建视频。参数、缺省值与上限照协议的 `FootageParams`、`SeparateAudioParams` 与流程 `footage.ts`。
 * 这里只算：每种处理的选项、一个输入的计划（帧数、输出尺寸与时长）、工作量（耗时与磁盘）、开始前的检查与提交的参数。
 */

export { FOOTAGE_TOOL_IDS, isFootageTool, type FootageToolId };
export type FootageInputKind = 'video' | 'image' | 'audio';

/** 工具 ID 就是流程名；`separate` 是分轨，别的是 `FootageOp`。 */
const OP_OF: Readonly<Record<FootageToolId, FootageOp | 'separate'>> = {
  [FOOTAGE_PIPELINE_NAMES.stabilize]: 'stabilize',
  [FOOTAGE_PIPELINE_NAMES.upscale]: 'upscale',
  [FOOTAGE_PIPELINE_NAMES.interpolate]: 'interpolate',
  [FOOTAGE_PIPELINE_NAMES['match-color']]: 'match-color',
  [FOOTAGE_PIPELINE_NAMES['remove-background']]: 'remove-background',
  'separate-audio': 'separate',
};
export const footageOp = (id: FootageToolId): FootageOp | 'separate' => OP_OF[id];

const ACCEPTS: Readonly<Record<FootageToolId, readonly FootageInputKind[]>> = {
  'stabilize-video': ['video'],
  'upscale-video': ['video'],
  'interpolate-video': ['video'],
  'match-color': ['video', 'image'],
  'remove-background': ['video', 'image'],
  'separate-audio': ['audio', 'video'],
};
export const acceptsKind = (id: FootageToolId, kind: ToolInputFacts['kind']): boolean => (ACCEPTS[id] as readonly string[]).includes(kind);
/** 选文件对话框的扩展名（同流程收的）。 */
export const FOOTAGE_EXTENSIONS: Readonly<Record<FootageInputKind, readonly string[]>> = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts', 'm2ts', 'ts', 'flv', 'wmv'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
};
export const extensionsFor = (id: FootageToolId): string[] => ACCEPTS[id].flatMap((kind) => [...FOOTAGE_EXTENSIONS[kind]]);

export const MAX_INPUTS = 20;
/** 同流程的 `MAX_OUTPUT_SIDE`、`MAX_INPUT_FRAMES`。 */
export const MAX_OUTPUT_SIDE = 7680;
export const MAX_INPUT_FRAMES = 216_000;

/* ---------- 受管工具 ---------- */

export const REALESRGAN = 'realesrgan-ncnn-vulkan';
export const RIFE = 'rife-ncnn-vulkan';
export const MATTE = 'matte-models';
export const MATTE_ISNET = 'matte-models-isnet';
export type ManagedFootageTool = typeof REALESRGAN | typeof RIFE | typeof MATTE | typeof MATTE_ISNET;

/** 目录卡片与下载卡上说的大小（清单的大小按平台略有出入，界面说「约」）。 */
export const MANAGED_SIZE: Readonly<Record<ManagedFootageTool, string>> = { [REALESRGAN]: '50 MB', [RIFE]: '430 MB', [MATTE]: '5 MB', [MATTE_ISNET]: '180 MB' };

/** 这一次要下载的受管工具（去抖、统一色调只用 ffmpeg；分轨用本机模型，走模型下载）。 */
export function managedToolsFor(id: FootageToolId, form: Pick<FootageForm, 'matteModel'>): ManagedFootageTool[] {
  const op = OP_OF[id];
  if (op === 'upscale') return [REALESRGAN];
  if (op === 'interpolate') return [RIFE];
  if (op === 'remove-background') return [form.matteModel === 'general' ? MATTE_ISNET : MATTE];
  return [];
}

/* ---------- 表单 ---------- */

export const STRENGTHS: readonly FootageStrength[] = ['low', 'medium', 'high'];
export const SCALES: readonly FootageUpscaleScale[] = [2, 3, 4];
export const UPSCALE_MODELS: readonly FootageUpscaleModel[] = ['video', 'photo', 'anime'];
export const FACTORS: readonly FootageInterpolateFactor[] = [2, 3, 4, 8];
export const MODES: readonly FootageInterpolateMode[] = ['slowmo', 'smooth'];
export const METHODS: readonly FootageColorMethod[] = ['hm-mkl-hm', 'mkl', 'reinhard', 'histogram'];
export const MATTE_MODELS: readonly FootageMatteModel[] = ['fast', 'general'];
export const STEMS: readonly SeparateAudioStems[] = ['vocals', 'four'];

export interface FootageForm {
  /** 只处理一段（`start`、`end`，秒）。 */
  ranged: boolean;
  start: number;
  end: number;
  strength: FootageStrength;
  scale: FootageUpscaleScale;
  model: FootageUpscaleModel;
  factor: FootageInterpolateFactor;
  mode: FootageInterpolateMode;
  /** 参考：本机路径或 `space:<entryId>`。 */
  reference: string | null;
  referenceAt: number | null;
  method: FootageColorMethod;
  amount: number;
  matteModel: FootageMatteModel;
  temporal: number;
  stems: SeparateAudioStems;
  /** 分离模型（`modelKeyOf`）；null 时按设置的默认。 */
  sepModel: string | null;
}

/** 缺省值照协议的注释。 */
export const BLANK_FOOTAGE_FORM: FootageForm = {
  ranged: false,
  start: 0,
  end: 10,
  strength: 'medium',
  scale: 2,
  model: 'video',
  factor: 2,
  mode: 'slowmo',
  reference: null,
  referenceAt: null,
  method: 'hm-mkl-hm',
  amount: 1,
  matteModel: 'fast',
  temporal: 0.3,
  stems: 'vocals',
  sepModel: null,
};

/** 六个工具的草稿：输入跟着走（换工具时它收的那几个还在）、事实只留在这次运行里，各工具的表单记住。 */
export interface FootageDraft {
  inputs: string[];
  /** `tools.inspectInputs` 读到的事实，按输入。 */
  facts: Record<string, ToolInputFacts>;
  forms: Partial<Record<FootageToolId, FootageForm>>;
  outDir: string | null;
}
export const BLANK_FOOTAGE: FootageDraft = { inputs: [], facts: {}, forms: {}, outDir: null };

export interface FootageSource {
  input: string;
  facts: ToolInputFacts;
}

/** 这个工具收的那几个输入（换工具时不收的留在草稿里，切回去还在）。 */
export function sourcesFor(id: FootageToolId, draft: Pick<FootageDraft, 'inputs' | 'facts'>): FootageSource[] {
  return draft.inputs.flatMap((input) => {
    const facts = draft.facts[input];
    return facts && acceptsKind(id, facts.kind) ? [{ input, facts }] : [];
  });
}

/* ---------- 文字 ---------- */

export const countText = (n: number): string => Math.round(n).toLocaleString(intlLocale());
export const fpsText = (fps: number): string => String(Math.round(fps * 100) / 100);

/** 中日文的句末标点（句号、叹号、问号、右引号）。 */
const FULL_WIDTH_END = /[\u3002\uFF01\uFF1F\u300D]$/;

/** 几句话接成一段：中日文的句号后面不留空格。 */
export function sentences(...parts: readonly string[]): string {
  return parts.reduce((text, part) => `${text}${FULL_WIDTH_END.test(text) ? '' : ' '}${part}`);
}

/** 一个区间的说法：「几秒」「不到 1 分钟」「不到 2 分钟」（快的电脑不到半分钟，不说「约 1–2 分钟」）「约 5–12 分钟」「约 1.5–4 小时」。 */
export function etaText(range: readonly [number, number]): string {
  const [lo, hi] = range;
  if (hi < 15) return M.etaSeconds;
  if (hi < 60) return M.etaUnderMinute;
  if (hi < 3600) {
    const to = Math.max(2, Math.round(hi / 60));
    return lo < 30 ? M.etaUnderMinutes(to) : M.etaMinutes(Math.round(lo / 60), to);
  }
  const hours = (v: number) => (v < 10 ? Math.round(v * 2) / 2 : Math.round(v));
  return M.etaHours(hours(Math.max(0.5, lo / 3600)), hours(hi / 3600));
}

/** 还要多久：「还要约 18 分钟」。 */
export function leftText(seconds: number): string {
  if (seconds < 60) return M.leftUnderMinute;
  if (seconds < 3600) return M.leftMinutes(Math.round(seconds / 60));
  return M.leftHours((seconds / 3600).toFixed(1));
}

/* ---------- 一个输入的计划 ---------- */

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export interface FootagePlan {
  kind: FootageInputKind;
  frames: number;
  outFrames: number;
  /** 这一段的秒数；图片是 null。 */
  seconds: number | null;
  outSeconds: number | null;
  outWidth: number;
  outHeight: number;
  fps: number | null;
  outFps: number | null;
}

/** 这个输入处理哪一段（秒）：图片、音频与「整段」都是全部；结束晚于文件时截到末尾。 */
export function rangeOf(form: Pick<FootageForm, 'ranged' | 'start' | 'end'>, facts: ToolInputFacts): { start: number; end: number; seconds: number } {
  const total = facts.durationSec ?? 0;
  if (!form.ranged || facts.kind !== 'video') return { start: 0, end: total, seconds: total };
  const start = Math.max(0, form.start || 0);
  const end = Math.min(form.end || 0, total);
  return { start, end, seconds: Math.max(0, end - start) };
}

/** 帧数、输出尺寸与时长；与流程 `planInput` 同一套算法：插帧整段输出 (帧数 − 1) × 倍数 + 1 张，边长取偶数。 */
export function planOf(id: FootageToolId, form: FootageForm, facts: ToolInputFacts): FootagePlan {
  const op = OP_OF[id];
  const width = facts.width ?? 0;
  const height = facts.height ?? 0;
  if (op === 'separate' || facts.kind === 'audio') {
    const seconds = facts.durationSec ?? 0;
    return { kind: facts.kind === 'video' ? 'video' : 'audio', frames: 0, outFrames: 0, seconds, outSeconds: seconds, outWidth: 0, outHeight: 0, fps: null, outFps: null };
  }
  if (facts.kind === 'image') return { kind: 'image', frames: 1, outFrames: 1, seconds: null, outSeconds: null, outWidth: width, outHeight: height, fps: null, outFps: null };
  const { seconds } = rangeOf(form, facts);
  const fps = facts.frameRate ?? 30;
  const frames = Math.max(1, Math.round(seconds * fps));
  const scale = op === 'upscale' ? form.scale : 1;
  const outWidth = even(width * scale);
  const outHeight = even(height * scale);
  if (op !== 'interpolate') return { kind: 'video', frames, outFrames: frames, seconds, outSeconds: seconds, outWidth, outHeight, fps, outFps: fps };
  const outFrames = (frames - 1) * form.factor + 1;
  const outFps = form.mode === 'smooth' ? fps * form.factor : fps;
  return { kind: 'video', frames, outFrames, seconds, outSeconds: outFrames / outFps, outWidth, outHeight, fps, outFps };
}

/** 超分的权重有没有这个原生倍数；没有时放大到 4 倍再缩（流程的做法）。 */
export const upscaleIsNative = (form: Pick<FootageForm, 'model' | 'scale'>): boolean => FOOTAGE_UPSCALE_SPECS[form.model].native.includes(form.scale);

/* ---------- 工作量 ----------
 * 下界是 M5 Max 上跑真实流程量的（2026-11，抠像用 release 构建）。那是一台很快的电脑，上界按别的电脑慢多少放宽：走显卡的（超分、插帧）
 * 放宽 4 倍以上，只在 CPU 上的（抠像、去抖、统一色调）放宽约 2.5 倍。vid.stab 没量过（这台电脑的 ffmpeg 不带 libvidstab），仍是估的。
 * 界面都写明是粗算；按帧处理的任务开始后按实际速度更新。
 */
const RATE = {
  /** 秒 / 帧 / 百万像素。 */
  stabilize: { vidstab: [0.012, 0.03], deshake: [0.008, 0.025] },
  upscale: { video: [0.1, 0.6], photo: [3.5, 14], anime: [1.1, 4.5] },
  interpolate: [0.02, 0.15],
  color: [0.004, 0.012],
  /** 秒 / 帧。 */
  matte: { fast: [0.25, 0.7], general: [1.1, 2.8] },
} as const;

/** 分离：处理时长 / 素材时长。HTDemucs-FT 是 M5 Max 上量的，别的是 audio.cpp 目录记的 M4 实测（80 秒样本）。实测的是下限，老一些的机器按 2.5 倍算。 */
function separateRate(modelId: string | null): [number, number] {
  const id = modelId ?? '';
  const base = /mel/i.test(id) ? 0.9 : /demucs/i.test(id) && !/ft/i.test(id) ? 0.21 : 0.65;
  return [base, base * 2.5];
}

/** 这台电脑的 ffmpeg 去抖用哪个滤镜；不知道时按 vid.stab 算（慢的那种）。 */
export type Stabilizer = 'vidstab' | 'deshake' | null;

function secondsOf(id: FootageToolId, form: FootageForm, plan: FootagePlan, stabilizer: Stabilizer, sepModel: string | null): [number, number] {
  const op = OP_OF[id];
  if (op === 'separate') {
    const [a, b] = separateRate(sepModel);
    return [(plan.seconds ?? 0) * a, (plan.seconds ?? 0) * b];
  }
  if (plan.kind === 'image') return op === 'remove-background' ? [...RATE.matte[form.matteModel]] : [1, 2];
  const scale = op === 'upscale' ? form.scale * form.scale : 1;
  const sourceMp = (plan.outWidth * plan.outHeight) / scale / 1e6;
  const by = (rate: readonly [number, number], frames: number): [number, number] => [rate[0] * frames * sourceMp, rate[1] * frames * sourceMp];
  if (op === 'stabilize') return by(RATE.stabilize[stabilizer === 'deshake' ? 'deshake' : 'vidstab'], plan.frames);
  if (op === 'upscale') return by(RATE.upscale[form.model], plan.frames);
  if (op === 'interpolate') return by(RATE.interpolate, plan.outFrames);
  if (op === 'match-color') return by(RATE.color, plan.frames);
  const rate = RATE.matte[form.matteModel];
  return [rate[0] * plan.frames, rate[1] * plan.frames];
}

/** 临时空间照 `footageDemand`（resource-profiles.ts）；分轨按输入大小的两倍估。 */
const STAGING_SLACK = 64 * 1024 * 1024;
function scratchOf(id: FootageToolId, plan: FootagePlan, inputBytes: number): number {
  const op = OP_OF[id];
  if (plan.kind === 'image') return STAGING_SLACK;
  if (op === 'separate' || op === 'stabilize' || op === 'match-color') return Math.round(inputBytes * 2 + STAGING_SLACK);
  const pixels = plan.outWidth * plan.outHeight;
  if (op === 'remove-background') return Math.round(plan.frames * pixels * 0.6 + STAGING_SLACK);
  return Math.round(pixels * 4 * (op === 'interpolate' ? 200 : 48) + inputBytes * 8 + STAGING_SLACK);
}

/** 输出体积是粗估：H.264 约每像素 0.01 字节，ProRes 4444 约每像素 0.6 字节，PNG 约每像素 1.6 字节，WAV 按 44.1 kHz 立体声。 */
function outBytesOf(id: FootageToolId, form: FootageForm, plan: FootagePlan, facts: ToolInputFacts): number {
  const op = OP_OF[id];
  if (op === 'separate') return Math.round((plan.seconds ?? 0) * 176400) * stemFiles(form.stems);
  if (plan.kind === 'image') return Math.round(plan.outWidth * plan.outHeight * 1.6);
  const pixels = plan.outWidth * plan.outHeight;
  if (op === 'remove-background') return Math.round(plan.frames * pixels * 0.6);
  if (op === 'upscale' || op === 'interpolate') return Math.round(plan.outFrames * pixels * 0.01);
  const whole = facts.durationSec ? (plan.seconds ?? 0) / facts.durationSec : 1;
  return Math.round((facts.bytes ?? plan.frames * pixels * 0.01) * whole);
}

/** 分轨一个输入写几个 WAV：人声与伴奏两个；四轨另加鼓、贝斯与其他。 */
export const stemFiles = (stems: SeparateAudioStems): number => (stems === 'four' ? 5 : 2);

export const LONG_SEC = 600;
export const VERY_LONG_SEC = 3600;

export interface FootageWorkload {
  plans: FootagePlan[];
  frames: number;
  outFrames: number;
  seconds: [number, number];
  outSeconds: number;
  audioSeconds: number;
  scratch: number;
  outBytes: number;
  /** 看偏慢的那一端：十分钟起提醒只处理用到的一段，一小时起加重。 */
  level: 'ok' | 'long' | 'veryLong';
  hasVideo: boolean;
}

export function workload(id: FootageToolId, form: FootageForm, srcs: readonly FootageSource[], stabilizer: Stabilizer, sepModel: string | null = null): FootageWorkload {
  const plans = srcs.map((s) => planOf(id, form, s.facts));
  const sum = (fn: (plan: FootagePlan, facts: ToolInputFacts) => number) => plans.reduce((n, p, i) => n + fn(p, srcs[i]!.facts), 0);
  const times = plans.map((p) => secondsOf(id, form, p, stabilizer, sepModel));
  const hi = times.reduce((n, t) => n + t[1], 0);
  const separate = OP_OF[id] === 'separate';
  return {
    plans,
    frames: sum((p) => p.frames),
    outFrames: sum((p) => p.outFrames),
    seconds: [times.reduce((n, t) => n + t[0], 0), hi],
    outSeconds: sum((p) => p.outSeconds ?? 0),
    audioSeconds: separate ? sum((p) => p.seconds ?? 0) : 0,
    scratch: sum((p, f) => scratchOf(id, p, f.bytes ?? 0)),
    outBytes: sum((p, f) => outBytesOf(id, form, p, f)),
    level: hi >= VERY_LONG_SEC ? 'veryLong' : hi >= LONG_SEC ? 'long' : 'ok',
    hasVideo: !separate && plans.some((p) => p.kind === 'video'),
  };
}

/** 输入一行：「0:42 · 1920×1080 · 30 fps · 1,260 帧」；图片、音频与 HDR 各说各的。 */
export function sourceLine(id: FootageToolId, form: FootageForm, src: FootageSource): string {
  const { facts } = src;
  const space = entryIdOfInput(src.input) ? [M.sourceSpace] : [];
  if (facts.kind === 'image') return [M.sourceImage(facts.width ?? 0, facts.height ?? 0), ...space].join(' · ');
  if (facts.kind === 'audio' || OP_OF[id] === 'separate') {
    return [formatClock(facts.durationSec ?? 0), ...(facts.hasAudio ? [] : [M.sourceNoAudio]), ...space].join(' · ');
  }
  const plan = planOf(id, form, facts);
  return [
    formatClock(facts.durationSec ?? 0),
    `${facts.width ?? 0}×${facts.height ?? 0}`,
    `${fpsText(facts.frameRate ?? 30)} fps`,
    ...(facts.hdr ? ['HDR'] : []),
    form.ranged ? M.sourceFramesInRange(countText(plan.frames)) : M.sourceFrames(countText(plan.frames)),
    ...space,
  ].join(' · ');
}

/* ---------- 开始前的检查（说法同 footage 的拒绝） ---------- */

/** 输入或选项本身过不去（HDR、超上限）：一选中就标出来。`sepModel`：选中的分离模型，只能分两轨时要拦。 */
export function footageBlockers(id: FootageToolId, form: FootageForm, srcs: readonly FootageSource[], sepModel?: { label: string; fourStems: boolean; usable: boolean } | null): string[] {
  const op = OP_OF[id];
  const out: string[] = [];
  if (op === 'separate') {
    const silent = srcs.find((s) => !s.facts.hasAudio);
    if (silent) out.push(M.inputNoAudio(silent.facts.name));
    if (form.stems === 'four' && sepModel?.usable && !sepModel.fourStems) out.push(M.stemsUnsupported(sepModel.label));
    return out;
  }
  const hdr = srcs.find((s) => s.facts.hdr);
  if (hdr) out.push(M.inputHdr(hdr.facts.name));
  if (form.ranged && srcs.length) {
    const image = srcs.find((s) => s.facts.kind === 'image');
    if (image) out.push(M.rangeOnImage(image.facts.name));
    if ((form.end || 0) <= (form.start || 0)) out.push(M.endBeforeStart);
    else {
      const short = srcs.find((s) => s.facts.kind === 'video' && rangeOf(form, s.facts).seconds <= 0);
      if (short) out.push(M.rangeEmpty(short.facts.name, (short.facts.durationSec ?? 0).toFixed(1)));
    }
  }
  for (const s of srcs) {
    if (s.facts.kind !== 'video') continue;
    const plan = planOf(id, form, s.facts);
    if (op === 'upscale' && (plan.outWidth > MAX_OUTPUT_SIDE || plan.outHeight > MAX_OUTPUT_SIDE)) {
      out.push(M.outputTooLarge(s.facts.name, plan.outWidth, plan.outHeight, MAX_OUTPUT_SIDE));
    }
    if (op === 'interpolate' && plan.frames < 2) out.push(M.tooFewFrames(s.facts.name));
    if ((op === 'upscale' || op === 'interpolate' || op === 'remove-background') && plan.frames > MAX_INPUT_FRAMES) {
      out.push(M.tooManyFrames(s.facts.name, countText(plan.frames), countText(MAX_INPUT_FRAMES)));
    }
  }
  return out;
}

/** 还差一步（选文件、选参考、下载）：按了开始才标。`missingTool`：没装好的受管工具，`modelReason`：分离模型的现状。 */
export function footageNextSteps(id: FootageToolId, form: FootageForm, srcs: readonly FootageSource[], ctx: { missingTool?: ManagedFootageTool | null; modelReason?: string | null }): string[] {
  const op = OP_OF[id];
  const out: string[] = [];
  if (!srcs.length) out.push(M.chooseFirst[id](MAX_INPUTS));
  if (op === 'separate') {
    if (ctx.modelReason) out.push(ctx.modelReason);
    return out;
  }
  if (op === 'match-color' && !form.reference) out.push(M.pickReference);
  if (ctx.missingTool) out.push(M.downloadFirst(M.toolName[ctx.missingTool], MANAGED_SIZE[ctx.missingTool]));
  return out;
}

/* ---------- 提交 ---------- */

const inputParam = (input: string): string | { entryId: Id } => {
  const entryId = entryIdOfInput(input);
  return entryId ? { entryId } : input;
};

/** `pipelines.start` 的参数：只带这种处理收的（流程给了别的直接拒绝）。 */
export function footageRequest(id: FootageToolId, form: FootageForm, srcs: readonly FootageSource[], outDir: string | null | undefined, separateModelId?: string | null): Record<string, unknown> {
  const inputs = srcs.map((s) => inputParam(s.input));
  const out = outDir ? { outDir } : {};
  const op = OP_OF[id];
  if (op === 'separate') return { inputs, stems: form.stems, ...(separateModelId ? { model: separateModelId } : {}), ...out };
  const base = { inputs, ...(form.ranged ? { start: form.start, end: form.end } : {}), ...out };
  switch (op) {
    case 'stabilize':
      return { ...base, strength: form.strength };
    case 'upscale':
      return { ...base, scale: form.scale, model: form.model };
    case 'interpolate':
      return { ...base, factor: form.factor, mode: form.mode };
    case 'match-color':
      return { ...base, reference: inputParam(form.reference ?? ''), ...(form.referenceAt !== null ? { referenceAt: form.referenceAt } : {}), method: form.method, amount: form.amount };
    case 'remove-background':
      return { ...base, matteModel: form.matteModel, temporal: form.temporal };
  }
}

/** 「再做一次 / 重试」：照这条任务的参数填表单（冻结的参数里输入都是路径）。 */
export function againFootage(job: Pick<JobRecord, 'pipeline'>, blank: FootageForm = BLANK_FOOTAGE_FORM): { inputs: string[]; form: FootageForm } | null {
  const params = job.pipeline?.params;
  if (!params || !Array.isArray(params.inputs)) return null;
  const inputs = params.inputs.filter((p): p is string => typeof p === 'string');
  const one = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const ranged = typeof params.start === 'number' || typeof params.end === 'number';
  return {
    inputs,
    form: {
      ...blank,
      ranged,
      start: num(params.start, 0),
      end: num(params.end, blank.end),
      strength: one(params.strength, STRENGTHS, blank.strength),
      scale: one(params.scale, SCALES, blank.scale),
      model: one(params.model, UPSCALE_MODELS, blank.model),
      factor: one(params.factor, FACTORS, blank.factor),
      mode: one(params.mode, MODES, blank.mode),
      reference: typeof params.reference === 'string' ? params.reference : null,
      referenceAt: typeof params.referenceAt === 'number' ? params.referenceAt : null,
      method: one(params.method, METHODS, blank.method),
      amount: num(params.amount, blank.amount),
      matteModel: one(params.matteModel, MATTE_MODELS, blank.matteModel),
      temporal: num(params.temporal, blank.temporal),
      stems: one(params.stems, STEMS, blank.stems),
    },
  };
}

/* ---------- 记录 ---------- */

export function footageToolOfJob(job: Pick<JobRecord, 'pipeline'>): FootageToolId | null {
  const name = job.pipeline?.name;
  return isFootageTool(name) ? name : null;
}

/** 六个工具的记录：这台电脑的界面提交的，去掉本机藏起来的，新的在前。 */
export function footageJobs(jobs: readonly JobRecord[], hidden: readonly Id[]): JobRecord[] {
  const skip = new Set(hidden);
  return jobs
    .filter((j) => j.kind === 'pipeline' && footageToolOfJob(j) !== null && j.submitter.kind === 'connection' && !skip.has(j.jobId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 记录的标题：第一个文件名，多个时「… 等 3 个」。 */
export function recordTitle(job: Pick<JobRecord, 'pipeline'>, fallback: string): string {
  const inputs = job.pipeline?.params.inputs;
  const first = Array.isArray(inputs) ? inputs[0] : undefined;
  const name = typeof first === 'string' ? fileName(first) : fallback;
  return Array.isArray(inputs) && inputs.length > 1 ? M.moreFiles(name, inputs.length - 1) : name;
}

/** 记录的第二行：这次的设置。参数是 Runtime 记下的，认不出的不写。 */
export function recordMeta(job: Pick<JobRecord, 'pipeline'>): string {
  const tool = footageToolOfJob(job);
  const again = againFootage(job);
  if (!tool || !again) return '';
  const f = again.form;
  switch (OP_OF[tool]) {
    case 'stabilize':
      return M.metaStrength(M.strengthLevel[f.strength]);
    case 'upscale':
      return `${f.scale}× · ${M.upscaleModel[f.model].name}`;
    case 'interpolate':
      return `${M.mode[f.mode].name} · ${f.factor}×`;
    case 'match-color':
      return M.metaReference(M.method[f.method].name, Math.round(f.amount * 100), f.reference ? fileName(f.reference) : '');
    case 'remove-background':
      return M.matte[f.matteModel].name;
    case 'separate':
      return M.stems[f.stems].name;
  }
}

export interface FootageProgress {
  text: string;
  percent: number | null;
}

/** 在跑那一行：处理那一步读子任务按帧的进度与实际速度「处理 · 1,240 / 5,400 帧 · 还要约 18 分钟」；别的步骤写步骤名与第几步。 */
export function recordProgress(job: Pick<JobRecord, 'pipeline' | 'phase' | 'progress'>, all: readonly JobRecord[], now: number): FootageProgress {
  const steps = job.pipeline?.steps ?? [];
  const index = job.pipeline?.current ?? null;
  const step = index !== null ? steps[index] : undefined;
  const child = step ? stepJob(job, all, step.name) : null;
  const p = child?.progress;
  if (step && child && p && p.unit === 'frames' && p.total && p.total > 0) {
    const percent = jobPercent(child);
    const started = child.startedAt ? Date.parse(child.startedAt) : NaN;
    const elapsed = (now - started) / 1000;
    // 刚开始的几秒不准：先不说还要多久。
    const left = Number.isFinite(elapsed) && elapsed >= 5 && p.done > 0 ? (elapsed / p.done) * (p.total - p.done) : null;
    return {
      text: [pipelineStepLabel(step), M.framesProgress(countText(p.done), countText(p.total)), ...(left !== null ? [leftText(left)] : [])].join(' · '),
      percent,
    };
  }
  const line = transcodeProgress(job, all);
  // 分轨按文件报进度，一个文件时中途没有值：不写 0%，那样进度条不动，看着像卡住了。
  if (p?.unit === 'units' && p.done === 0) return { text: line.text, percent: null };
  return { text: line.text, percent: child ? jobPercent(child) : line.percent };
}

/** 做完时的摘要：实际用的引擎与流程的提醒（去抖退回 deshake、插帧重影、慢动作没声音、没认出主体）。 */
export function recordSummary(job: Pick<JobRecord, 'pipeline'>): { executor: string | null; warnings: string[]; nonCommercial: boolean } {
  const summary = job.pipeline?.summary as Partial<FootageSummary> & { executor?: { modelId?: string; engine?: string; tool?: string; version?: string; weights?: string | null } } | null | undefined;
  const e = summary?.executor;
  const executor = !e ? null : e.modelId ? e.modelId : [e.engine, e.tool === 'ffmpeg' ? `ffmpeg ${e.version}` : e.version, e.weights].filter(Boolean).join(' · ') || null;
  const refs = Array.isArray(summary?.warningRefs) ? summary.warningRefs : [];
  // 提醒是 Runtime 按它的语言写的，有引用时按界面当前的语言重新生成。
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings.filter((w): w is string => typeof w === 'string').map((w, i) => localizeText(w, refs[i])) : [];
  return { executor, warnings, nonCommercial: job.pipeline?.params.matteModel === 'general' };
}

/* ---------- 目录卡片 ---------- */

/** 卡片的现状行：不能用时写原因；要下载的说第一次要下什么（`limitations` 里 `tool` 是没装好的那个）。 */
export function footageCardStatus(id: FootageToolId, status: ToolStatus | null | undefined, view: ModelCapabilitiesView | null, block: string | null | undefined): ToolCardStatus | null {
  const op = OP_OF[id];
  // 分轨缺的只是模型时不算不能用：工具页就地下载。
  const modelOnly = op === 'separate' && !!status?.problems.length && status.problems.every((p) => p.capability);
  if (block && !modelOnly) return { on: false, text: block };
  if (block === undefined) return null;
  if (op === 'separate') {
    const local = view ? usableLocalCount(view, 'separateAudio') : 0;
    const usable = view?.separateAudio.providers.flatMap((p) => p.models).find((m) => m.available !== false && !m.unavailableReason);
    return local && usable ? { on: true, text: M.cardReady(usable.label || usable.modelId) } : { on: false, text: M.cardSeparateMissing };
  }
  const tool = op === 'upscale' ? REALESRGAN : op === 'interpolate' ? RIFE : op === 'remove-background' ? MATTE : null;
  if (!tool) return { on: true, text: M.cardFfmpeg };
  const missing = status?.limitations.some((l) => l.tool === tool);
  return missing ? { on: false, text: M.cardFirstUse(M.toolName[tool], MANAGED_SIZE[tool]) } : { on: true, text: M.cardReady(M.toolName[tool]) };
}
