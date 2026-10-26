// i18n-ignore-file: 给模型的工具说明、错误与下一步
import type { DocumentRecord, Id, Sequence, VideoSnapshot } from '@baocut/protocol';
import { DEFAULT_CAPTION_STYLE_BODY } from '@baocut/jobs';
import { JobsCaptionLayer } from '@baocut/protocol/messages/jobs/caption-layer.ts';
import { z } from 'zod';
import { OperationShapeError } from './video-digest.ts';

/**
 * 智能体改字幕层的位置与样式（视频格式规范 §5.6）：`captions_create` 的 `style` 与 `edits_apply` 的 `setCaptionStyle` 共用。
 *
 * 不另造一套字段：补丁的键就是字幕样式文档（`caption-style`，Studio 样式 `baocut.legacy-studio-style/0.1`）`style` 里的键，
 * 编辑器的字幕属性页读写的也是这几个，预览与导出的渲染内核按它们摆放、折行。补丁合进实例现有的样式文档（写一个新版本，
 * 用同一份样式的字幕层一起变）；实例还没有样式时以默认预设（`DEFAULT_CAPTION_STYLE_BODY`）为底新建一份。
 *
 * 双语的原文、译文两行共用这一份样式；一行要不同时写进它的覆盖 `origStyle` / `transStyle`，与编辑器字幕属性页的
 * 「原文 | 译文」和在画面上单独拖一行写的是同一处。
 *
 * 当前词效果只收两个键的子集：`wordAnimation` 选逐词动画目录里的 none 或 colourHighlight，`textMotion` 只收 KTV 扫色
 * `karaoke`。补丁里只写格子和颜色，展开成整份载荷、与别的当前词表示互斥，由 `setActiveWord` 处理。
 */

type Json = Record<string, unknown>;

const STUDIO_STYLE = 'baocut.legacy-studio-style/0.1';

const color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  .describe('#RRGGBB 或带不透明度的 #RRGGBBAA');

const verticalAlign = z.enum(['top', 'center', 'bottom']);
const fontWeight = z
  .number()
  .int()
  .min(100)
  .max(900)
  .describe('字重，100–900，默认样式 700；同时写 bold（低于 700 时去掉粗体，否则粗体会把字重抬回 700）');
const fontFamily = z.string().trim().min(1).max(200).describe('字体族名；system 为系统字体（默认）');
const lineHeight = z.number().min(0.5).max(3).describe('行高：字号的倍数，缺省 1.2');
const letterSpacing = z.number().min(-5).max(30).describe('字距：以 30 号字为基准的像素，随字号等比（3 约为字号的 10%），缺省 0');
const textOutline = z
  .strictObject({
    on: z.boolean().describe('描边开关'),
    color: color.optional().describe('描边颜色'),
    width: z.number().min(0).max(50).optional().describe('描边粗细：字号的百分比，默认 14'),
  })
  .describe('描边；默认样式开着（黑色）');
const dropShadow = z.strictObject({ on: z.boolean().describe('投影开关') }).describe('投影；默认样式开着');
const background = z.boolean().describe('底板开关；默认关');
const backgroundColor = color.describe('底板颜色，默认 #000000B3');

/**
 * 当前词效果（视频格式规范 §5.6「当前词」）：逐词动画目录里能选的两格，展开成内核与编辑器写的整份载荷
 * （`crates/subtitle-render/src/word_animation_catalog.rs` 的 `word_animation_payload`）。
 */
const WORD_ANIMATION_CELLS = {
  none: { animationId: 'none', animationName: 'None' },
  colourHighlight: { animationId: 'magic-wbw', animationName: 'Color' },
} as const;
/** 内核 `Color` 一格的缺省当前词色；样式里原来不是这一格、补丁也没给颜色时用它。 */
const HIGHLIGHT_COLOR = '#FFD43B';
/** 走 `textMotion` 时当前词变色写成 `emphasis`（编辑器字幕属性页的 `compileWord` 同值）。 */
const EMPHASIS_SECONDS = 0.16;
const KARAOKE_KEYS = ['color', 'unit', 'guide', 'nextLine'] as const;

