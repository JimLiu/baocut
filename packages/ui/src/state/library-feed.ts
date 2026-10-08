import type { LibraryEntrySummary, LibraryEvent, LibrarySnapshot } from '@baocut/protocol';

/**
 * `library` 主题（架构设计 §5.9）的唯一入口：`RuntimeSession.start()` 只订阅一次，把快照与事件交给这里，
 * 各个库的镜像（我的声音、术语表、品牌库……）用 `onLibraryEntries` 登记，拿到的是全部库的条目，自己按 `library` 挑。
 *
 * 为什么不各自订阅：`BaoCutClient` 每个主题只记一组回调，第二次 `subscribe('library')` 会顶掉第一次的。
 */

/** 主题里一条事件之后的条目表：`entry.upsert` 按库与 ID 替换或追加，`entry.removed` 拿掉。 */
export function applyLibraryEvent(entries: readonly LibraryEntrySummary[], event: LibraryEvent): LibraryEntrySummary[] {
  switch (event.type) {
    case 'entry.upsert': {
      const { entry } = event;
      const index = entries.findIndex((e) => e.library === entry.library && e.id === entry.id);
      if (index < 0) return [...entries, entry];
      const next = entries.slice();
      next[index] = entry;
      return next;
    }
    case 'entry.removed':
      return entries.filter((e) => !(e.library === event.library && e.id === event.id));
  }
}

type Listener = (entries: readonly LibraryEntrySummary[]) => void;

let current: LibraryEntrySummary[] | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  if (!current) return;
  for (const listener of listeners) listener(current);
}

/** 交给 `client.subscribe('library', libraryFeed)`。 */
export const libraryFeed = {
  snapshot(snapshot: LibrarySnapshot): void {
    current = snapshot.entries.slice();
    emit();
  },
  event(event: LibraryEvent): void {
    // 快照到之前不会有事件；真来了也只是先记下这一条。
    current = applyLibraryEvent(current ?? [], event);
    emit();
  },
};

/** 登记一个镜像：已经有快照时立刻收到一次，之后每次变化都收到全部条目。返回取消登记。 */
export function onLibraryEntries(listener: Listener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => void listeners.delete(listener);
}
