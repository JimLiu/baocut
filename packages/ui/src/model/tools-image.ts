import type {
  FrozenImageInput,
  GenerateImageRequest,
  Id,
  ImageInput,
  ImageInputMode,
  ImageModelInfo,
  JobProgress,
  JobRecord,
  ModelCapabilitiesView,
  SpaceEntry,
} from '@baocut/protocol';
import type { ImageCandidate } from './image-preview.ts';
import { formatClock } from './format.ts';
import { M } from './tools-image-copy.ts';
import {
  agentModelOptions,
  cloudModelOptions,
  codePoints,
  localModelOptions,
  localNotDownloaded,
  modelKeyOf,
  parseSeed,
  type ToolModelOption,
} from './tools-models.ts';

/**
 * 生成图片工作台（设计稿 tool-image.jsx、image-gen.jsx `ImageGenForm`、model-cloud-image.js 的云端与本机部分）：
 * 提示词、参考图（与它的用法、改动幅度）、模型、画幅、数量、种子，本机模型另有步数。局域网节点这一版没有后端，页面上置灰写原因。
 */

export type ImageOption = ToolModelOption<ImageModelInfo>;

export { localNotDownloaded };

/** 本机的文生图模型包：都列出来（没装的也列，选中时给下载卡），名字用模型的名字。 */
export function localImageOptions(view: ModelCapabilitiesView): ImageOption[] {
  return localModelOptions(view, 'generateImage');
}

/**
 * 生图的模型菜单，按出厂顺序（架构设计 §6.2，2026-10-12 用户裁决）：能画的 Codex › 本机（Turbo 在前）› 云端（已连接的在前，
 * OpenAI、Google Gemini 在前）；Codex 不能画时排到最后，照样列出、写原因。
 */
export function imageModelOptions(view: ModelCapabilitiesView): ImageOption[] {
  const agents = agentModelOptions(view, 'generateImage');
  return [
    ...agents.filter((o) => o.usable),
    ...localImageOptions(view),
    ...cloudModelOptions(view, 'generateImage'),
    ...agents.filter((o) => !o.usable),
  ];
}

/** 开页的回落（设计稿 `preferred`）：跳过要提醒的 Codex（不是订阅登录），与 Runtime 的出厂顺序一致。 */
export const imageFallback = (option: ImageOption): boolean => !option.caution;

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
  /** 「尺寸」那一行选的档（`1K`、`2K`…）；null 或这只模型在这个画幅下没有这一档时用画幅的默认尺寸那一档。 */
  tier: string | null;
  count: number;
  seed: string;
  /** 「高级」展开了没有。 */
  advanced: boolean;
  /** 本机模型的去噪步数；null 为模型的默认。 */
  steps: number | null;
  /** 参考图，按选的先后（架构设计 §6.1「生图的输入图」）。换到不认参考图的模型时留着，只是这次不送。 */
  refs: ImageRef[];
  /** 参考图怎么用：`ref` 一起送进去出图，`img2img` 以图为底重画（模型能时才有）。 */
  refMode: ImageInputMode;
  /** 以图为底重画的改动幅度；null 为模型的默认。 */
  strength: number | null;
}

/**
 * 一张参考图：Space 里的图片条目、这个视频的图片素材（只有编辑器里有），或桌面端从文件选、拖进来的本机文件。
 * 草稿会存进本机存储，所以这里只放引用与名字，缩略图在显示时取。
 */
export type ImageRef = ({ entryId: Id } | { assetId: Id } | { path: string }) & { name: string };

export const BLANK_IMAGE: ImageDraft = {
  prompt: '',
  model: null,
  size: null,
  tier: null,
  count: 1,
  seed: '',
  advanced: false,
  steps: null,
  refs: [],
  refMode: 'ref',
  strength: null,
};

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

/** 草稿的画幅在这只模型下成不成立；不成立时用模型的默认（默认尺寸对应的宽高比，或默认尺寸本身），再不行取第一项。
 *  草稿的 `size` 是某个宽高比下某一档的像素尺寸时（「再来一版」带回来的），落到那个宽高比。 */