const wordAnimation = z
  .strictObject({
    catalogId: z
      .enum(['none', 'colourHighlight'])
      .describe('none 不高亮当前词；colourHighlight 当前词换成 active.color（默认样式就是这一格，青绿 #18E1D6）'),
    active: z
      .strictObject({ color: color.describe('当前词的颜色') })
      .optional()
      .describe('只用于 colourHighlight；不给时沿用样式里原来的当前词色'),
  })
  .refine((cell) => cell.catalogId === 'colourHighlight' || cell.active === undefined, {
    message: 'active 只用于 colourHighlight',
  })
  .describe('当前词效果（逐词动画目录的一格）：只在带词时间的字幕上起作用；写它时去掉样式里的 KTV 扫色');

const karaoke = z
  .strictObject({
    color: color.describe('念过部分的颜色；没念到的部分是 fontColor'),
    unit: z
      .enum(['grapheme', 'word'])
      .optional()
      .describe('grapheme（缺省）在每个词的时间里一个字一个字扫过去；word 念到一个词就整词变色'),
    guide: z.boolean().optional().describe('true 时扫色的边界上方跟着一个跳动的小圆点；缺省 false'),
    nextLine: z.boolean().optional().describe('true 时排成两行歌词：下一句在正在念的一句下面预告；缺省 false'),
  })
  .describe('KTV 扫色：念到哪里，哪里从 fontColor 变成 color；没给的字段沿用样式里原来的扫色');

const textMotion = z
  .strictObject({
    karaoke: karaoke.nullable().describe('KTV 扫色；null 去掉扫色'),
  })
  .describe(
    '分层文字动效里的 KTV 扫色（样式文档的 textMotion.karaoke），只改这一项，原有的入场、出场与循环保留。开扫色时当前词效果换成 none。只有带词时间的字幕会扫色，双语的译文行借同时段原文的词时间一起扫',
  );

/**
 * 双语时原文、译文一行自己的样式（样式文档的 `origStyle` / `transStyle`，视频格式规范 §5.6）：盖在两行共用的样式上，
 * 只给这一行要不同的键。`x`、`y` 一起给时这一行离开两行的堆栈单独摆（渲染内核的 `line_position_override` 要两者都在）。
 */
const captionLinePatch = z
  .strictObject({
    x: z.number().min(0).max(100).optional().describe('这一行单独摆放时文本块中心的横向位置：画面宽度的百分比；与 y 一起给'),
    y: z.number().min(0).max(100).optional().describe('这一行单独摆放时的锚线高度：画面高度的百分比；与 x 一起给'),
    verticalAlign: verticalAlign.optional().describe('单独摆放的这一行哪条边落在它的 y 上，缺省 center；配 x、y 用'),
    fontSize: z
      .number()
      .min(4)
      .max(200)
      .optional()
      .describe('这一行的字号：按 540 短边下的像素；写了就不再跟双语的字号比例'),
    fontWeight: fontWeight.optional(),
    fontFamily: fontFamily.optional(),
    fontColor: color.optional().describe('这一行的字色'),
    lineHeight: lineHeight.optional(),
    letterSpacing: letterSpacing.optional(),
    textOutline: textOutline.optional(),
    dropShadow: dropShadow.optional(),
    background: background.optional(),
    backgroundColor: backgroundColor.optional(),
  })
  .refine((line) => Object.keys(line).length > 0, { message: '至少给一个样式字段' })
  .refine((line) => (line.x === undefined) === (line.y === undefined), {
    message: 'x 与 y 要一起给：两者都在时这一行才离开两行的堆栈单独摆',
  });

