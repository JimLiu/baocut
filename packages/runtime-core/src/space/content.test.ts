import { describe, expect, it } from 'vitest';
import type { VideoSnapshot } from '@baocut/protocol';
import { DUB_EXTENSION, sourceSentences } from '@baocut/jobs';
import { extractContent, type ReadContentDocument, type ReadContentResult } from './content-extract.ts';
import { matchTerms, searchSegments, type SearchableVideo } from './content-search.ts';

/** 内容索引的抽取与检索：纯函数，不需要引擎。 */

function snapshot(extra: Partial<Record<string, unknown>> = {}): VideoSnapshot {
  return {
    rootSequenceId: 'seq',
    sequences: {
      seq: {
        id: 'seq',
        fps: { num: 30, den: 1 },
        items: [{ id: 'i1', type: 'video', assetRef: { id: 'a-used', revision: 'r1' } }],
        markers: [
          { id: 'm1', kind: 'chapter', frame: 300, durationFrames: 150, label: '第二章 开拍', summary: '准备器材' },
          { id: 'm2', kind: 'note', frame: 30, label: '不是章节' },
        ],
      },
    },
    assets: {
      'a-linked': {
        id: 'a-linked',
        name: '素材.mp4',
        revisions: { r1: { storage: { mode: 'linked', locator: { path: '../raw/clip.mp4' } } } },
      },
      'a-used': { id: 'a-used', name: '内置', revisions: { r1: { storage: { mode: 'managed' } } } },
    },
    ...extra,
  } as unknown as VideoSnapshot;
}

function speechDoc(id: string, plan: boolean): ReadContentDocument {
  return {
    documentId: id,
    kind: 'speech',
    name: '转写',
    language: 'zh',
    revision: '1',
    schema: 'baocut.speech/1',
    sourceAssetId: 'a-used',
    sourceDocumentId: null,
    body: {
      timescale: 1000,
      words: [
        { id: 'w1', text: '今天', start: 1000, end: 1400, speaker: '宝玉' },
        { id: 'w2', text: '剪辑', start: 1400, end: 1800, speaker: '宝玉' },
        { id: 'w3', text: '视频。', start: 1800, end: 2200, speaker: '宝玉' },
        { id: 'w4', text: 'Hello', start: 5000, end: 5400, speaker: 'Guest' },
      ],
      sentences: null,
    },
    plan: plan
      ? {
          sequenceId: 'seq',
          documentId: id,
          unit: 'speech' as const,
          clock: 'sequence' as const,
          scope: { basis: 'root', captionItemIds: [], scopeItemIds: [] },
          range: { startSeconds: 0, endSeconds: 10, durationSeconds: 10 },
          entries: [
            { key: 'w1', id: 'w1', start: 11, end: 11.4, text: '今天', speaker: '宝玉', wordTiming: true },
            { key: 'w2', id: 'w2', start: 11.4, end: 11.8, text: '剪辑', speaker: '宝玉', wordTiming: true },
            { key: 'w3', id: 'w3', start: 11.8, end: 12.2, text: '视频。', speaker: '宝玉', wordTiming: true },
          ],
          sourceCount: 4,
          omittedCount: 1,
        }
      : null,
  };
}

function result(documents: ReadContentResult['documents']): ReadContentResult {
  return { videoId: 'v1', name: '访谈', revision: 'rev-1', snapshot: snapshot(), documents };
}

