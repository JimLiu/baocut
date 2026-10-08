import { templateSlots, templateUnfilledText } from '@baocut/protocol';

/*
 * 提示词里的待填项（模板包规范 §5.5；产品设计 §3.2.1；原型 designs/baocut/app/model-prompt-slots.js）。
 * 模板的 brief 与作品示例的 prompt.md 用 `{{label}}` 标出要用户补的地方；输入框把它画成 S2 的占位 token，打字即替换。
 * 草稿始终是一个字符串（占位符原样写成 `{{label}}`），这里负责字符串与片段之间的往返：
 * - 片段 → 字符串必须是字符串 → 片段的严格逆运算，否则 usePromptValue 会反复重建；
 * - label 是 `{{` 与 `}}` 之间的原文，不修剪；空的 `{{}}`、没闭合的 `{{`、带花括号或换行的都按普通文字留着。
 * 交给 Agent 的文字（`[label]`）、label 列表与示例句复用 @baocut/protocol 的 templateUnfilledText / templateSlots / templateExampleText。
 */

/**
 * 占位符的写法，与 @baocut/protocol template.ts 的 `TEMPLATE_SLOT` 一致（那边不导出正则，也没有按位置切片段的函数）；
 * prompt-slots.test.ts 用 templateSlots / templateUnfilledText 交叉核对两边认的是同一批占位符。
 */
const SLOT = /\{\{([^{}\n]+)\}\}/g;

export type SlotPart = { type: 'text'; text: string } | { type: 'slot'; label: string };

/** 文本 → 片段：文字与占位符交替。不产生空的文字片段；空串返回 []。 */
export function slotParts(text: string): SlotPart[] {
  const out: SlotPart[] = [];
  let at = 0;
  for (const m of text.matchAll(SLOT)) {
    if (m.index > at) out.push({ type: 'text', text: text.slice(at, m.index) });
    out.push({ type: 'slot', label: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}

/** 文本里还没填的占位符 label：去重，按第一次出现的顺序。 */
export function slotLabels(text: string): string[] {
  return [...new Set(templateSlots(text))];
}

/** 交给 Agent 的文字：没填的 `{{label}}` 写成 `[label]`，Agent 据此知道哪里要先问（规范 §5.5）。 */
export function slotsForAgent(text: string): string {
  return templateUnfilledText(text);
}

/** 认出填了什么时，在待填项前后各取几个字做锚点；填的值最长几个字（`filledSlot`）。 */
const SLOT_CONTEXT = 6;
const FILLED_MAX = 32;

/**
 * 用户把 `template` 里第一处 `{{label}}` 填成了什么（原型 model-prompt-slots.js `filled`；快捷开始记住上次填的值用）：
 * 在 `text` 里找紧挨着占位符的前后几个字，取两者之间的文字。前后文被改掉、还是占位符、填的是空白、跨了行或太长，都返回 null。
 */
export function filledSlot(template: string, label: string, text: string): string | null {
  const parts = slotParts(template);
  const i = parts.findIndex((x) => x.type === 'slot' && x.label === label);
  if (i < 0) return null;
  const prev = parts[i - 1];
  const next = parts[i + 1];
  const before = prev?.type === 'text' ? prev.text.slice(-SLOT_CONTEXT) : '';
  const after = next?.type === 'text' ? next.text.slice(0, SLOT_CONTEXT) : '';
  if (!before || !after) return null;
  const from = text.indexOf(before);
  if (from < 0) return null;
  const start = from + before.length;
  const end = text.indexOf(after, start);
  if (end < 0) return null;
  const value = text.slice(start, end).trim();
  return value && value.length <= FILLED_MAX && !/[\n{}[\]]/.test(value) ? value : null;
}

/** 把 `template` 里第一处 `{{label}}` 换成 `value`（快捷开始沿用上次填的值）。 */
export function fillSlot(template: string, label: string, value: string): string {
  return template.replace(`{{${label}}}`, () => value);
}

/* ---------- 与 S2 PromptFieldValue 片段的互换 ----------
   S2 的占位 token 是 {type: 'token', text: label, value: {type: 'placeholder', placeholderType: 'text'}}：
   画成占位样式，点一下整个选中，打字即替换，Tab / Shift+Tab 在 token 之间跳。
   这里只用结构类型，不引 @react-spectrum/ai（模型层在 node 里测）。 */

export interface PromptSegmentLike {
  type: 'text' | 'token';
  text: string;
  value?: unknown;
}

export interface SlotToken {
  type: 'token';
  text: string;
  value: { type: 'placeholder'; placeholderType: 'text' };
}

export type PromptSegmentOut = { type: 'text'; text: string } | SlotToken;

function tokenValue(segment: PromptSegmentLike): { type?: unknown; placeholderType?: unknown; url?: unknown } | null {
  return segment.type === 'token' && segment.value && typeof segment.value === 'object' ? (segment.value as never) : null;
}

/** 是不是待填项的占位 token。 */
export function isSlotToken(segment: PromptSegmentLike | null | undefined): boolean {
  const value = segment ? tokenValue(segment) : null;
  return !!value && value.type === 'placeholder' && value.placeholderType === 'text';
}

/** 草稿字符串 → PromptFieldValue 的片段。只有从外面换进来的草稿走这里；用户自己打的 `{{x}}` 不经过它，照旧是文字。 */
export function toPromptSegments(text: string): PromptSegmentOut[] {
  return slotParts(text).map((x) =>
    x.type === 'slot'
      ? { type: 'token', text: x.label, value: { type: 'placeholder', placeholderType: 'text' } }
      : { type: 'text', text: x.text },
  );
}

/**
 * PromptFieldValue 的片段 → 草稿字符串：占位 token 写回 `{{label}}`，链接 token 写完整地址（同 S2 PromptFieldValue 的 toString），
 * 其余取文字。S2 自己的 toString 会把占位 token 写成 label，占位性就丢了。
 */
export function fromPromptSegments(segments: readonly PromptSegmentLike[]): string {
  return segments
    .map((segment) => {
      if (isSlotToken(segment)) return `{{${segment.text}}}`;
      const value = tokenValue(segment);
      if (value && value.type === 'url' && typeof value.url === 'string') return value.url;
      return segment.text;
    })
    .join('');
}

/** 「填下一处」：从片段下标 `from` 往后找下一个占位 token，到末尾从头再找；没有返回 -1。 */
export function nextSlotIndex(segments: readonly PromptSegmentLike[], from: number): number {
  const n = segments.length;
  const start = Number.isInteger(from) ? from : -1;
  for (let k = 1; k <= n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (isSlotToken(segments[i])) return i;
  }
  return -1;
}