export const captionStylePatch = z
  .strictObject({
    y: z.number().min(0).max(100).optional().describe('锚线的高度：画面高度的百分比（0 顶、100 底），缺省 86'),
    verticalAlign: verticalAlign
      .optional()
      .describe('字幕块的哪条边落在 y 上：top 上边、center 中线（缺省）、bottom 下边；折成多行时往另一边长'),
    x: z.number().min(0).max(100).optional().describe('字幕块中心的横向位置：画面宽度的百分比，缺省 50'),
    width: z.number().min(5).max(100).optional().describe('最大行宽：画面宽度的百分比，缺省 80；烧进画面时一行超过它就折行'),
    panelSeam: z
      .boolean()
      .optional()
      .describe(
        '分屏段挂到接缝：开着（缺省）时，开始在分屏画面上的一句整块的中线落在离 y 最近的那条两格接缝上，到这一句结束不动；关掉就照 y 摆',
      ),
    fontSize: z
      .number()
      .min(4)
      .max(200)
      .optional()
      .describe(
        '字号：按 540 短边下的像素（1080×1920 上乘 2），缺省 30。双语时两行按比例画：原文是它的 2/3，译文是原文的 1.6 倍（30 时原文 20、译文 32）；单独定一行的字号写在 origStyle / transStyle 里',
      ),
    fontWeight: fontWeight.optional(),
    fontFamily: fontFamily.optional(),
    fontColor: color.optional().describe('字色，默认白 #FFFFFF'),
    textAlign: z
      .enum(['left', 'center', 'right'])
      .optional()
      .describe('各行的水平对齐，缺省 center。行在字幕块自己的宽里对齐、块居中在 x 上，单行时看不出左右；要贴住折行区域的一边，同时给 alignWithinWrap: true'),
    alignWithinWrap: z
      .boolean()
      .optional()
      .describe('true 时各行在折行宽度里按 textAlign 对齐：左对齐的左边固定在 x − width/2，右对齐的右边固定在 x + width/2，长短句都贴同一条边；缺省 false'),
    lineHeight: lineHeight.optional(),
    letterSpacing: letterSpacing.optional(),
    punct: z
      .boolean()
      .optional()
      .describe('true（缺省）时逗号、句号在画面上换成空格；false 照原文画标点。只影响画面，转写与导出的字幕文件不变'),
    textOutline: textOutline.optional(),
    dropShadow: dropShadow.optional(),
    background: background.optional(),
    backgroundColor: backgroundColor.optional(),
    speakerLabel: z
      .strictObject({
        on: z.boolean().describe('说话人标签开关'),
        scale: z.number().min(0.3).max(1).optional().describe('字号：最上面那行的倍数，默认 0.62'),
        color: color.optional().describe('颜色，默认 #BBBBBB'),
      })
      .optional()
      .describe('说话人标签：打开时有说话人的句子在字幕块最上面多一行名字（取字幕句子的 speaker，没写时取转写里这一句的说话人）；默认关'),
    order: z.enum(['trans', 'orig']).optional().describe('双语两行的上下次序：trans 译文在上（缺省），orig 原文在上'),
    gap: z.number().min(0).max(40).optional().describe('双语两行之间的距离：按 540 短边下的像素，缺省 6'),
    origStyle: captionLinePatch
      .nullable()
      .optional()
      .describe('双语时原文那一行自己的样式，盖在共用样式上，只给要不同的键；null 去掉这一行的全部覆盖、跟回共用样式'),
    transStyle: captionLinePatch
      .nullable()
      .optional()
      .describe('双语时译文那一行自己的样式，写法同 origStyle'),
    wordAnimation: wordAnimation.optional(),
    textMotion: textMotion.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: '至少给一个样式字段' })
  .refine((patch) => !(patch.textMotion?.karaoke && patch.wordAnimation?.catalogId === 'colourHighlight'), {
    message: 'KTV 扫色开着时当前词就是扫色：wordAnimation 不能同时给 colourHighlight',
    path: ['wordAnimation'],
  });

export type CaptionStylePatch = z.infer<typeof captionStylePatch>;

/** 合并时整体替换以外、要按字段合进去的键：描边与投影只改给出的字段。 */
const NESTED = new Set(['textOutline', 'dropShadow', 'speakerLabel']);

