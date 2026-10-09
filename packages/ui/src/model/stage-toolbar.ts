import { live, type ArrangeDirection, type AssetRecord, type BrandMediaKind, type Id, type LibrarySource } from '@baocut/protocol';
import { asObject } from '../render/text-style.ts';
import { assetLibrarySource, brandKindForAsset } from './library-brand.ts';
import { editableTextStyle } from './property-values.ts';
import type { PlacedItem, Rect } from './stage-pose.ts';
import { M, type StageToolbarMessages } from './stage-toolbar-copy.ts';

/**
 * 画布浮动工具条的规则（原型 model-toolbar.js 的 `BC_BAR` 与 stage-toolbar.jsx）：选中一件画面上的片段时，
 * 条子上按分组摆哪些格、溢出菜单（⋯）里有哪些，每一格做什么。
 *
 * 分组照原型的配置表逐项摆（组间画竖分隔线；菜单里嵌套的一组是一行图标钮），这里再给每一格落到 BaoCut 的写法：
 * 开弹层改值（与属性页同一条写入：拖动中只叠草稿，松手一笔提交）、菜单里下钻一层、开关、一下就提交的命令、
 * 跳到属性页的某一节，或者写明为什么还不能用（协议里没有对应的操作）。条子只管画，不再按类型手写第二遍。
 */

/**
 * 条子按哪一类摆（原型的 kind；合成按内置生成器分）。认不出的合成退回一颗「属性」。
 * `subtitle` 是字幕的条子（字幕不是画面上的片段，见 `captionToolbar`）。
 */
export type BarKind =
  | 'text'
  | 'video'
  | 'image'
  | 'shape'
  | 'sticker'
  | 'progress'
  | 'wave'
  | 'counter'
  | 'confetti'
  | 'whiteboard'
  | 'subtitle'
  | 'other';

export type ToolId =
  | 'color'
  | 'font'
  | 'size'
  | 'text-styles'
  | 'animation'
  | 'transitions'
  | 'volume'
  | 'speed'
  | 'adjust'
  | 'border'
  | 'fill-list'
  | 'progress-colors'
  | 'progress-picker'
  | 'wave-colors'
  | 'wave-picker'
  | 'counter-mode'
  | 'volume-levels'
  | 'properties'
  | 'copy'
  | 'arrange'
  | 'save-to-brand-kit'
  | 'adjust-timing'
  | 'delete'
  | 'bold'
  | 'italic'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'line-height'
  | 'letter-spacing'
  | 'flip-vertical'
  | 'flip-horizontal'
  | 'fit-canvas'
  | 'fill-canvas'
  | 'opacity'
  | 'round-corners'
  | 'filters'
  | 'effects'
  | 'crop-video'
  | 'replace-video'
  | 'replace-image'
  | 'detach-audio'
  | 'sub-scope'
  | 'sub-edit'
  | 'sub-style'
  | 'sub-animation'
  | 'case'
  | 'hide-subs';

/**
 * 每一格的显示名（原型 `ITEM`）。图标钮的名字是悬停提示。
 * 「copy」原型写「复制」，意思是再造一份（⌘D）；这里「复制」已经是 ⌘C 放进剪贴板，所以写「复制一份」（原型多选页的说法）。
 */
export const TOOL_LABEL: Record<ToolId, string> = live(() => M.toolLabel);

/** 配置表的一段：一组格；菜单里的一段若是嵌套数组，就是一行图标钮（行内再分簇）。 */
type Group = ToolId[];
type Row = ToolId[][];
interface Layout {
  visible: Group[];
  more?: (Group | Row)[];
}

const FLIP_FIT: Row = [
  ['flip-vertical', 'flip-horizontal'],
  ['fit-canvas', 'fill-canvas'],
];