describe('内容抽取', () => {
  it('转写用时间线投影（序列时间），投影为空时退回源时间', () => {
    const projected = extractContent(result([speechDoc('d1', true)]), '/p/访谈');
    const speech = projected.segments.filter((s) => s.kind === 'speech');
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.every((s) => s.clock === 'sequence')).toBe(true);
    expect(speech.map((s) => s.text).join('')).toContain('剪辑');
    expect(speech.map((s) => s.text).join('')).not.toContain('Hello');

    const source = extractContent(result([speechDoc('d1', false)]), '/p/访谈');
    const fallback = source.segments.filter((s) => s.kind === 'speech');
    expect(fallback.every((s) => s.clock === 'source')).toBe(true);
    expect(fallback.map((s) => s.text).join('')).toContain('Hello');
    expect(fallback.find((s) => s.text.includes('剪辑'))).toMatchObject({ start: 1, speaker: '宝玉' });
  });

  it('译文 /2 借用转写的时间，过期的单元不收；/1 照旧按单元 ID', () => {
    const translation2 = {
      documentId: 't2',
      kind: 'translation',
      language: 'en',
      schema: 'baocut.translation/2',
      sourceDocumentId: 'd1',
      body: {
        schema: 'baocut.translation/2',
        units: [
          { id: 'u1', sourceSentenceId: 's-w1', naturalText: 'Editing video today.', alignment: { sourceWordIds: ['w1', 'w2', 'w3'] } },
          { id: 'u2', sourceSentenceId: 's-w4', naturalText: 'Old text', status: 'stale' },
          { id: 'u3', sourceSentenceId: 's-w4', naturalText: 'Hi', displayRewrite: { text: 'Hello there' } },
        ],
      },
    };
    const extracted = extractContent(result([speechDoc('d1', false), translation2]), '/p/访谈');
    const units = extracted.segments.filter((s) => s.kind === 'translation');
    expect(units.map((u) => u.text)).toEqual(['Editing video today.', 'Hello there']);
    expect(units[0]).toMatchObject({ clock: 'source', start: 1, end: 2.2, language: 'en', documentId: 't2' });
    expect(units[1]).toMatchObject({ start: 5 });

    const translation1 = {
      documentId: 't1',
      kind: 'translation',
      schema: 'baocut.translation/1',
      sourceDocumentId: 'd1',
      body: { units: [{ id: 'nope', text: '旧译文' }] },
    };
    const legacy = extractContent(result([translation1]), '/p/访谈');
    expect(legacy.segments).toContainEqual(expect.objectContaining({ kind: 'translation', text: '旧译文', start: 0 }));
  });

  it('章节取根序列的 chapter 标记；视频事实与读不出的文档', () => {
    const extracted = extractContent(result([{ documentId: 'bad', kind: 'caption', error: '正文坏了' }]), '/p/访谈');
    expect(extracted.segments).toEqual([expect.objectContaining({ kind: 'chapter', text: '第二章 开拍\n准备器材', start: 10, end: 15 })]);
    expect(extracted.problems).toEqual([{ documentId: 'bad', detail: '正文坏了' }]);
    expect(extracted.facts.timelineAssetIds).toEqual(['a-used']);
    expect(extracted.facts.linkedFiles).toEqual([{ assetId: 'a-linked', name: '素材.mp4', path: '/p/raw/clip.mp4' }]);
  });
});

describe('视频事实：时长与画布尺寸', () => {
  it('取根序列：时长是最晚结束的实例（按序列帧率），尺寸是画布', () => {
    const complete = snapshot({
      sequences: {
        seq: {
          id: 'seq',
          fps: { num: 30000, den: 1001 },
          canvas: { width: 1080, height: 1920, workingSpace: 'srgb', background: '#000000' },
          tracks: [{ id: 't1', visible: true }],
          items: [
            {
              id: 'i1',
              type: 'video',
              trackId: 't1',
              assetRef: { id: 'a-used', revision: 'r1' },
              span: { fromFrame: 0, durationFrames: 90 },
            },
            {
              id: 'i2',
              type: 'image',
              trackId: 't1',
              assetRef: { id: 'a-used', revision: 'r1' },
              span: { fromFrame: 60, durationFrames: 90 },
            },
          ],
          markers: [],
        },
        other: {
          id: 'other',
          fps: { num: 30, den: 1 },
          canvas: { width: 640, height: 360 },
          tracks: [],
          items: [{ id: 'o1', type: 'image', span: { fromFrame: 0, durationFrames: 9000 } }],
        },
      },
    });
    const { facts } = extractContent({ ...result([]), snapshot: complete }, '/p/访谈');
    // 150 帧 × 1001 / 30000 = 5.005 秒；别的序列不算。
    expect(facts.timeline).toEqual({ durationSec: 5.005, width: 1080, height: 1920 });
  });

  it('快照不全（没有轨道、画布或实例的区间）时没有', () => {
    expect(extractContent(result([]), '/p/访谈').facts.timeline).toBeNull();
    const noCanvas = snapshot({
      sequences: { seq: { id: 'seq', fps: { num: 30, den: 1 }, tracks: [], items: [], markers: [] } },
    });
    expect(extractContent({ ...result([]), snapshot: noCanvas }, '/p/访谈').facts.timeline).toBeNull();
  });
});

