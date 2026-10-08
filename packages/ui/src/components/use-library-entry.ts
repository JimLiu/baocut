import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LibraryEntry, LibraryEntrySummary } from '@baocut/protocol';
import { entryKey } from '../model/library-entry.ts';
import { getLibraryEntry, openLibraryHandle } from '../runtime/library-commands.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useLibrary } from '../state/library-store.ts';

type Ref = Pick<LibraryEntrySummary, 'library' | 'id' | 'version'>;

/**
 * 一条用户库条目的完整内容（摘要里没有术语、色值与文件）。跟着摘要的版本走：主题送来新版本就重读。
 * `reload` 读当前版本（版本冲突之后用：主题的新版本可能还没到）。
 */
export function useLibraryEntry(ref: Ref | null): { entry: LibraryEntry | null; error: string | null; reload(): void } {
  const runtime = useRuntime();
  const key = ref ? entryKey(ref) : null;
  const [state, setState] = useState<{ key: string | null; entry: LibraryEntry | null; error: string | null }>({
    key: null,
    entry: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ref || !key) return;
    let live = true;
    // 重读时不带版本，拿 Runtime 里的当前版本。ref 的内容就是 key。
    getLibraryEntry(runtime, { library: ref.library, id: ref.id, ...(attempt ? {} : { version: ref.version }) }).then(
      (entry) => live && setState({ key, entry, error: null }),
      (error: Error) => live && setState({ key, entry: null, error: error.message }),
    );
    return () => {
      live = false;
    };
  }, [runtime, key, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return state.key === key ? { entry: state.entry, error: state.error, reload } : { entry: null, error: null, reload };
}

export interface BrandColor {
  id: string;
  name: string;
  value: string;
}

/** 品牌库里的颜色（取色面板用）：摘要里没有色值，逐条读出来（按版本缓存，各个取色面板共用）。 */
export function useBrandColors(): BrandColor[] {
  const runtime = useRuntime();
  const summaries = useLibrary((s) => s.brand);
  const colors = useMemo(() => summaries.filter((s) => s.kind === 'color'), [summaries]);
  const signature = colors.map(entryKey).join('|');
  const [values, setValues] = useState<{ signature: string; list: BrandColor[] }>({ signature: '', list: [] });
  useEffect(() => {
    if (!colors.length) return;
    let live = true;
    void Promise.all(
      colors.map((summary) =>
        getLibraryEntry(runtime, summary).then(
          ({ id, content }) =>
            'kind' in content && content.kind === 'color' ? { id, name: content.name, value: content.value } : null,
          () => null,
        ),
      ),
    ).then((list) => {
      if (live) setValues({ signature, list: list.filter((c): c is BrandColor => c !== null) });
    });
    return () => {
      live = false;
    };
    // signature 概括了 colors。
  }, [runtime, signature]);
  return colors.length && values.signature === signature ? values.list : EMPTY;
}

const EMPTY: BrandColor[] = [];

/** 带文件的品牌条目的读取地址（缩略图、字体预览）；取不到时 null。 */
export function useLibraryFileUrl(ref: Ref | null): string | null {
  const runtime = useRuntime();
  const key = ref ? entryKey(ref) : null;
  const [state, setState] = useState<{ key: string | null; url: string | null }>({ key: null, url: null });
  useEffect(() => {
    if (!ref || !key) return;
    let live = true;
    openLibraryHandle(runtime, { library: ref.library, id: ref.id, version: ref.version }).then(
      (handle) => live && setState({ key, url: handle.url }),
      () => live && setState({ key, url: null }),
    );
    return () => {
      live = false;
    };
  }, [runtime, key]);
  return state.key === key ? state.url : null;
}
