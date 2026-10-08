import type { GenerateImageRequest, ImageModelInfo, JobRecord, ModelCapabilitiesView } from '@baocut/protocol';
import { M } from './tools-image-copy.ts';
import { cloudModelOptions, codePoints, localModelOptions, localNotDownloaded, modelKeyOf, parseSeed, type ToolModelOption } from './tools-models.ts';

/**
 * 生成图片工作台（设计稿 tool-image.jsx、image-gen.jsx `ImageGenForm`、model-cloud-image.js 的云端与本机部分）：
 * 提示词、模型、画幅、数量、种子，本机模型另有步数。参考图、局域网节点这一版没有后端，页面上置灰写原因；Codex 画图在会话里用。
 */

export type ImageOption = ToolModelOption<ImageModelInfo>;

export { localNotDownloaded };

/** 本机的文生图模型包：都列出来（没装的也列，选中时给下载卡），名字用模型的名字。 */
export function localImageOptions(view: ModelCapabilitiesView): ImageOption[] {
  return localModelOptions(view, 'generateImage');
}

/** 生图的模型菜单：云端在前、本机在后（设计稿的三组里 Codex 这一版不在工具页）。 */
export function imageModelOptions(view: ModelCapabilitiesView): ImageOption[] {
  return [...cloudModelOptions(view, 'generateImage'), ...localImageOptions(view)];
}

/** 开页的回落只落到云端（设计稿 `preferred`）：本机模型要用户自己选或设为默认。 */
export const imageFallback = (option: ImageOption): boolean => !option.local;

/** 没写提示词时那一句（设计稿 model-cloud-image.js `EMPTY_PROMPT`）。 */
export function emptyPrompt(): string {
  return M.emptyPrompt;
}

/** 「填一句示例」轮着给（设计稿 image-gen.jsx `SAMPLES`）：中英两种提示词混着给，不随界面语言变。 */
// i18n-ignore-start: 示例提示词有意中英混排，展示两种语言都能写
export const IMAGE_SAMPLES = [
  'A paper crane on a wooden desk, soft morning light, shallow depth of field',
  '一间明亮的播客工作室，木质桌面上放着麦克风与一杯咖啡，插画风格，暖色',
  'Flat vector illustration of a cheerful robot holding a video camera, pastel palette, white background',
  '水墨风格的山间小路，晨雾，留白',
] as const;
// i18n-ignore-end

export interface ImageDraft {
  prompt: string;
  /** `providerId/modelId`；null 为还没选。 */
  model: string | null;
  /** 画幅：宽高比 `W:H` 或尺寸 `WIDTHxHEIGHT`；null 为模型的默认。 */
  size: string | null;
  count: number;
  seed: string;
  /** 「高级」展开了没有。 */
  advanced: boolean;
  /** 本机模型的去噪步数；null 为模型的默认。 */
  steps: number | null;
}

export const BLANK_IMAGE: ImageDraft = { prompt: '', model: null, size: null, count: 1, seed: '', advanced: false, steps: null };

// ---- 画幅 ----

