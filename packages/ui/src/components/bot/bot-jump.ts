import type { Id } from '@baocut/protocol';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useTimeline } from '../../state/timeline-store.ts';

/** 往前翻页直到这一条载入（最多十页），再滚到它。线程里每条用户、智能体消息带 `data-find-item`，Bot 条目带 `data-bot-item`。 */
export async function jumpTo(runtime: RuntimeSession, conversationId: Id, itemId: Id): Promise<void> {
  for (let page = 0; page < 10; page++) {
    const state = useTimeline.getState().byConversationId[conversationId];
    if (!state || state.items.some((item) => item.id === itemId)) break;
    const before = state.offset;
    await runtime.loadEarlier(conversationId);
    if (useTimeline.getState().byConversationId[conversationId]?.offset === before) break;
  }
  requestAnimationFrame(() => {
    const id = CSS.escape(itemId);
    const target = document.querySelector<HTMLElement>(`[data-find-item="${id}"], [data-bot-item="${id}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
