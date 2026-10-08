import type { Id } from '@baocut/protocol';
import { MessageSuggestion } from '@react-spectrum/ai';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { THREAD_EMPTY_COPY } from '../../copy.ts';
import { useContextTag } from '../../state/agent-context.ts';
import { useShell } from '../../state/shell-store.ts';
import { focusPromptEnd } from '../use-prompt-value.ts';

/** 原型 ui.css `.ath__empty` :2755-2761、spectrum.css `.bc-ai-suggestions` :26。 */
const empty = style({
  boxSizing: 'border-box',
  width: 'full',
  maxWidth: 560,
  marginX: 'auto',
  paddingTop: 56,
  paddingX: 24,
  paddingBottom: 24,
  textAlign: 'center',
});
const glyph = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 48,
  borderRadius: '[10px]',
  backgroundColor: 'blue-200',
  color: 'blue-1000',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const greet = style({ marginTop: 16, marginBottom: 0, font: 'heading-sm', color: 'gray-900' });
const sub = style({ marginTop: 8, marginBottom: 0, font: 'body', color: 'gray-600' });
const suggestions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 });

/**
 * 空会话（原型 agent-thread.jsx `AgentThread` 空态 :461-475）：已有、但还没有一条消息的会话。新会话的起始页（start-page.tsx）
 * 有自己的一套，不在这里。编辑器开着这条会话来源里的视频时，问候带上视频名，建议换成编辑器那一组（原型按
 * `cur.project` 选 `agent.chips.editor` / `agent.chips.home`）。点一条建议把它写进这条会话的草稿（替换原有草稿，同原型
 * `patch({draft})`）并把光标放进输入框末尾。
 *
 * 原型用 `MessageSuggestionList aria-label="试着问问"`；S2 AI 的 MessageSuggestionList 的 `title` 必填、画成可见的 h3，
 * 原型不显示标题，所以这里用带 `aria-label` 的 group 包 MessageSuggestion，排法同它（换行、间距 8）。
 */
export function ThreadEmpty({ conversationId, projectId }: { conversationId: Id; projectId: Id | null }) {
  const tag = useContextTag({ conversationId, projectId });
  const videoName = tag?.videoName || null;
  const chips = videoName ? THREAD_EMPTY_COPY.chipsVideo : THREAD_EMPTY_COPY.chips;

  const pick = (text: string) => {
    useShell.getState().setDraft(conversationId, text);
    requestAnimationFrame(() => focusPromptEnd(document.querySelector(`[data-composer="${CSS.escape(conversationId)}"]`)));
  };

  return (
    <div className={empty}>
      <span className={glyph} data-bc-icons="primary" aria-hidden>
        <AIMark />
      </span>
      <h2 className={greet}>{videoName ? THREAD_EMPTY_COPY.greetVideo(videoName) : THREAD_EMPTY_COPY.greet}</h2>
      <p className={sub}>{videoName ? THREAD_EMPTY_COPY.subVideo : THREAD_EMPTY_COPY.sub}</p>
      <div className={suggestions} role="group" aria-label={THREAD_EMPTY_COPY.suggestions}>
        {chips.map((chip) => (
          <MessageSuggestion key={chip} onPress={() => pick(chip)}>
            {chip}
          </MessageSuggestion>
        ))}
      </div>
    </div>
  );
}
