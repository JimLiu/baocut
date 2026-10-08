import { describe, expect, it } from 'vitest';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { libraryFeed } from './library-feed.ts';
import { useLibrary } from './library-store.ts';

const entry = (library: LibraryEntrySummary['library'], id: string, name: string, version = 1): LibraryEntrySummary => ({
  library,
  id,
  version,
  contentHash: `sha256:${id}`,
  name,
  kind: library === 'brand' ? 'color' : library === 'voices' ? 'voice' : 'transcription',
  updatedAt: '2026-10-03T00:00:00.000Z',
});

describe('useLibrary', () => {
  it('快照到了才 ready；术语表与品牌库各自按名字排，音色不进来', () => {
    expect(useLibrary.getState().ready).toBe(false);
    libraryFeed.snapshot({
      entries: [entry('glossaries', 'gls_b', 'Beta'), entry('voices', 'voc_a', 'Voice'), entry('brand', 'brd_a', 'Accent')],
    });
    const state = useLibrary.getState();
    expect(state.ready).toBe(true);
    expect(state.glossaries.map((e) => e.id)).toEqual(['gls_b']);
    expect(state.brand.map((e) => e.id)).toEqual(['brd_a']);
  });

  it('新增、改名与删除跟着事件走，改名后重新排序', () => {
    libraryFeed.snapshot({ entries: [entry('glossaries', 'gls_b', 'Beta')] });
    libraryFeed.event({ type: 'entry.upsert', entry: entry('glossaries', 'gls_a', 'Alpha') });
    expect(useLibrary.getState().glossaries.map((e) => e.id)).toEqual(['gls_a', 'gls_b']);
    libraryFeed.event({ type: 'entry.upsert', entry: entry('glossaries', 'gls_a', 'Gamma', 2) });
    expect(useLibrary.getState().glossaries.map((e) => [e.id, e.version])).toEqual([
      ['gls_b', 1],
      ['gls_a', 2],
    ]);
    libraryFeed.event({ type: 'entry.removed', library: 'glossaries', id: 'gls_b' });
    expect(useLibrary.getState().glossaries.map((e) => e.id)).toEqual(['gls_a']);
  });
});
