import type { EditOperation } from '@baocut/protocol';
import { asObject, type Json, type LineKind } from '../render/text-style.ts';
import { PAINT_KEYS, defaultStyleName } from './caption-presets.ts';
import { DEFAULT_CAPTION_STYLE } from './property-values.ts';

const APPEARANCE = [...PAINT_KEYS, 'fontSize', 'fontSizeBasis'];
const ROOT = [...APPEARANCE, 'x', 'y', 'width', 'verticalAlign', 'order', 'gap', 'biScale', 'transScale', 'punct', 'displayTiming'];
const GROUPS: Record<string, readonly string[]> = {
  textOutline: ['on', 'color', 'width'],
  dropShadow: ['on', 'color', 'opacity', 'blur', 'distance', 'rotation'],
  glow: ['on', 'color', 'opacity', 'blur'],
  displayTiming: ['leadIn', 'tail'],
};
const FLAGS = ['on', 'punct', 'bold', 'italic', 'underline', 'background', 'bgOn', 'outline'];
const STRINGS = ['fontFamily', 'fontStyle', 'fontColor', 'color', 'textAlign', 'align', 'textTransform', 'backgroundColor', 'backgroundStyle', 'fontSizeBasis'];
function valid(key: string, value: unknown): boolean {
  // 预设用 null 遮掉旧涂装的别名；其他选项不能用 null 代替有效值。
  if (value === null) return PAINT_KEYS.includes(key);
  if (FLAGS.includes(key)) return typeof value === 'boolean';
  if (key === 'verticalAlign') return ['top', 'center', 'bottom'].includes(String(value));
  if (key === 'order') return value === 'orig' || value === 'trans';
  if (STRINGS.includes(key)) return typeof value === 'string' && value.length <= 512;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (['x', 'y', 'width'].includes(key)) return value >= 0 && value <= 100;
  if (key === 'gap') return value >= 0 && value <= 40;
  if (key === 'leadIn' || key === 'tail') return value >= 0 && value <= (key === 'leadIn' ? 2 : 3);
  return true;
}

/** 只保存属性选项；语言、正文、单句覆盖、视频标识与未知字段永不跨视频带入。 */
function pick(value: unknown, keys: readonly string[]): Json {
  const source = asObject(value);
  const out: Json = {};
  for (const key of keys) {
    const v = source[key];
    if (GROUPS[key] && v !== null && typeof v === 'object' && !Array.isArray(v)) out[key] = pick(v, GROUPS[key]!);
    else if (valid(key, v)) out[key] = v;
  }
  return out;
}

export function cleanCaptionPreferences(value: unknown): Json {
  const source = asObject(value);
  const out = pick(source, ROOT);
  for (const key of ['origStyle', 'transStyle']) {
    if (key in source) out[key] = pick(source[key], APPEARANCE);
  }
  return out;
}

/** 仅记本次真正提交的修改，打开旧视频或拖动预览不会改变偏好。删掉覆盖也记住。 */
export function rememberCaptionPreferences(saved: Json, before: Json, after: Json, singleLine?: LineKind): Json {
  const next = cleanCaptionPreferences(saved);
  const a = cleanCaptionPreferences(before);
  const b = cleanCaptionPreferences(after);
  for (const key of [...ROOT, 'origStyle', 'transStyle']) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (singleLine && APPEARANCE.includes(key)) {
      const lineKey = singleLine === 'original' ? 'origStyle' : 'transStyle';
      const line = { ...asObject(next[lineKey]) };
      if (b[key] === undefined) delete line[key];
      else line[key] = b[key];
      next[lineKey] = line;
      continue;
    }
    if (key === 'origStyle' || key === 'transStyle') {
      const oldLine = asObject(a[key]);
      const line = asObject(b[key]);
      const remembered = { ...asObject(next[key]) };
      for (const field of APPEARANCE) {
        if (JSON.stringify(oldLine[field]) === JSON.stringify(line[field])) continue;
        if (line[field] === undefined) delete remembered[field];
        else remembered[field] = line[field];
      }
      if (Object.keys(remembered).length) next[key] = remembered;
      else delete next[key];
      continue;
    }
    if (b[key] === undefined) delete next[key];
    else next[key] = b[key];
  }
  return next;
}

export function preferredCaptionStyle(preferences: unknown): Json {
  return { ...DEFAULT_CAPTION_STYLE, style: { ...asObject(DEFAULT_CAPTION_STYLE.style), ...cleanCaptionPreferences(preferences) } };
}

/** 新建字幕的一笔事务同时写入偏好；共用已有样式的译文仍以该视频的样式为准。 */
export function withNewCaptionStyle(operations: EditOperation[], body: Json): EditOperation[] {
  const freshStyle = operations.find((op) => op.type === 'putDocument' && op.kind === 'caption-style' && !op.documentId);
  if (freshStyle) return operations.map((op) => (op === freshStyle ? { ...op, body } : op));
  const needsStyle = operations.some((op) => op.type === 'insertItems' && op.items.some((item) => item.type === 'caption' && !item.styleDocumentId && !item.styleDocumentRef));
  if (!needsStyle) return operations;
  const ref = 'caption-preferences-style';
  return [
    { type: 'putDocument', ref, kind: 'caption-style', name: defaultStyleName(), body },
    ...operations.map((op): EditOperation => {
      if (op.type !== 'insertItems') return op;
      return {
        ...op,
        items: op.items.map((item) =>
          item.type === 'caption' && !item.styleDocumentId && !item.styleDocumentRef
            ? { ...item, styleDocumentId: undefined, styleDocumentRef: ref }
            : item,
        ),
      };
    }),
  ];
}
