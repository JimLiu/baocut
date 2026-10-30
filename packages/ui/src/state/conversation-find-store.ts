import { create } from 'zustand';
import type { Id } from '@baocut/protocol';

/**
 * 在会话中查找的查找条开在哪条会话上（产品设计 §3.2.2「在会话中查找」）：会话头菜单与 ⌘F 都走这里，线程上方的查找条跟着它。
 * `focus` 每叫一次加一：查找条已经开着时再叫，把光标放回搜索框并全选。只活在内存里。
 */
export const useConversationFind = create<{ openIn: Id | null; focus: number }>()(() => ({ openIn: null, focus: 0 }));

export function openConversationFind(conversationId: Id): void {
  useConversationFind.setState((s) => ({ openIn: conversationId, focus: s.focus + 1 }));
}

/** 关掉这条会话上的查找条；开在别的会话上的不动。 */
export function closeConversationFind(conversationId: Id): void {
  if (useConversationFind.getState().openIn === conversationId) useConversationFind.setState({ openIn: null });
}
