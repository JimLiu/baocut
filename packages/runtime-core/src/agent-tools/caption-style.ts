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
 */

type Json = Record<string, unknown>;

const STUDIO_STYLE = 'baocut.legacy-studio-style/0.1';

const color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  .describe('#RRGGBB 或带不透明度的 #RRGGBBAA');

export const captionStylePatch = z
  .strictObject({
    y: z.number().min(0).max(100).optional().describe('锚线的高度：画面高度的百分比（0 顶、100 底），缺省 86'),
    verticalAlign: z
      .enum(['top', 'center', 'bottom'])
      .optional()
      .describe('字幕块的哪条边落在 y 上：top 上边、center 中线（缺省）、bottom 下边；折成多行时往另一边长'),
    x: z.number().min(0).max(100).optional().describe('字幕块中心的横向位置：画面宽度的百分比，缺省 50'),
    width: z.number().min(5).max(100).optional().describe('最大行宽：画面宽度的百分比，缺省 80；烧进画面时一行超过它就折行'),
    fontSize: z
      .number()
      .min(4)
      .max(200)
      .optional()
      .describe('字号：按 540 短边下的像素（1080×1920 上乘 2），缺省 30；双语时是原文行，译文行按比例放大'),
    fontWeight: z.number().int().min(100).max(900).optional().describe('字重，100–900，默认样式 700'),
    fontFamily: z.string().trim().min(1).max(200).optional().describe('字体族名；system 为系统字体（默认）'),
    fontColor: color.optional().describe('字色，默认白 #FFFFFF'),
    textOutline: z
      .strictObject({
        on: z.boolean().describe('描边开关'),
        color: color.optional().describe('描边颜色'),
        width: z.number().min(0).max(50).optional().describe('描边粗细：字号的百分比，默认 14'),
      })
      .optional()
      .describe('描边；默认样式开着（黑色）'),
    dropShadow: z
      .strictObject({ on: z.boolean().describe('投影开关') })
      .optional()
      .describe('投影；默认样式开着'),
    background: z.boolean().optional().describe('底板开关；默认关'),
    backgroundColor: color.optional().describe('底板颜色，默认 #000000B3'),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: '至少给一个样式字段' });

export type CaptionStylePatch = z.infer<typeof captionStylePatch>;

/** 合并时整体替换以外、要按字段合进去的键：描边与投影只改给出的字段。 */
const NESTED = new Set(['textOutline', 'dropShadow']);

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 这份正文能不能按补丁改：只有 Studio 样式（定位框样式与动态场景的键不同）。 */
export function isStudioStyle(body: unknown): body is Json & { style: Json } {
  return isObject(body) && body.schema === STUDIO_STYLE && isObject(body.style);
}

/** 把补丁合进一份 Studio 样式正文，返回新的正文；不是 Studio 样式时 null。 */
export function patchStudioStyle(body: unknown, patch: CaptionStylePatch): Json | null {
  if (!isStudioStyle(body)) return null;
  const style: Json = { ...body.style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    style[key] = NESTED.has(key) ? { ...(isObject(style[key]) ? style[key] : {}), ...(value as Json) } : value;
  }
  return { ...body, style };
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
