import type { BaoCutStepKind } from './agent-tool-steps.ts';
import type { StepKind } from './thread.ts';

/**
 * 会话线程「智能体在干活」的像素加载图形（PixelLoader，产品设计 §3.2.2 的「进行状态」）用哪几个图（原型 model-agent-loader.js）。
 * 这里只给图形的名字；视图按名字从 `@react-spectrum/ai/loader` 取像素格并按键缓存，保证数组引用不变
 * （PixelLoader 拿到新的数组引用就从第一个图重新播）。一个名字循环播；多个名字轮流播，每个图约 2.4 秒。
 *
 * 一个会话里最多两处在动：正在跑的那一步（按类别的短序列）与回合页脚「正在工作」前（`THINKING`）；
 * 工作组标题前是这一步类别的第一个图，静止；会话输入框不放动画。
 */

/** 随 @react-spectrum/ai 0.4.0 的全部图案类图形。字母类图形与含字母的预设拼的是第三方字标，不用。 */
export const ICONS = Object.freeze([
  'aiLogo',
  'brush',
  'eye',
  'hourglass',
  'mag',
  'crop',
  'flower',
  'image',
  'lasso',
  'page',
  'wand',
  'bargraph',
  'trefoil',
  'dial',
  'folder',
  'arrow',
  'cloud',
  'comment',
  'filter',
  'microphone',
  'pencil',
  'potion',
  'slider',
  'timeline',
  'eyedrop',
  'document',
  'graph',
  'cart',
  'shop',
  'journey',
  'floppy',
] as const);

export type LoaderIcon = (typeof ICONS)[number];

/** 通用序列，用到全部图形，aiLogo 打头；相邻两个图尽量不同类（声音、画面、文字、文件、数据交替出现）。 */
export const THINKING: readonly LoaderIcon[] = Object.freeze([
  'aiLogo',
  'wand',
  'microphone',
  'timeline',
  'image',
  'comment',
  'crop',
  'document',
  'mag',
  'brush',
  'cloud',
  'slider',
  'flower',
  'page',
  'dial',
  'eye',
  'lasso',
  'potion',
  'folder',
  'eyedrop',
  'graph',
  'pencil',
  'trefoil',
  'filter',
  'journey',
  'arrow',
  'bargraph',
  'shop',
  'hourglass',
  'cart',
  'floppy',
]);

/** 认不出的类别（以及通用的「其他工具」）。 */
export const FALLBACK: readonly LoaderIcon[] = Object.freeze(['aiLogo', 'flower', 'trefoil']);

/** 加载图形的键：通用步骤类别、BaoCut 工具的类别（agent-tool-steps.ts）与流式的思考行。 */
export type LoaderKind = StepKind | BaoCutStepKind | 'reasoning';

const seq = (...names: LoaderIcon[]): readonly LoaderIcon[] => Object.freeze(names);

/** 类别 → 2–4 个图的短序列。按类型穷举：新增步骤类别时这里编译不过，得给它挑图。 */
export const KINDS: Readonly<Record<LoaderKind, readonly LoaderIcon[]>> = Object.freeze({
  /* 通用类别 */
  command: seq('dial', 'potion', 'trefoil'),
  read: seq('document', 'page', 'eye'),
  edit: seq('pencil', 'brush', 'document'),
  search: seq('mag', 'filter', 'eye'),
  other: FALLBACK,
  reasoning: seq('aiLogo', 'flower', 'potion'),
  /* 声音与文字 */
  transcribe: seq('microphone', 'comment', 'page'),
  speech: seq('microphone', 'comment'),
  translate: seq('comment', 'page', 'document'),
  captions: seq('comment', 'page', 'timeline'),
  /* 画面 */
  image: seq('image', 'brush', 'wand', 'eyedrop'),
  /* 视频与时间线上的活 */
  'video-list': seq('folder', 'image', 'eye'),
  'video-create': seq('image', 'wand', 'timeline'),
  'video-read': seq('eye', 'image', 'timeline'),
  'video-delete': seq('folder', 'arrow'),
  cut: seq('timeline', 'crop', 'lasso'),
  'edit-video': seq('timeline', 'slider', 'wand', 'pencil'),
  undo: seq('journey', 'arrow', 'timeline'),
  /* 文稿与文件 */
  'document-read': seq('document', 'page', 'eye'),
  space: seq('folder', 'shop', 'cart'),
  'space-search': seq('mag', 'filter', 'folder'),
  /* 进出 */
  import: seq('cloud', 'arrow', 'folder'),
  download: seq('cloud', 'arrow', 'floppy'),
  'downloads-save': seq('floppy', 'folder'),
  export: seq('floppy', 'arrow', 'journey'),
  artifact: seq('floppy', 'folder', 'cart'),
  /* 任务、模型、技能与授权 */
  job: seq('hourglass', 'bargraph', 'graph'),
  models: seq('dial', 'graph', 'potion'),
  'model-install': seq('cloud', 'arrow', 'dial'),
  skill: seq('page', 'potion', 'wand'),
  grant: seq('hourglass', 'dial'),
  contract: seq('document', 'pencil', 'page'),
});

/** 类别 → 图形名序列；认不出的走 FALLBACK。同一个类别每次返回同一个（冻结的）数组。 */
export function forKind(kind: string): readonly LoaderIcon[] {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as LoaderKind] : FALLBACK;
}