/**
 * 两行各自能改的外观键。根上改它们时，两行覆盖里的同名键去掉，两行都按新值画（不然有覆盖的那一行看不见这一笔），
 * 与编辑器两行一起改的规则相同（packages/ui/src/model/caption-lines.ts 的 `editBlock`）。位置键不在里面：
 * 根上的 `x`、`y`、`verticalAlign` 是两行堆栈的锚点，行覆盖里的是单独摆走的那一行自己的位置，两者不相干。
 */
const LINE_APPEARANCE = [
  'fontSize',
  'fontWeight',
  'bold',
  'fontFamily',
  'fontColor',
  'lineHeight',
  'letterSpacing',
  'textOutline',
  'dropShadow',
  'background',
  'backgroundColor',
] as const;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const objectOr = (value: unknown): Json => (isObject(value) ? value : {});

/** 这份正文能不能按补丁改：只有 Studio 样式（定位框样式与动态场景的键不同）。 */
export function isStudioStyle(body: unknown): body is Json & { style: Json } {
  return isObject(body) && body.schema === STUDIO_STYLE && isObject(body.style);
}

/** 把补丁合进一份 Studio 样式正文，返回新的正文；不是 Studio 样式时 null。 */
export function patchStudioStyle(body: unknown, patch: CaptionStylePatch): Json | null {
  if (!isStudioStyle(body)) return null;
  const style: Json = { ...body.style };
  const { origStyle, transStyle, wordAnimation, textMotion, ...root } = patch;
  for (const [key, value] of Object.entries(root)) {
    if (value === undefined) continue;
    style[key] = NESTED.has(key) ? { ...objectOr(style[key]), ...(value as Json) } : value;
  }
  setActiveWord(style, wordAnimation, textMotion);
  // 渲染时 bold 把字重抬到至少 700：字重与粗体一起写，与编辑器属性页的同步规则相同。
  if (root.fontWeight !== undefined) style.bold = root.fontWeight >= 700;
  const shared = LINE_APPEARANCE.filter((key) => (key === 'bold' ? root.fontWeight : (root as Json)[key]) !== undefined);
  for (const [lineKey, line] of [
    ['origStyle', origStyle],
    ['transStyle', transStyle],
  ] as const) {
    let partial: Json | null = isObject(style[lineKey]) ? { ...style[lineKey] } : null;
    if (partial) for (const key of shared) delete partial[key];
    if (line === null) partial = null;
    else if (line !== undefined) {
      partial ??= {};
      for (const [key, value] of Object.entries(line)) {
        if (value === undefined) continue;
        // 行覆盖整键盖在共用样式上（渲染内核的 merged_line_style 是浅合并）：描边、投影从这一行此刻画出来的值合起，写全。
        partial[key] = NESTED.has(key) ? { ...objectOr(style[key]), ...objectOr(partial[key]), ...(value as Json) } : value;
      }
      if (line.fontWeight !== undefined) partial.bold = line.fontWeight >= 700;
    }
    if (partial && Object.keys(partial).length) style[lineKey] = partial;
    else delete style[lineKey];
  }
  return { ...body, style };
}

/**
 * 写当前词效果（就地改 `style`）。当前词只有一种画法，与编辑器字幕属性页的「当前词」相同（`packages/ui/src/model/caption-style-body.ts`
 * 的 `compileWord`）：换一种时另外几种表示一起去掉。
 *
 * - KTV 扫色写 `textMotion.karaoke`，`wordAnimation` 换成 none。
 * - 选目录的一格时去掉 `textMotion.karaoke` 与 `emphasis`。样式里还有入场、出场或循环时内核走分层文字动效、不读
 *   `wordAnimation`，变色另写成 `textMotion.emphasis`。
 * - `textMotion` 只剩 `version` 时整个去掉，内核回到按 `wordAnimation` 画。
 */
