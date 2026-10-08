import { create } from 'zustand';
import type { Id, SpaceEntry } from '@baocut/protocol';
import { useShell } from './shell-store.ts';

/**
 * 「在 Space 中查看」要打开的条目（工具结果、任务详情）：去 Space 那一类并记下条目，Space 页挂上后打开它的查看器、清掉记号。
 * 只活在内存里，不进路由。
 */
export const useSpaceFocus = create<{ focus: Id | null }>()(() => ({ focus: null }));

export function showInSpace(entry: Pick<SpaceEntry, 'id' | 'kind'>): void {
  useSpaceFocus.setState({ focus: entry.id });
  useShell.getState().go({ tab: 'space', category: entry.kind, projectId: null });
}

/** Space 页取走记号：条目已经在目录里时返回它的 ID 并清掉，否则 null（留着等目录到）。 */
export function takeSpaceFocus(known: (id: Id) => boolean): Id | null {
  const { focus } = useSpaceFocus.getState();
  if (!focus || !known(focus)) return null;
  useSpaceFocus.setState({ focus: null });
  return focus;
}