/** 原型 `BAR` 里与画面上的片段对得上的几类，分组与次序逐项照抄（模板、文本组等 BaoCut 画布上没有；字幕见 `SUBTITLE_BAR`）。 */
export const BAR: Record<Exclude<BarKind, 'other' | 'subtitle'>, Layout> = {
  text: {
    visible: [
      ['color', 'font', 'size'],
      ['text-styles', 'animation'],
    ],
    more: [
      [
        ['bold', 'italic'],
        ['align-left', 'align-center', 'align-right'],
      ],
      ['line-height', 'letter-spacing'],
      ['copy', 'arrange', 'save-to-brand-kit'],
      ['properties'],
      ['adjust-timing', 'delete'],
    ],
  },
  video: {
    visible: [
      ['animation', 'transitions'],
      ['volume', 'speed'],
    ],
    more: [
      FLIP_FIT,
      ['opacity', 'round-corners'],
      ['filters', 'effects', 'adjust'],
      ['copy', 'arrange'],
      ['adjust-timing', 'crop-video', 'replace-video', 'detach-audio', 'save-to-brand-kit', 'delete'],
    ],
  },
  image: {
    visible: [['animation'], ['adjust']],
    more: [FLIP_FIT, ['opacity', 'round-corners'], ['copy', 'arrange'], ['adjust-timing', 'replace-image', 'save-to-brand-kit', 'delete']],
  },
  shape: {
    visible: [['color'], ['border'], ['animation']],
    more: [FLIP_FIT, ['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
  },
  sticker: {
    visible: [['fill-list'], ['animation']],
    more: [FLIP_FIT, ['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
  },
  progress: {
    visible: [['progress-colors'], ['progress-picker'], ['animation']],
    more: [
      ['copy', 'arrange'],
      ['adjust-timing', 'delete'],
    ],
  },
  wave: {
    visible: [['wave-colors'], ['wave-picker'], ['animation']],
    more: [['volume-levels'], ['copy', 'arrange'], ['adjust-timing', 'delete']],
  },
  counter: {
    visible: [['counter-mode'], ['color', 'font', 'size'], ['animation']],
    more: [
      [
        ['bold', 'italic'],
        ['align-left', 'align-center', 'align-right'],
      ],
      ['copy', 'arrange'],
      ['properties'],
      ['adjust-timing', 'delete'],
    ],
  },
  // 彩纸与白板手绘：颜色、形状、手、纸都在专属属性页，条子上只留动画；已铺满画面，不做翻转与适配画布。
  confetti: {
    visible: [['animation']],
    more: [['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
  },
  whiteboard: {
    visible: [['animation']],
    more: [['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
  },
};

/**
 * 字幕的条子（原型 `BAR.subtitle`）：最前是换一行来编辑（双语两行时），然后是颜色 字体 字号，
 * 再是 Edit / Styles / Animation；菜单是 B / I 与三对齐加大小写、行高与字距、存到品牌库与隐藏字幕。没有删除：
 * 字幕的内容真相在转录文档里，画布上只给隐藏。
 *
 * 原型第一段里的「全部字幕 / 仅这一条」（`sub-cue-scope`）与菜单里的「应用到所有字幕」（`apply-style-to-global`）不摆：
 * 视频格式的字幕样式是一整份文档，没有逐条的覆盖可写（同 caption-presets.ts 的说明）。
 */
export const SUBTITLE_BAR: Layout = {
  visible: [['sub-scope'], ['color', 'font', 'size'], ['sub-edit', 'sub-style', 'sub-animation']],
  more: [
    [
      ['bold', 'italic'],
      ['align-left', 'align-center', 'align-right', 'case'],
    ],
    ['line-height', 'letter-spacing'],
    ['save-to-brand-kit', 'hide-subs'],
  ],
};

/**
 * 按元素种类归类：带计时读数的文字是计时，声波是 `wave`（动画贴纸与贴纸同一条：原型里 Lottie 也走能分色的那一边）。
 * 手绘、占位框与代码包合成在原型与旧版里都没有自己的一条，退回一颗「属性」。
 */
export function barKindOf(item: PlacedItem): BarKind {
  switch (item.type) {
    case 'text':
      return item.counter ? 'counter' : 'text';
    case 'video':
    case 'image':
    case 'shape':
    case 'sticker':
    case 'progress':
      return item.type;
    case 'visualizer':
      return 'wave';
    case 'confetti':
    case 'whiteboard':
      return item.type;
    case 'draw':
    case 'placeholder':
    case 'composition':
      return 'other';
  }
}

// ---- 每一格做什么 ----

/**
 * - `pop`：条子上开弹层改值；`sub`：菜单里下钻一层（滑杆、时间）；`toggle`：菜单那一行里的开关钮；
 * - `command`：一下就提交；`jump`：打开属性页并滚到这一节（`null` 是页首；节名是稳定的 key，节头文字随界面语言）；
 * - `off`：现在不能用，`reason` 写给用户看。
 */
export type ToolAction =
  | { kind: 'pop' }
  | { kind: 'sub' }
  | { kind: 'toggle' }
  | { kind: 'command' }
  | { kind: 'jump'; section: InspectorSection | null }
  | { kind: 'off'; reason: string };

export interface Tool {
  id: ToolId;
  label: string;
  action: ToolAction;
}

/** 菜单的一段：一行图标钮（分簇）或一列菜单项。 */
export type MenuGroup = { kind: 'row'; clusters: Tool[][] } | { kind: 'list'; tools: Tool[] };

export interface ToolbarSpec {
  kind: BarKind;
  visible: Tool[][];
  /** 没有溢出菜单时是 null：不画 ⋯。 */
  more: MenuGroup[] | null;
}

/** 协议里还没有对应操作的几格：为什么不能用。 */
export const OFF_REASON: StageToolbarMessages['offReason'] = live(() => M.offReason);

/** 「层级」下钻页的四行（显示名）与这一笔的名字。 */
export const ARRANGE_COPY: StageToolbarMessages['arrange'] = live(() => M.arrange);
/** 「层级」下钻页的次序：往前的两行、一条线、往后的两行。 */
export const ARRANGE_ROWS: readonly (readonly ArrangeDirection[])[] = [
  ['front', 'forward'],
  ['backward', 'back'],
];

/** 属性页里能直接跳到的节。 */
export type InspectorSection = 'style' | 'transition' | 'effects';

const jump = (section: InspectorSection | null): ToolAction => ({ kind: 'jump', section });
const off = (reason: string): ToolAction => ({ kind: 'off', reason });
const POP: ToolAction = { kind: 'pop' };
const SUB: ToolAction = { kind: 'sub' };
const TOGGLE: ToolAction = { kind: 'toggle' };
const COMMAND: ToolAction = { kind: 'command' };

/** 文字样式带着 schema（别的格式的样式对象）时，改字的几格都不能用。 */
function textStyleAction(item: PlacedItem, action: ToolAction): ToolAction {
  if (item.type !== 'text' || editableTextStyle(item.style)) return action;
  return off(M.textStyleLocked(String(asObject(item.style).schema)));
}

/** 条子之外要知道的：这一件的素材（存到品牌库从哪里取文件），界面是不是在浏览器里。 */
export interface BarContext {
  asset?: AssetRecord;
  /** 浏览器会话里调不了品牌库（`library.*` 不在 Web 服务的白名单里）。 */
  web?: boolean;
}

/** 片段画的那个素材（视频、图片，以及按素材画的贴纸与占位框）。 */
export function itemAsset(item: PlacedItem, assets: Record<Id, AssetRecord>): AssetRecord | undefined {
  return 'assetRef' in item && item.assetRef ? assets[item.assetRef.id] : undefined;
}

/**
 * 素材片段存到品牌库存进哪一节、从哪取文件：取得到原文件才能存（生成的用产物，链接的用原文件），取不到时给原因。
 * 条子上这一格能不能用与按下去存什么走同一条判断。
 */
export function brandTarget(asset: AssetRecord | undefined): { kind: BrandMediaKind; source: LibrarySource } | { reason: string } {
  const kind = asset && brandKindForAsset(asset);
  if (!asset || !kind) return { reason: OFF_REASON.brand };
  const found = assetLibrarySource(asset);
  return 'source' in found ? { kind, source: found.source } : found;
}

/** 一格在这一件上落成什么。 */
export function toolAction(id: ToolId, item: PlacedItem, kind: BarKind, context: BarContext = {}): ToolAction {
  switch (id) {
    case 'color':
      // 计时的颜色、字体、字号是生成器参数，控件在属性页上。
      if (kind === 'counter') return jump(null);
      return item.type === 'shape' ? POP : textStyleAction(item, POP);
    case 'font':
    case 'size':
      return kind === 'counter' ? jump(null) : textStyleAction(item, POP);
    case 'bold':
    case 'italic':
    case 'align-left':
    case 'align-center':
    case 'align-right':
      return kind === 'counter' ? jump(null) : textStyleAction(item, TOGGLE);
    case 'line-height':
    case 'letter-spacing':
      return textStyleAction(item, SUB);
    case 'text-styles':
      return textStyleAction(item, jump('style'));
    case 'border':
      return POP;
    case 'animation':
      return off(OFF_REASON.animation);
    case 'transitions':
      return jump('transition');
    case 'adjust':
    case 'effects':
      // 调色、模糊、投影、描边都在属性页的「效果」一节（原型的「调整」页在这里是效果栈里的调色）。
      return jump('effects');
    case 'volume':
      return item.type === 'video' || (item.type === 'composition' && item.audio) ? POP : off(OFF_REASON.sound);
    case 'speed':
      return item.type === 'video' && item.timeMap.kind === 'linear' ? POP : off(OFF_REASON.speed);
    case 'fill-list':
    case 'progress-colors':
    case 'progress-picker':
    case 'wave-colors':
    case 'wave-picker':
    case 'counter-mode':
    case 'volume-levels':
      // 合成的参数（改的是生成器参数）：控件都在属性页的开头。
      return jump(null);
    case 'properties':
      return jump(null);
    case 'copy':
    case 'delete':
    case 'fit-canvas':
    case 'fill-canvas':
      return COMMAND;
    case 'flip-vertical':
    case 'flip-horizontal':
      return TOGGLE;
    case 'opacity':
    case 'adjust-timing':
      return SUB;
    case 'arrange':
      // 四个方向在菜单里下钻一层（原型 stage-toolbar-menu.jsx 的 OrderSub）；走不动的方向灰着。
      return SUB;
    case 'save-to-brand-kit': {
      // 品牌库收素材与字幕样式，没有文字样式这一节。
      if (item.type === 'text') return off(OFF_REASON.brandText);
      if (context.web) return off(OFF_REASON.brandWeb);
      const target = brandTarget(context.asset);
      return 'reason' in target ? off(target.reason) : COMMAND;
    }
    case 'round-corners':
      return off(OFF_REASON.roundCorners);
    case 'filters':
      return off(OFF_REASON.filters);
    case 'crop-video':
      return off(OFF_REASON.crop);
    case 'replace-video':
    case 'replace-image':
      return off(OFF_REASON.replace);
    case 'detach-audio':
      return off(OFF_REASON.detach);
    case 'sub-scope':
    case 'sub-edit':
    case 'sub-style':
    case 'sub-animation':
    case 'case':
    case 'hide-subs':
      // 字幕条子专用（见 `captionAction`），画面元素的配置表里没有。
      return COMMAND;
  }
}

const isRow = (group: Group | Row): group is Row => group.some((entry) => Array.isArray(entry));

function specOf(kind: BarKind, layout: Layout, tool: (id: ToolId) => Tool): ToolbarSpec {
  return {
    kind,
    visible: layout.visible.map((group) => group.map(tool)),
    more: layout.more
      ? layout.more.map((group) =>
          isRow(group) ? { kind: 'row', clusters: group.map((cluster) => cluster.map(tool)) } : { kind: 'list', tools: group.map(tool) },
        )
      : null,
  };
}

/** 选中这一件时条子与菜单的样子。 */
export function toolbarFor(item: PlacedItem, context: BarContext = {}): ToolbarSpec {
  const kind = barKindOf(item);
  // 还没有自己一条的元素也要能改叠放次序：只给一颗「属性」，菜单里放通用的复制 / 层级 / 时长 / 删除。
  const layout: Layout =
    kind === 'other' || kind === 'subtitle' ? { visible: [['properties']], more: [['copy', 'arrange'], ['adjust-timing', 'delete']] } : BAR[kind];
  return specOf(kind, layout, (id) => ({ id, label: TOOL_LABEL[id], action: toolAction(id, item, kind, context) }));
}

// ---- 字幕 ----

export interface CaptionBarInput {
  /** 原文与译文共用这份样式（双语两行）：条子最前才有换行的两枚 chip。 */
  paired: boolean;
  /** 字幕已经有自己的样式文档：才有东西存进品牌库（还在用缺省样式时没有）。 */
  styled: boolean;
  /** 浏览器会话里调不了品牌库。 */
  web?: boolean;
}

/** 字幕条子上的一格落成什么：文字样式那几格与文字元素同一套形态，写的是字幕样式文档。 */
function captionAction(id: ToolId, { styled, web }: CaptionBarInput): ToolAction {
  switch (id) {
    case 'color':
    case 'font':
    case 'size':
      return POP;
    case 'bold':
    case 'italic':
    case 'align-left':
    case 'align-center':
    case 'align-right':
      return TOGGLE;
    case 'line-height':
    case 'letter-spacing':
      return SUB;
    case 'sub-animation':
      return off(OFF_REASON.captionAnimation);
    case 'save-to-brand-kit':
      if (web) return off(OFF_REASON.brandWeb);
      return styled ? COMMAND : off(OFF_REASON.captionDefaultStyle);
    default:
      // 换行、Edit、Styles、大小写一档档轮换、隐藏字幕：一下就生效。
      return COMMAND;
  }
}

/** 选中字幕时条子与菜单的样子。只有一种行用这份样式时，第一段（换行）整段不出。 */
export function captionToolbar(input: CaptionBarInput): ToolbarSpec {
  const layout: Layout = input.paired ? SUBTITLE_BAR : { ...SUBTITLE_BAR, visible: SUBTITLE_BAR.visible.filter((g) => !g.includes('sub-scope')) };
  return specOf('subtitle', layout, (id) => ({ id, label: TOOL_LABEL[id], action: captionAction(id, input) }));
}

/** 字幕大小写的四档（属性页的「大小写」下拉同一套；`capitalize` 算首字母大写）。 */
export const CAPTION_CASES = ['none', 'uppercase', 'title', 'lowercase'] as const;
export type CaptionCase = (typeof CAPTION_CASES)[number];

export function captionCase(transform: unknown): CaptionCase {
  if (transform === 'uppercase' || transform === 'lowercase') return transform;
  return transform === 'title' || transform === 'capitalize' ? 'title' : 'none';
}

/** 菜单里那一颗大小写钮按一下换到下一档（原型 `case`：原样 → 全大写 → 首字母大写 → 全小写 → 原样）。 */
export function nextCaptionCase(transform: unknown): CaptionCase {
  return CAPTION_CASES[(CAPTION_CASES.indexOf(captionCase(transform)) + 1) % CAPTION_CASES.length]!;
}

// ---- 落位 ----

/** 条子离选框 12px（原型 `.mtb`）；选框上方有旋转钮时抬到 50px 跨过它（`.mtb--rot`）。离舞台边至少 8px。 */
export const BAR_GAP = 12;
export const BAR_LIFT = 50;
export const BAR_MARGIN = 8;

export interface Size {
  w: number;
  h: number;
}

export interface BarPlacement {
  left: number;
  top: number;
  /** 翻到了选框下方。 */
  below: boolean;
  /** 舞台比条子窄时，条子最多这么宽（横向滚动）。 */
  maxWidth: number;
}

/**
 * 条子放在哪（舞台像素，`box` 是选中件旋转后的外包盒）：横向对着选框居中、夹在舞台里；
 * 纵向先放上方，上方放不下（贴着舞台顶）就翻到下方，下方也放不下就夹在舞台底边以内。
 */
export function toolbarPlacement(box: Rect, area: Size, bar: Size, knob: boolean): BarPlacement {
  const maxWidth = Math.max(0, area.w - BAR_MARGIN * 2);
  const width = Math.min(bar.w, maxWidth);
  const left = Math.max(BAR_MARGIN, Math.min(box.x + box.w / 2 - width / 2, area.w - width - BAR_MARGIN));
  const above = box.y - (knob ? BAR_LIFT : BAR_GAP) - bar.h;
  if (above >= BAR_MARGIN) return { left: Math.round(left), top: Math.round(above), below: false, maxWidth: Math.round(maxWidth) };
  const below = box.y + box.h + BAR_GAP;
  const top = Math.max(BAR_MARGIN, Math.min(below, area.h - bar.h - BAR_MARGIN));
  return { left: Math.round(left), top: Math.round(top), below: true, maxWidth: Math.round(maxWidth) };
}