function setActiveWord(style: Json, cell: CaptionStylePatch['wordAnimation'], motionPatch: CaptionStylePatch['textMotion']): void {
  if (!cell && !motionPatch) return;
  const motion: Json = isObject(style.textMotion) ? { ...style.textMotion } : {};
  const sweep = motionPatch?.karaoke;
  // 只去掉扫色（karaoke: null）时别的当前词效果不动；换成扫色或目录的一格时 emphasis 跟着换。
  if (cell || sweep) delete motion.emphasis;
  if (sweep) {
    const prior = objectOr(motion.karaoke);
    const merged: Json = {};
    for (const key of KARAOKE_KEYS) {
      const value = sweep[key] ?? prior[key];
      if (value !== undefined) merged[key] = value;
    }
    motion.karaoke = merged;
  } else delete motion.karaoke;
  const chosen = cell ?? (sweep ? { catalogId: 'none' as const } : undefined);
  if (chosen) {
    const prior = objectOr(style.wordAnimation ?? style.anim);
    const priorColor = prior.catalogId === 'colourHighlight' || prior.animationName === 'Color' ? objectOr(prior.active).color : undefined;
    const highlight =
      chosen.catalogId === 'colourHighlight' ? (chosen.active?.color ?? (typeof priorColor === 'string' ? priorColor : HIGHLIGHT_COLOR)) : null;
    style.wordAnimation = {
      ...WORD_ANIMATION_CELLS[chosen.catalogId],
      catalogId: chosen.catalogId,
      spoken: {},
      active: highlight ? { color: highlight } : {},
      unspoken: {},
    };
    // 旧键：`anim` 在 `wordAnimation` 缺席时才读，`karaokeColor` 是没有逐词动画时的当前词色。
    delete style.anim;
    delete style.karaokeColor;
    const layered = Object.keys(motion).some((key) => key !== 'version' && key !== 'emphasis');
    if (highlight && layered) motion.emphasis = { color: highlight, scale: 1, durationSeconds: EMPHASIS_SECONDS };
  }
  if (Object.keys(motion).some((key) => key !== 'version')) style.textMotion = { ...motion, version: motion.version ?? 1 };
  else delete style.textMotion;
}

/** 没有样式文档的字幕按默认预设画；新建一份时以它为底，画法只差补丁里的几项。 */
export function freshCaptionStyle(patch: CaptionStylePatch): Json {
  return patchStudioStyle(DEFAULT_CAPTION_STYLE_BODY, patch)!;
}

/** 正文不是 Studio 样式时给智能体的说明。 */
export function unsupportedStyleMessage(documentId: Id, body: unknown): string {
  const schema = isObject(body) && typeof body.schema === 'string' ? body.schema : '未知';
  return `字幕样式文档 ${documentId} 的正文是 ${schema}，不是 Studio 样式（${STUDIO_STYLE}），不能按 style 的键改：换一份样式用 setCaptionStyle 的 styleDocument，或在编辑器里改`;
}

/** 读一份文档的正文。读不到时抛出。 */
type BodyReader = (documentId: Id, revision?: string) => Promise<unknown>;

const NEW_STYLE_REF = 'agent-caption-style';

/**
 * 展开 `edits_apply` 里智能体写的 `setCaptionStyle`（已经补过 `sequenceId`）：
 *
 * - `styleDocumentId` 换成引擎的 `styleDocument: { documentId }`；`styleDocument` 原样交给引擎。
 * - `style` 补丁：实例有样式文档时合进那一份（同一笔里改同一份的几个补丁依次合并，只写一个新版本）；没有时新建一份，
 *   序列上其余还没有样式、没锁的字幕一起挂上（与编辑器的属性页相同：原文与译文共用一份样式才叠成双语两行）。
 *
 * 就地改 `operations`；形状不对时抛 `OperationShapeError`。
 */