describe('视频事实：文稿、译文与配音组', () => {
  it('没有文稿时三项都是空的', () => {
    const { facts } = extractContent(result([]), '/p/访谈');
    expect(facts).toMatchObject({ transcripts: [], translations: [], dubGroups: [] });
  });

  it('转写的语言、逐词时间与是否在时间线上', () => {
    const estimated = speechDoc('d2', false);
    const body = estimated.body as { words: Array<Record<string, unknown>> };
    body.words[1]!.timingQuality = 'estimated';
    const { facts } = extractContent(result([speechDoc('d1', true), { ...estimated, name: '粗转写', language: 'en' }]), '/p/访谈');
    expect(facts.transcripts).toEqual([
      { documentId: 'd1', name: '转写', language: 'zh', wordTiming: true, onTimeline: true },
      { documentId: 'd2', name: '粗转写', language: 'en', wordTiming: false, onTimeline: false },
    ]);
  });

  it('译文的目标语言、译自的转写与过期的单元', () => {
    const speech = speechDoc('d1', false);
    const read = sourceSentences({ schema: 'baocut.speech/1', ...(speech.body as object) });
    if (!('sentences' in read)) throw new Error(read.problem);
    const [first, second] = read.sentences;
    const translation = {
      documentId: 't2',
      kind: 'translation',
      name: '英文',
      language: 'en',
      schema: 'baocut.translation/2',
      sourceDocumentId: 'd1',
      body: {
        units: [
          { id: 'u1', sourceSentenceId: first!.id, sourceFingerprint: first!.fingerprint, naturalText: 'Editing video today.' },
          { id: 'u2', sourceSentenceId: second!.id, sourceFingerprint: 'sha256:old', naturalText: 'Hello' },
          { id: 'u3', sourceSentenceId: second!.id, sourceFingerprint: second!.fingerprint, naturalText: 'Hi', status: 'stale' },
          { id: 'u4', sourceSentenceId: second!.id, sourceFingerprint: second!.fingerprint, naturalText: ' ' },
          { id: 'u5', sourceSentenceId: 's-gone', sourceFingerprint: 'sha256:x', naturalText: 'Gone' },
        ],
      },
    };
    const { facts } = extractContent(result([speech, translation]), '/p/访谈');
    // u2 指纹不符、u3 标成过期、u4 为空、u5 原句不在了。
    expect(facts.translations).toEqual([
      { documentId: 't2', name: '英文', language: 'en', sourceDocumentId: 'd1', units: 5, staleUnits: 4 },
    ]);

    // 转写不在视频里：全部过期；/1 的译文只数标成过期的与空的。
    const orphan = extractContent(result([translation]), '/p/访谈').facts.translations[0]!;
    expect(orphan.staleUnits).toBe(5);
    const legacy = extractContent(
      result([
        {
          documentId: 't1',
          kind: 'translation',
          schema: 'baocut.translation/1',
          sourceDocumentId: 'd1',
          body: {
            units: [
              { id: 'a', text: '旧译文' },
              { id: 'b', text: '' },
              { id: 'c', text: '过期', status: 'stale' },
            ],
          },
        },
      ]),
      '/p/访谈',
    ).facts.translations[0]!;
    expect(legacy).toMatchObject({ language: null, sourceDocumentId: 'd1', units: 3, staleUnits: 2 });
  });

  it('配音组：配音计划与配音实例合起来，背景声不算实例', () => {
    const snap = snapshot({
      documents: {
        plan1: {
          id: 'plan1',
          kind: 'dubbing-plan',
          name: '英文配音',
          language: 'en',
          sourceDocumentId: 't2',
          currentRevision: 'r1',
          revisions: { r1: { summary: { groupId: 'g1' } } },
        },
      },
    });
    const seq = (snap.sequences as Record<string, { items: unknown[] }>).seq!;
    seq.items.push(
      { id: 'dub1', type: 'audio', extensions: { [DUB_EXTENSION]: { groupId: 'g1', language: 'en', unitId: 'u1' } } },
      { id: 'dub2', type: 'audio', extensions: { [DUB_EXTENSION]: { groupId: 'g1', language: 'en', unitId: 'u2' } } },
      { id: 'bg', type: 'audio', extensions: { [DUB_EXTENSION]: { groupId: 'g1', stem: 'background' } } },
      { id: 'dub3', type: 'audio', extensions: { [DUB_EXTENSION]: { groupId: 'g2', language: 'ja', unitId: 'u1' } } },
    );
    const translation = {
      documentId: 't2',
      kind: 'translation',
      language: 'en',
      schema: 'baocut.translation/2',
      sourceDocumentId: 'd1',
      body: { units: [] },
    };
    const { facts } = extractContent(
      { videoId: 'v1', name: '访谈', revision: 'rev-1', snapshot: snap, documents: [speechDoc('d1', false), translation] },
      '/p/访谈',
    );
    expect(facts.dubGroups).toEqual([
      { groupId: 'g1', language: 'en', planDocumentId: 'plan1', translationId: 't2', transcriptId: 'd1', items: 2 },
      { groupId: 'g2', language: 'ja', planDocumentId: null, translationId: null, transcriptId: null, items: 1 },
    ]);
  });
});