export interface AspectOption {
  /** 交给 Runtime 的 `size`：宽高比或尺寸。 */
  key: string;
  /** 宽高比（`16:9`）。 */
  label: string;
  /** 像素尺寸（`1792×1024`）；不知道时 null。 */
  sub: string | null;
  /** 示意框的宽高比（宽 / 高）。 */
  ratio: number;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function parseSize(size: string): [number, number] | null {
  const m = /^(\d+)x(\d+)$/i.exec(size);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** `1536x1024` → `3:2`。 */
export function ratioOfSize(size: string): string {
  const wh = parseSize(size);
  if (!wh) return size;
  const d = gcd(wh[0], wh[1]) || 1;
  return `${wh[0] / d}:${wh[1] / d}`;
}

function ratioNumber(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w && h ? w / h : 1;
}

const times = (size: string) => size.replace(/x/i, '×');

/** 画幅选项：模型给了宽高比就列宽高比（带它的默认尺寸），否则列它收的尺寸。都没有时为空（尺寸由供应商定）。 */
export function aspectOptions(info: Pick<ImageModelInfo, 'aspectRatios' | 'sizes'>): AspectOption[] {
  if (info.aspectRatios.length) {
    return info.aspectRatios.map((a) => ({ key: a.ratio, label: a.ratio, sub: times(a.size), ratio: ratioNumber(a.ratio) }));
  }
  return info.sizes.map((size) => ({ key: size, label: ratioOfSize(size), sub: times(size), ratio: ratioNumber(ratioOfSize(size)) }));
}

/** 草稿的画幅在这只模型下成不成立；不成立时用模型的默认（默认尺寸对应的宽高比，或默认尺寸本身），再不行取第一项。 */
export function sizeKeyFor(draft: Pick<ImageDraft, 'size'>, info: ImageModelInfo): string | null {
  const options = aspectOptions(info);
  if (!options.length) return null;
  if (draft.size && options.some((o) => o.key === draft.size)) return draft.size;
  const def = info.defaultSize;
  const byDefault = def ? (info.aspectRatios.find((a) => a.size === def)?.ratio ?? (info.sizes.includes(def) ? def : null)) : null;
  return byDefault && options.some((o) => o.key === byDefault) ? byDefault : options[0]!.key;
}

export function countFor(draft: Pick<ImageDraft, 'count'>, info: Pick<ImageModelInfo, 'maxCount'>): number {
  return Math.min(Math.max(1, info.maxCount), Math.max(1, Math.round(draft.count) || 1));
}

/** 本机模型的步数：草稿的（夹进范围），没有时模型的默认；不收步数的模型 null。 */
export function stepsFor(draft: Pick<ImageDraft, 'steps'>, info: Pick<ImageModelInfo, 'local'>): number | null {
  const range = info.local?.steps;
  if (!range) return null;
  if (draft.steps === null || !Number.isFinite(draft.steps)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(draft.steps)));
}

/** 换一只模型：画幅与张数回到这只认的范围，提示词与种子留着。 */
export function switchImageModel(draft: ImageDraft, option: ImageOption): Partial<ImageDraft> {
  return { model: option.key, size: sizeKeyFor({ size: draft.size }, option.info), count: countFor(draft, option.info) };
}

// ---- 校验与请求 ----

export function imageProblems(draft: ImageDraft, option: ImageOption | null): string[] {
  const problems: string[] = [];
  const prompt = draft.prompt.trim();
  if (!prompt) problems.push(M.emptyPrompt);
  if (!option) return problems;
  const info = option.info;
  const n = codePoints(prompt);
  if (n > info.maxPromptChars) problems.push(M.promptTooLong(n, info.maxPromptChars));
  if (draft.count > info.maxCount) problems.push(M.maxImages(info.maxCount));
  if (info.acceptsSeed && !parseSeed(draft.seed).ok) problems.push(M.seedInteger);
  return problems;
}

/** `models.generateImage` 的参数：不导入任何视频。 */
export function imageRequest(draft: ImageDraft, option: ImageOption): Omit<GenerateImageRequest, 'commandId'> {
  const info = option.info;
  const size = sizeKeyFor(draft, info);
  const seed = parseSeed(draft.seed);
  const steps = stepsFor(draft, info);
  return {
    prompt: draft.prompt.trim(),
    provider: option.providerId,
    model: option.modelId,
    ...(size ? { size } : {}),
    count: countFor(draft, info),
    ...(info.acceptsSeed && seed.ok && seed.seed !== null ? { seed: seed.seed } : {}),
    ...(steps !== null ? { steps } : {}),
  };
}

/** 主按钮旁那句（设计稿 image-gen.jsx `statusOf`）。 */
export function imageStatus(draft: ImageDraft, option: ImageOption | null, tried: boolean): { text: string; bad: boolean } {
  if (!option) return { text: M.pickModel, bad: true };
  if (!option.usable) {
    if (option.local)
      return { text: option.why === localNotDownloaded() ? M.downloadFirst(option.label) : `${option.label} · ${option.why}`, bad: true };
    return { text: option.connected ? `${option.provider} · ${option.why}` : M.connectFirst(option.provider), bad: true };
  }
  const empty = M.emptyPrompt;
  const problem = imageProblems(draft, option).find((p) => tried || p !== empty);
  if (problem) return { text: problem, bad: true };
  const size = sizeKeyFor(draft, option.info);
  if (option.local) {
    // 耗时随机器差很多，这一版没有实测的每步耗时可查（设计稿 `statusLine` 没有实测时的那一句）。
    const steps = stepsFor(draft, option.info);
    return {
      text: [M.local, size ? times(size) : null, steps ? M.steps(steps) : null, M.deviceTime, M.offline].filter(Boolean).join(' · '),
      bad: false,
    };
  }
  const count = countFor(draft, option.info);
  return { text: [option.modelId, size ? times(size) : null, M.images(count)].filter(Boolean).join(' · '), bad: false };
}

/** 模型那一行右边的一句（设计稿 image-gen.jsx `ModelLine` 的 `m.desc`）：从能力描述里来——画幅几种、一次几张、收不收种子。 */
export function imageModelLine(info: ImageModelInfo): string {
  const aspects = aspectOptions(info).length;
  return [
    info.notes ?? null,
    aspects ? M.aspects(aspects) : M.providerSize,
    M.maxImages(info.maxCount),
    info.acceptsSeed ? M.takesSeed : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 页头那枚标签（设计稿 model-cloud-image.js `headerChip`）：走谁的服务。计费口径各家不同，只说「按用量计费」。 */
export function imageHeaderChip(option: Pick<ImageOption, 'provider' | 'local'> | null): string | null {
  if (!option) return null;
  return option.local ? M.localChip : M.cloudChip(option.provider);
}

// ---- 记录 ----

export interface ImageResult {
  artifactId: string;
  width: number;
  height: number;
  /** 「图片 1」。 */
  name: string;
  /** 「1024×1024 · 种子 42」（没有种子时只写尺寸）。 */
  meta: string;
}

/** 生成好的图（只取图片输出）。 */
export function imageResults(job: JobRecord): ImageResult[] {
  const g = job.generation?.capability === 'generateImage' ? job.generation : null;
  const seed = g?.seed ?? null;
  return (job.result?.outputs ?? []).flatMap((o, i) =>
    o.media.kind === 'image'
      ? [
          {
            artifactId: o.artifactId,
            width: o.media.width,
            height: o.media.height,
            name: M.imageName(i + 1),
            meta: [`${o.media.width}×${o.media.height}`, seed !== null ? M.seed(seed) : null].filter(Boolean).join(' · '),
          },
        ]
      : [],
  );
}

/**
 * 本机生图在跑时的一句（设计稿 model-cloud-image.js `phase` 的本机分支）：去噪按步报（`steps`），步数走完是解码。
 * 没有按步的进度（云端，或本机还在加载模型、编码提示词）时 null，用通用的阶段说法。
 */
export function imageStepPhase(job: Pick<JobRecord, 'progress'>): string | null {
  const p = job.progress;
  if (!p || p.unit !== 'steps' || !p.total) return null;
  return p.done >= p.total ? M.decoding : M.stepOf(Math.max(1, p.done), p.total);
}

/** 生图任务的提示词。 */
export function imagePrompt(job: Pick<JobRecord, 'generation'>): string {
  return job.generation?.capability === 'generateImage' ? job.generation.prompt : '';
}

/** 一批结果的小标题（设计稿 `IM.recordMeta`）：「OpenAI · gpt-image-1 · 16:9 · 2 张」。 */
export function imageBatchMeta(job: JobRecord, provider: string): string {
  const g = job.generation?.capability === 'generateImage' ? job.generation : null;
  return [
    `${provider} · ${job.modelId}`,
    g ? (g.aspectRatio ?? (g.size ? times(g.size) : null)) : null,
    g ? M.images(g.count) : null,
    g?.steps !== undefined ? M.steps(g.steps) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 「再来一版」：这一版的提示词与设置回到表单，种子留空重新随机。 */
export function againDraft(job: JobRecord): Partial<ImageDraft> | null {
  const g = job.generation?.capability === 'generateImage' ? job.generation : null;
  if (!g) return null;
  return {
    prompt: g.prompt,
    model: modelKeyOf(job.providerId, job.modelId),
    size: g.aspectRatio ?? g.size,
    count: g.count,
    seed: '',
    steps: g.steps ?? null,
  };
}

/** 「再试一次」：照冻结的参数原样再提交一次（同一个 Provider 与模型）。 */
export function retryRequest(job: JobRecord): Omit<GenerateImageRequest, 'commandId'> | null {
  const g = job.generation?.capability === 'generateImage' ? job.generation : null;
  if (!g) return null;
  const size = g.aspectRatio ?? g.size;
  return {
    prompt: g.prompt,
    provider: job.providerId,
    model: job.modelId,
    ...(size ? { size } : {}),
    count: g.count,
    format: g.format,
    ...(g.seed !== null ? { seed: g.seed } : {}),
    ...(g.steps !== undefined ? { steps: g.steps } : {}),
  };
}

/** 生图下载的文件名：「图片 1.png」按产物的类型取扩展名。 */
export function imageFileName(name: string, mediaType: string): string {
  const ext = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
  return `${name}.${ext}`;
}
