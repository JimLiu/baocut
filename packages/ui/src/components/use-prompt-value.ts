import { useState } from 'react';
import { PromptFieldValue } from '@react-spectrum/ai';
import { fromPromptSegments, nextSlotIndex, toPromptSegments } from '../model/prompt-slots.ts';

/** 草稿字符串 → PromptFieldValue：`{{label}}` 变占位 token（模板包规范 §5.5），光标放在最后一个片段的末尾。 */
function valueOf(text: string): PromptFieldValue {
  const segments = toPromptSegments(text);
  const last = segments.length - 1;
  return new PromptFieldValue(segments).withCaretPosition(
    last >= 0 ? { index: last, offset: segments[last]!.text.length } : { index: 0, offset: 0 },
  );
}

/**
 * 选中片段 `from` 之后的下一个占位 token（到末尾从头再找）；没有占位 token 时原样返回。
 * `from` 缺省取选区的后端：选中一个 token 时就从它后面接着找。
 */
export function selectNextSlot(value: PromptFieldValue, from = value.selectedRange.end.index): PromptFieldValue {
  const i = nextSlotIndex(value.segments, from);
  if (i < 0) return value;
  const range = new PromptFieldValue.SelectedRange({ index: i, offset: 0 }, { index: i, offset: value.segments[i]!.text.length });
  return value.withSelectedRange(range);
}

/**
 * 字符串草稿与 PromptField 的值之间的桥（原型 ui.jsx 的 PromptField）。
 * 自己打的字原样留着 PromptFieldValue，光标与撤销不丢；只有草稿从外面换了（起点预填、模板填入、发送后清空、发送失败放回），
 * 才按新字符串重建，光标放到末尾。草稿里的 `{{label}}` 画成占位 token，序列化时写回 `{{label}}`
 * （S2 的 toString 会把它写成 label，占位性就丢了）；用户自己打的 `{{x}}` 不经过重建，照旧是文字。
 */
export function usePromptValue(
  text: string,
  onText: (text: string) => void,
): [PromptFieldValue, (value: PromptFieldValue) => void, (from?: number) => void] {
  const [state, setState] = useState(() => ({ text, value: valueOf(text) }));
  let current = state;
  if (text !== state.text) {
    current = { text, value: valueOf(text) };
    setState(current);
  }
  const onChange = (value: PromptFieldValue) => {
    const next = fromPromptSegments(value.segments);
    setState({ text: next, value });
    if (next !== text) onText(next);
  };
  // 「填下一处」与填入带占位符的草稿后选中下一处：只改选区、不改文字，按 state 里最新的值算（可以在定时器里调）。
  // `from`：从哪个片段之后找；输入框重新聚焦时 TokenField 会按 DOM 重设光标，调用方要在聚焦前记下原来的位置。
  const selectSlot = (from?: number) => setState((s) => ({ ...s, value: selectNextSlot(s.value, from) }));
  return [current.value, onChange, selectSlot];
}

/**
 * 聚焦 PromptField（或包着它的元素）里的输入框，光标放到末尾，接着已有的草稿往下写。
 * 输入框是 contenteditable：TokenField 只在已聚焦时才把光标写回 DOM，程序聚焦会落在开头；
 * 所以聚焦后直接把 DOM 选区收到末尾，TokenField 会跟着 selectionchange 更新光标。
 */
export function focusPromptEnd(container: Element | null | undefined) {
  const input = container?.querySelector<HTMLElement>('[role="textbox"]');
  if (!input) return;
  input.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(input);
  selection?.collapseToEnd();
}