describe('内容检索', () => {
  const videos: SearchableVideo[] = [
    {
      videoId: 'v1',
      videoName: '访谈',
      entryId: 'sp_1',
      projectId: 'p1',
      revision: 'r1',
      segments: [
        {
          kind: 'speech',
          documentId: 'd1',
          language: 'zh',
          clock: 'sequence',
          start: 20,
          end: 22,
          text: '我们来剪辑视频',
          speaker: '宝玉',
        },
        { kind: 'speech', documentId: 'd1', language: 'zh', clock: 'sequence', start: 3, end: 5, text: '视频剪辑很好玩', speaker: 'Guest' },
        { kind: 'chapter', documentId: null, language: null, clock: 'sequence', start: 3, end: 9, text: '剪辑入门', speaker: null },
      ],
    },
    {
      videoId: 'v2',
      videoName: 'Vlog',
      entryId: 'sp_2',
      projectId: null,
      revision: 'r9',
      segments: [
        { kind: 'caption', documentId: 'c1', language: 'en', clock: 'source', start: 1, end: 2, text: 'ＥＤＩＴ the Video', speaker: null },
      ],
    },
  ];

  it('子串、多词 AND、大小写与全角不敏感；按视频顺序与时间排', () => {
    const { hits, truncated } = searchSegments(videos, { query: '剪辑', limit: 10 });
    expect(truncated).toBe(false);
    expect(hits.map((h) => [h.videoId, h.documentKind, h.time.start])).toEqual([
      ['v1', 'chapter', 3],
      ['v1', 'speech', 3],
      ['v1', 'speech', 20],
    ]);
    expect(hits[2]).toMatchObject({
      snippet: '我们来剪辑视频',
      highlights: [[3, 5]],
      speaker: '宝玉',
      indexedRevision: 'r1',
      entryId: 'sp_1',
    });

    expect(searchSegments(videos, { query: 'edit video', limit: 10 }).hits).toEqual([
      expect.objectContaining({ videoId: 'v2', documentKind: 'caption', time: { clock: 'source', start: 1, end: 2 } }),
    ]);
    expect(searchSegments(videos, { query: '剪辑 好玩', limit: 10 }).hits).toHaveLength(1);
    expect(searchSegments(videos, { query: '剪辑', kinds: ['chapter'], limit: 10 }).hits).toHaveLength(1);
    expect(searchSegments(videos, { query: '', speaker: 'guest', limit: 10 }).hits).toEqual([
      expect.objectContaining({ snippet: '视频剪辑很好玩', highlights: [] }),
    ]);
    expect(searchSegments(videos, { query: '剪辑', limit: 2 })).toMatchObject({ truncated: true, hits: [{}, {}] });
  });

  it('长段落截取命中附近并改写位置', () => {
    const text = `${'前'.repeat(200)}关键词${'后'.repeat(200)}`;
    const found = matchTerms(text, ['关键词'])!;
    expect(found.snippet.startsWith('…')).toBe(true);
    expect(found.snippet.endsWith('…')).toBe(true);
    const [a, b] = found.highlights[0]!;
    expect(found.snippet.slice(a, b)).toBe('关键词');
    expect(matchTerms(text, ['关键词', '没有'])).toBeNull();
  });
});