export async function expandCaptionStyles(
  operations: Record<string, unknown>[],
  video: VideoSnapshot,
  readBody: BodyReader,
): Promise<void> {
  if (!operations.some((op) => op.type === 'setCaptionStyle')) return;
  const patched = new Map<Id, { record: DocumentRecord; body: Json; at: number }>();
  const fresh = new Map<Id, { body: Json; at: number; attach: Set<Id> }>();
  const out: (Record<string, unknown> | null)[] = [];
  for (const [index, op] of operations.entries()) {
    if (op.type !== 'setCaptionStyle') {
      out.push(op);
      continue;
    }
    const { style, styleDocumentId, styleDocument, ...rest } = op;
    const given = [style, styleDocumentId, styleDocument].filter((value) => value !== undefined).length;
    if (given !== 1) throw new OperationShapeError(index, 'setCaptionStyle 要给 style、styleDocumentId、styleDocument 之一（只给一个）');
    if (styleDocumentId !== undefined) {
      if (typeof styleDocumentId !== 'string') throw new OperationShapeError(index, 'styleDocumentId 要是字符串');
      out.push({ ...rest, styleDocument: { documentId: styleDocumentId } });
      continue;
    }
    if (styleDocument !== undefined) {
      out.push(op);
      continue;
    }
    const parsed = captionStylePatch.safeParse(style);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new OperationShapeError(index, `style${issue.path.length ? '.' + issue.path.join('.') : ''}：${issue.message}`);
    }
    const sequence = video.sequences[String(op.sequenceId ?? video.rootSequenceId)];
    const item = sequence?.items.find((entry) => entry.id === op.itemId);
    if (!sequence || !item) throw new OperationShapeError(index, `序列里没有实例 ${String(op.itemId)}`);
    if (item.type !== 'caption')
      throw new OperationShapeError(index, `实例 ${item.id} 是 ${item.type}，setCaptionStyle 只用于字幕；文字片段用 setStyle`);
    if (item.styleDocumentId) {
      const record = video.documents[item.styleDocumentId];
      if (!record) throw new OperationShapeError(index, `字幕 ${item.id} 的样式文档 ${item.styleDocumentId} 不在视频里`);
      const base = patched.get(record.id)?.body ?? (await readBody(record.id, record.currentRevision));
      const body = patchStudioStyle(base, parsed.data);
      if (!body) throw new OperationShapeError(index, unsupportedStyleMessage(record.id, base));
      patched.set(record.id, { record, body, at: patched.get(record.id)?.at ?? index });
      out.push(null);
      continue;
    }
    // 没有样式：这条序列上的新样式只建一份，没有样式的字幕都挂上。
    const entry = fresh.get(sequence.id) ?? { body: freshCaptionStyle({}), at: index, attach: unstyledCaptions(sequence) };
    entry.body = patchStudioStyle(entry.body, parsed.data)!;
    entry.attach.add(item.id);
    fresh.set(sequence.id, entry);
    out.push(null);
  }
  const insert = new Map<number, Record<string, unknown>[]>();
  const at = (index: number) => insert.get(index) ?? (insert.set(index, []), insert.get(index)!);
  for (const { record, body, at: index } of patched.values()) {
    at(index).push({ type: 'putDocument', documentId: record.id, kind: record.kind, body });
  }
  let n = 0;
  for (const [sequenceId, { body, at: index, attach }] of fresh) {
    const ref = n++ === 0 ? NEW_STYLE_REF : `${NEW_STYLE_REF}-${n}`;
    at(index).push(
      // 文档名按当前语言写进视频，与流程、编辑器新建的样式同名。
      { type: 'putDocument', ref, kind: 'caption-style', name: JobsCaptionLayer.styleName().text, body },
      ...[...attach].map((itemId) => ({ type: 'setCaptionStyle', sequenceId, itemId, styleDocument: { ref } })),
    );
  }
  const expanded: Record<string, unknown>[] = [];
  for (const [index, op] of out.entries()) {
    expanded.push(...(insert.get(index) ?? []));
    if (op) expanded.push(op);
  }
  operations.splice(0, operations.length, ...expanded);
}

/** 序列上还没有样式、能挂样式的字幕（锁住的实例与锁住轨道上的跳过，引擎会拒绝）。 */
function unstyledCaptions(sequence: Sequence): Set<Id> {
  const locked = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  return new Set(
    sequence.items
      .filter((item) => item.type === 'caption' && !item.styleDocumentId && !item.locked && !locked.has(item.trackId))
      .map((item) => item.id),
  );
}