export function sizeKeyFor(draft: Pick<ImageDraft, 'size'>, info: ImageModelInfo): string | null {
  const options = aspectOptions(info);
  if (!options.length) return null;
  if (draft.size && options.some((o) => o.key === draft.size)) return draft.size;
  const tiered = draft.size ? info.aspectRatios.find((a) => a.tiers?.some((t) => t.size === draft.size)) : undefined;
  if (tiered) return tiered.ratio;
  const def = info.defaultSize;
  const byDefault = def ? (info.aspectRatios.find((a) => a.size === def)?.ratio ?? (info.sizes.includes(def) ? def : null)) : null;
  return byDefault && options.some((o) => o.key === byDefault) ? byDefault : options[0]!.key;
}

// ---- 尺寸 ----

export interface SizeTierOption {
  /** 档名（`1K`、`2K`），模型没分档时是那个尺寸本身。 */
  key: string;
  /** 档名；模型没分档时 null（只写像素尺寸）。 */
  label: string | null;
  /** `WIDTHxHEIGHT`。 */
  size: string;
  /** 像素尺寸（`2752×1536`）。 */
  sub: string;
}

/**
 * 「尺寸」那一行（设计稿 image-gen.jsx `SizeRow`）：这只模型在这个画幅下的几档，从小到大。模型给了 `tiers` 就列它们，
 * 否则只有画幅的默认尺寸一档；没有可选画幅（Codex、由服务商定尺寸的）时为空，整行不画。
 */
export function sizeTierOptions(info: Pick<ImageModelInfo, 'aspectRatios' | 'sizes'>, aspectKey: string | null): SizeTierOption[] {
  if (!aspectKey) return [];
  const aspect = info.aspectRatios.find((a) => a.ratio === aspectKey);
  if (aspect?.tiers?.length) return aspect.tiers.map((t) => ({ key: t.tier, label: t.tier, size: t.size, sub: times(t.size) }));
  const size = aspect?.size ?? (info.sizes.includes(aspectKey) ? aspectKey : null);
  return size ? [{ key: size, label: null, size, sub: times(size) }] : [];
}

/** 草稿在这个画幅下落在哪一档：选过且这一档还在就用它，否则画幅默认尺寸那一档（再不行第一档）；没有可选的档时 null。 */
export function tierFor(draft: Pick<ImageDraft, 'size' | 'tier'>, info: ImageModelInfo, aspectKey: string | null): SizeTierOption | null {
  const tiers = sizeTierOptions(info, aspectKey);
  if (!tiers.length) return null;
  const picked =
    // 存下来的旧草稿没有 `tier`（undefined），与 null 同样处理。
    tiers.find((t) => draft.tier != null && t.key === draft.tier) ?? (draft.tier == null ? tiers.find((t) => t.size === draft.size) : undefined);
  if (picked) return picked;
  const def = info.aspectRatios.find((a) => a.ratio === aspectKey)?.size;
  return tiers.find((t) => t.size === def) ?? tiers[0]!;
}

/** 交给 Runtime 的 `size`：画幅默认那一档仍交宽高比（与以前相同），选了别的档时交那一档的像素尺寸。 */
export function requestSize(draft: Pick<ImageDraft, 'size' | 'tier'>, info: ImageModelInfo): string | null {
  const key = sizeKeyFor(draft, info);
  const tier = tierFor(draft, info, key);
  const def = info.aspectRatios.find((a) => a.ratio === key)?.size;
  return tier && def && tier.size !== def ? tier.size : key;
}

