import { describe, expect, it } from 'vitest';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { applyLibraryEvent, libraryFeed, onLibraryEntries } from './library-feed.ts';
import { useVoices } from './voices-store.ts';

function summary(library: LibraryEntrySummary['library'], id: string, patch: Partial<LibraryEntrySummary> = {}): LibraryEntrySummary {
  return { library, id, version: 1, contentHash: 'sha256:0', name: id, kind: library === 'voices' ? 'voice' : 'transcription', updatedAt: '2026-10-01T00:00:00Z', ...patch };
}

describe('library 主题的条目表', () => {
  it('upsert 按库与 ID 替换或追加；removed 只拿掉那一个库里的', () => {
    const a = summary('voices', 'voc_1');
    const b = summary('glossaries', 'voc_1');
    let entries = applyLibraryEvent([a, b], { type: 'entry.upsert', entry: { ...a, version: 2, name: '新名字' } });
    expect(entries).toEqual([{ ...a, version: 2, name: '新名字' }, b]);
    entries = applyLibraryEvent(entries, { type: 'entry.upsert', entry: summary('voices', 'voc_2') });
    expect(entries.map((e) => e.id)).toEqual(['voc_1', 'voc_1', 'voc_2']);
    entries = applyLibraryEvent(entries, { type: 'entry.removed', library: 'voices', id: 'voc_1' });
    expect(entries).toEqual([b, summary('voices', 'voc_2')]);
  });

  it('一次订阅分给多个镜像：后登记的立刻拿到当前条目，取消登记后不再收到', () => {
    libraryFeed.snapshot({ entries: [summary('voices', 'voc_1'), summary('glossaries', 'gls_1')] });
    const first: number[] = [];
    const second: number[] = [];
    const offFirst = onLibraryEntries((entries) => first.push(entries.length));
    onLibraryEntries((entries) => second.push(entries.length));
    expect(first).toEqual([2]);
    expect(second).toEqual([2]);

    offFirst();
    libraryFeed.event({ type: 'entry.upsert', entry: summary('brand', 'brd_1') });
    expect(first).toEqual([2]);
    expect(second).toEqual([2, 3]);
  });

  it('我的声音只留音色，按名字排', () => {
    libraryFeed.snapshot({
      entries: [summary('voices', 'voc_b', { name: '旁白' }), summary('glossaries', 'gls_1'), summary('voices', 'voc_a', { name: '主播' })],
    });
    const { ready, voices } = useVoices.getState();
    expect(ready).toBe(true);
    expect(voices.map((v) => v.name)).toEqual(['旁白', '主播'].sort((x, y) => x.localeCompare(y, 'zh-CN')));
    libraryFeed.event({ type: 'entry.removed', library: 'voices', id: 'voc_b' });
    expect(useVoices.getState().voices.map((v) => v.id)).toEqual(['voc_a']);
  });
});