/** 状态行与记录里写的像素尺寸：草稿实际会出的那一档；不知道时 null。 */
function pixelSize(draft: Pick<ImageDraft, 'size' | 'tier'>, info: ImageModelInfo): string | null {
  const key = sizeKeyFor(draft, info);
  return tierFor(draft, info, key)?.size ?? key;
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

/** 步数固定的本机模型（蒸馏版，如 Qwen-Image-2.1 Turbo：`local.steps` 的 min === max）给那个步数，否则 null。
 *  界面对它不给步数输入框，只写「固定 N 步」（设计稿 image-gen.jsx 的「高级」）。 */
export function fixedSteps(info: Pick<ImageModelInfo, 'local'>): number | null {
  const range = info.local?.steps;
  return range && range.min === range.max ? range.min : null;
}

/** 换一只模型：画幅与张数回到这只认的范围，提示词、种子与参考图留着；不能以图为底重画的模型回到 `ref`。 */
export function switchImageModel(draft: ImageDraft, option: ImageOption): Partial<ImageDraft> {
  return {
    model: option.key,
    size: sizeKeyFor({ size: draft.size }, option.info),
    count: countFor(draft, option.info),
    ...(draft.refMode === 'img2img' && !option.info.img2img ? { refMode: 'ref' as const } : {}),
  };
}

// ---- 参考图（设计稿 model-cloud-image.js 的 `refMode` / `refModes` / `strengthOf` / `usedRefs` / `outputCount` / `refsNote`）----

/** 同一张参考图的键（去重、列表的 key）。 */
export function refKey(ref: ImageRef): string {
  return 'entryId' in ref ? `entry:${ref.entryId}` : 'assetId' in ref ? `asset:${ref.assetId}` : `file:${ref.path}`;
}

/** 把几张加进草稿：已经有的不重复加，最多加到 `room` 张。返回新的列表与没加进去的张数（超出上限的）。 */
export function addRefs(current: readonly ImageRef[], more: readonly ImageRef[], room: number): { refs: ImageRef[]; dropped: number } {
  const seen = new Set(current.map(refKey));
  const fresh = more.filter((r) => {
    const key = refKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const take = fresh.slice(0, Math.max(0, room));
  return { refs: [...current, ...take], dropped: fresh.length - take.length };
}

/** 还能再加几张（不认参考图的模型 0）。 */
export function refRoom(draft: Pick<ImageDraft, 'refs'>, info: Pick<ImageModelInfo, 'referenceImages'>): number {
  return info.referenceImages ? Math.max(0, info.referenceImages.max - draft.refs.length) : 0;
}

/** 这次真会送出去的参考图：模型不认就一张不送，认的按上限截。 */
export function usedRefs(draft: Pick<ImageDraft, 'refs'>, info: Pick<ImageModelInfo, 'referenceImages'>): ImageRef[] {
  return info.referenceImages ? draft.refs.slice(0, info.referenceImages.max) : [];
}

/** 草稿的用法在这只模型下成不成立：选了以图为底重画、模型也能时才是 `img2img`。 */
export function imageRefMode(draft: Pick<ImageDraft, 'refMode'>, info: Pick<ImageModelInfo, 'img2img'>): ImageInputMode {
  return draft.refMode === 'img2img' && info.img2img ? 'img2img' : 'ref';
}

/** 用法的几个选项：模型能以图为底重画时两个，否则一个（只有一个时界面不出这一行）。认编辑的模型第一项叫「按提示词改图」。 */
export function imageRefModes(info: Pick<ImageModelInfo, 'referenceImages' | 'img2img'>): Array<{ key: ImageInputMode; label: string }> {
  if (!info.referenceImages) return [];
  const first = { key: 'ref' as const, label: info.referenceImages.edit ? M.refModeEdit : M.refModeReference };
  return info.img2img ? [first, { key: 'img2img', label: M.refModeImg2img }] : [first];
}

/** 这次是不是按提示词改图：模型认编辑、草稿里有参考图、用法不是以图为底重画。这时提示词要写清怎么改，含糊的要求多半原样出图。 */
export function editsByPrompt(draft: Pick<ImageDraft, 'refs' | 'refMode'>, info: Pick<ImageModelInfo, 'referenceImages' | 'img2img'>): boolean {
  return !!info.referenceImages?.edit && draft.refs.length > 0 && imageRefMode(draft, info) === 'ref';
}

/** 改动幅度：草稿没给就用模型的默认值；模型不能以图为底重画时 null。 */
export function strengthFor(draft: Pick<ImageDraft, 'strength'>, info: Pick<ImageModelInfo, 'img2img'>): number | null {
  if (!info.img2img) return null;
  return draft.strength !== null && Number.isFinite(draft.strength) ? draft.strength : info.img2img.strength.default;
}

/** 这次出几张：以图为底重画按底图分组（每组一张），否则是表单的张数。 */
export function outputCount(draft: Pick<ImageDraft, 'count' | 'refs' | 'refMode'>, info: Pick<ImageModelInfo, 'maxCount' | 'referenceImages' | 'img2img'>): number {
  if (imageRefMode(draft, info) === 'img2img') return Math.max(1, Math.ceil(usedRefs(draft, info).length / info.img2img!.max));
  return countFor(draft, info);
}

/** 交给 Runtime 的一张输入图。 */
export function refInput(ref: ImageRef): ImageInput {
  return 'entryId' in ref ? { entryId: ref.entryId } : 'assetId' in ref ? { assetId: ref.assetId } : ref.path;
}

/**
 * 参考图那一行的说明（设计稿 `refsNote`）：认不认、上限几张、这次怎么用、送不送出这台电脑、超了几张。
 * 不认时用模型的名字说「谁不认」。
 */
export function refsNote(draft: Pick<ImageDraft, 'refs' | 'refMode'>, option: Pick<ImageOption, 'info' | 'local' | 'label'>): string {
  const info = option.info;
  const refs = info.referenceImages;
  const n = draft.refs.length;
  if (!refs) return n ? M.refsIgnored(option.label, n) : M.refsUnsupported(option.label);
  const used = Math.min(n, refs.max);
  const tail =
    imageRefMode(draft, info) === 'img2img'
      ? info.img2img!.max > 1
        ? M.refsGroup(info.img2img!.max)
        : used > 1
          ? M.refsEach(used)
          : M.refsBase
      : refs.edit
        ? option.local
          ? M.refsEditLocal
          : M.refsEdit
        : M.refsReference;
  return [M.refsMax(refs.max), tail, n ? (option.local ? M.refsLocal : M.refsUpload) : null, n > refs.max ? M.refsOver(n - refs.max) : null]
    .filter(Boolean)
    .join(' · ');
}

/** 计数「2 / 16」（不认参考图时 null）。 */
export function refsCount(draft: Pick<ImageDraft, 'refs'>, info: Pick<ImageModelInfo, 'referenceImages'>): { text: string; over: boolean } | null {
  const refs = info.referenceImages;
  return refs ? { text: `${draft.refs.length} / ${refs.max}`, over: draft.refs.length > refs.max } : null;
}

/** 冻结的输入图回到草稿里的参考图；`withAssets` 为 false 时（工具页没有视频）素材那几张不要。 */
export function refsFromFrozen(images: readonly FrozenImageInput[] | undefined, withAssets: boolean): { refs: ImageRef[]; dropped: number } {
  const refs: ImageRef[] = [];
  let dropped = 0;
  for (const image of images ?? []) {
    if (image.source === 'space' && image.entryId) refs.push({ entryId: image.entryId, name: image.name });
    else if (image.source === 'asset' && image.assetId && withAssets) refs.push({ assetId: image.assetId, name: image.name });
    else if (image.source === 'file' && image.path) refs.push({ path: image.path, name: image.name });
    else dropped++;
  }
  return { refs, dropped };
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
  const img2img = imageRefMode(draft, info) === 'img2img';
  if (!img2img && draft.count > info.maxCount) problems.push(M.maxImages(info.maxCount));
  // 不认参考图的模型：已选的这次不送，不算错（那一行写着）；认的才按上限报。
  if (info.referenceImages && draft.refs.length > info.referenceImages.max) problems.push(M.maxRefs(info.referenceImages.max));
  if (img2img) {
    if (!draft.refs.length) problems.push(M.img2imgNeedsBase);
    const range = info.img2img!.strength;
    if (draft.strength !== null && !(draft.strength >= range.min && draft.strength <= range.max)) problems.push(M.strengthRange(range.min, range.max));
  }
  if (info.acceptsSeed && !parseSeed(draft.seed).ok) problems.push(M.seedInteger);
  return problems;
}

/** `models.generateImage` 的参数：不导入任何视频。 */
export function imageRequest(draft: ImageDraft, option: ImageOption): Omit<GenerateImageRequest, 'commandId'> {
  const info = option.info;
  const size = requestSize(draft, info);
  const seed = parseSeed(draft.seed);
  const steps = stepsFor(draft, info);
  const refs = usedRefs(draft, info);
  const mode = imageRefMode(draft, info);
  const strength = mode === 'img2img' ? strengthFor(draft, info) : null;
  return {
    prompt: draft.prompt.trim(),
    provider: option.providerId,
    model: option.modelId,
    ...(size ? { size } : {}),
    count: outputCount(draft, info),
    ...(info.acceptsSeed && seed.ok && seed.seed !== null ? { seed: seed.seed } : {}),
    ...(steps !== null ? { steps } : {}),
    ...(refs.length ? { images: refs.map(refInput), imageMode: mode } : {}),
    ...(refs.length && strength !== null ? { strength } : {}),
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
  const size = pixelSize(draft, option.info);
  if (option.local) {
    // 耗时随机器差很多，这一版没有实测的每步耗时可查（设计稿 `statusLine` 没有实测时的那一句）。
    const steps = stepsFor(draft, option.info);
    return {
      text: [M.local, size ? times(size) : null, steps ? M.steps(steps) : null, M.deviceTime, M.offline].filter(Boolean).join(' · '),
      bad: false,
    };
  }
  const count = outputCount(draft, option.info);
  const refs = usedRefs(draft, option.info).length;
  return { text: [option.modelId, size ? times(size) : null, M.images(count), refs ? M.refsSent(refs) : null].filter(Boolean).join(' · '), bad: false };
}

/** 模型那一行右边的一句（设计稿 image-gen.jsx `ModelLine` 的 `m.desc`）：从能力描述里来——画幅几种、一次几张、收不收种子。 */
export function imageModelLine(info: ImageModelInfo): string {
  const aspects = aspectOptions(info).length;
  return [
    info.notes ?? null,
    aspects ? M.aspects(aspects) : M.providerSize,
    M.maxImages(info.maxCount),
    info.referenceImages ? M.maxRefs(info.referenceImages.max) : null,
    info.acceptsSeed ? M.takesSeed : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 页头那枚标签（设计稿 model-cloud-image.js `headerChip`）：走谁的服务。云端计费口径各家不同，只说「按用量计费」；
 * Codex 用订阅，不是订阅登录时如实说可能画不了。
 */
export function imageHeaderChip(option: Pick<ImageOption, 'provider' | 'local' | 'agent' | 'caution'> | null): string | null {
  if (!option) return null;
  if (option.local) return M.localChip;
  if (option.agent) return option.caution ? M.agentPaidChip(option.provider) : M.agentChip(option.provider);
  return M.cloudChip(option.provider);
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

/** 去噪按步的进度（本机生图）；别的进度、没有进度时 null。 */
function stepProgress(job: Pick<JobRecord, 'progress'>): (JobProgress & { total: number }) | null {
  const p = job.progress;
  return p && p.unit === 'steps' && p.total ? { ...p, total: p.total } : null;
}

/**
 * 本机生图在跑时的一句（设计稿 model-cloud-image.js `stepProgress` 的 `phase`）：去噪按步报（`steps`），写正在画的那一步
 * （开始报 0/N 时是第 1 步），步数走完是解码；本机还没有按步的进度时是加载模型（含编码提示词）。
 * 云端与局域网节点没有按步的进度，null，用通用的阶段说法。
 */
export function imageStepPhase(job: Pick<JobRecord, 'progress'> & Partial<Pick<JobRecord, 'providerId' | 'phase'>>): string | null {
  const p = stepProgress(job);
  if (p) return p.done >= p.total ? M.decoding : M.stepOf(Math.min(p.total, Math.max(0, p.done) + 1), p.total);
  return job.providerId === 'local' && job.phase === 'generating' ? M.loadingModel : null;
}

/** 正在解码：去噪的步数已经走完，进度条不定（这一段的耗时报不上来）。 */
export function imageDecoding(job: Pick<JobRecord, 'progress'>): boolean {
  const p = stepProgress(job);
  return !!p && p.done >= p.total;
}

/**
 * 预计还要多少秒走完剩下的步数（命令协议 §4.1 `progress.remainingSec`）：Runtime 按已走完各步的平均耗时推算，
 * 以记录的 `updatedAt` 为准，这里扣掉之后过去的时间（不小于 0）。还没走完一步、在解码、或不是本机按步的进度时 null。
 */
export function imageTimeLeft(job: Pick<JobRecord, 'state' | 'progress' | 'updatedAt'>, now: number): number | null {
  const p = stepProgress(job);
  if (job.state !== 'running' || !p || p.done >= p.total || typeof p.remainingSec !== 'number') return null;
  const since = Math.max(0, now - Date.parse(job.updatedAt)) / 1000;
  return Math.max(0, p.remainingSec - (Number.isFinite(since) ? since : 0));
}

/** 「剩余 0:12」；算不出时 null（与导出的剩余时间同一个写法，产品设计 §8.3）。 */
export function imageTimeLeftText(job: Pick<JobRecord, 'state' | 'progress' | 'updatedAt'>, now: number): string | null {
  const left = imageTimeLeft(job, now);
  return left === null ? null : M.timeLeft(formatClock(Math.ceil(left)));
}

/** 在跑时那一行时间（设计稿 `timeLine`）：「已用 0:08 · 剩余 0:12」；没有剩余只写已用（云端），还没开始跑时 null。 */
export function imageTimeLine(job: Pick<JobRecord, 'state' | 'progress' | 'updatedAt' | 'startedAt'>, now: number): string | null {
  if (job.state !== 'running' || !job.startedAt) return null;
  const elapsed = M.elapsed(formatClock(Math.max(0, now - Date.parse(job.startedAt)) / 1000));
  return [elapsed, imageTimeLeftText(job, now)].filter(Boolean).join(' · ');
}

/**
 * 放大查看的那一组图（设计稿 image-gen.jsx `ImageViewer`，与会话里的图片查看器共用）：页上做完的各批里已经收进 Space 的图，
 * 按页上的先后。还没收进 Space（或已经移到废纸篓）的图不在里面，也不给放大。
 */
export function imageGallery(jobs: readonly JobRecord[], entries: readonly SpaceEntry[]): ImageCandidate[] {
  return jobs.flatMap((job) =>
    job.state !== 'completed'
      ? []
      : imageResults(job).flatMap((r) => {
          const entry = entries.find((e) => !e.user.trashedAt && e.ref && 'artifactId' in e.ref && e.ref.artifactId === r.artifactId);
          return entry ? [{ target: { entryId: entry.id }, name: entry.name }] : [];
        }),
  );
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
    g?.imageMode === 'img2img' && g.strength !== undefined ? M.img2imgMeta(g.strength) : g?.images?.length ? M.refsSent(g.images.length) : null,
    g?.steps !== undefined ? M.steps(g.steps) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 「再来一版」：这一版的提示词与设置（含参考图与用法）回到表单，种子留空重新随机。以图为底重画那一批的张数是底图的组数，
 * 不带回「数量」。`withAssets` 为 false 时（工具页）视频素材那几张参考图带不回来，`dropped` 报几张。
 */
export function againDraft(job: JobRecord, withAssets = false): (Partial<ImageDraft> & { dropped: number }) | null {
  const g = job.generation?.capability === 'generateImage' ? job.generation : null;
  if (!g) return null;
  const { refs, dropped } = refsFromFrozen(g.images, withAssets);
  const img2img = g.imageMode === 'img2img';
  return {
    prompt: g.prompt,
    model: modelKeyOf(job.providerId, job.modelId),
    size: g.aspectRatio ?? g.size,
    tier: null,
    ...(img2img ? {} : { count: g.count }),
    seed: '',
    steps: g.steps ?? null,
    refs,
    refMode: g.imageMode ?? 'ref',
    strength: g.strength ?? null,
    dropped,
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
    ...(g.images?.length ? { images: g.images.map(frozenInput), imageMode: g.imageMode ?? 'ref' } : {}),
    ...(g.strength !== undefined ? { strength: g.strength } : {}),
  };
}

/** 冻结的输入图照原样再交一次：Space 条目与素材按 id（Runtime 重新读、重新冻结），本机文件按路径。 */
function frozenInput(image: FrozenImageInput): ImageInput {
  if (image.source === 'space' && image.entryId) return { entryId: image.entryId };
  if (image.source === 'asset' && image.assetId) return { assetId: image.assetId };
  return image.path;
}

/** 生图下载的文件名：「图片 1.png」按产物的类型取扩展名。 */
export function imageFileName(name: string, mediaType: string): string {
  const ext = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
  return `${name}.${ext}`;
}
