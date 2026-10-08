import { describe, expect, it } from 'vitest';
import type { CaptionItem, DocumentRecord, EditOperation, Sequence, Track, VideoItem } from '@baocut/protocol';
import { CUE_PARAMS, displayWidth, readSpeechWords, translationCues, type CueTranslationUnit } from './caption-cues.ts';
import {
  DEFAULT_CAPTION_STYLE_BODY,
  TRANSLATION_CAPTION_EXTENSION,
  planCaptionLayer,
  type CaptionDocumentReader,
  type CaptionLayerPlan,
} from './caption-layer.ts';
import { PipelineStepError } from './pipeline.ts';

/**
 * 没有 Worker 字幕条的译文（智能体自己写的）建字幕层：`translationCues` 与编辑器的同名函数切法相同（期望值照
 * `packages/ui/src/model/translation-cues.test.ts`），`planCaptionLayer` 算出的事务与编辑器「放到画面上」相同；
 * 已有字幕层时照样新建一层（§7.9「不覆盖」）。
 */

const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

function video(id: string, fromFrame: number, durationFrames: number): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1000 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function caption(id: string, trackId: string, documentId: string, extra: Partial<CaptionItem> = {}): CaptionItem {
  return { ...base, id, trackId, type: 'caption', span: { fromFrame: 0, durationFrames: 90 }, documentId, ...extra };
}

const track = (id: string, order: number, kind: Track['kind']): Track => ({
  id,
  order,
  kind,
  locked: false,
  visible: true,
  muted: false,
  solo: { enabled: false, group: 'visual' },
});

function sequence(items: Sequence['items'], tracks: Track[] = [track('v1', 0, 'visual')]): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps: { num: 30, den: 1 },
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks,
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

const speechBody = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  sentences: null,
  speakers: [{ id: 'A', name: '主持人' }],
  words: [
    { id: 'w1', start: 0, end: 500, text: '今天', speaker: 'A' },
    { id: 'w2', start: 500, end: 1000, text: '很好。', speaker: 'A' },
    { id: 'w3', start: 2000, end: 2600, text: '我们', speaker: 'A' },
    { id: 'w4', start: 2600, end: 3000, text: '开始。', speaker: 'A' },
  ],
};
const speech = readSpeechWords(speechBody)!;

function unit(id: string, words: string[], text: string, extra: Partial<CueTranslationUnit> = {}): CueTranslationUnit {
  return { id, naturalText: text, alignment: { sourceWordIds: words }, status: 'draft', ...extra };
}

describe('译文 → 字幕条（与编辑器的 translationCues 相同）', () => {
  it('时间取原句成员词的时间（素材时钟）；过期与空的单元不出字幕', () => {
    const cues = translationCues(speech, [
      unit('t-s-w1', ['w1', 'w2'], 'It is fine today.'),
      unit('t-s-w3', ['w3', 'w4'], "Let's begin."),
      unit('t-s-x', ['w1'], 'stale', { status: 'stale' }),
      unit('t-s-y', ['w3'], '  '),
    ]);
    expect(cues.map((c) => [c.id, c.text, c.start, c.end, c.speaker])).toEqual([
      ['q-t-s-w1', 'It is fine today.', 0, 1, 'A'],
      ['q-t-s-w3', "Let's begin.", 2, 3, 'A'],
    ]);
  });

  it('改写的显示文本优先；没有对齐、一个词也找不到的单元不出', () => {
    const cues = translationCues(speech, [
      unit('t-s-w1', ['w1', 'w2'], 'It is fine today.', { displayRewrite: { text: 'Fine today.' } }),
      unit('t-s-w3', ['w3', 'w4'], "Let's begin.", { alignment: null }),
      unit('t-s-z', ['nope'], 'Gone.'),
    ]);
    expect(cues.map((c) => [c.id, c.text])).toEqual([['q-t-s-w1', 'Fine today.']]);
  });

  it('长译文按显示宽度切成几条，时间按宽度插值，不跨出原句', () => {
    const long = 'This is a rather long translated sentence, which certainly needs to wrap onto more than one caption line.';
    const cues = translationCues(speech, [unit('t-s-w1', ['w1', 'w2'], long)]);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.id).toBe('q-t-s-w1');
    expect(cues.slice(1).every((c) => /^q-t-s-w1~\d+$/.test(c.id))).toBe(true);
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBe(1);
    expect(cues.map((c) => c.text).join(' ')).toBe(long);
  });

  it('中日韩的译文在全角标点后断开，按全角宽度计；拼回去与原文相同', () => {
    for (const text of [
      '今天天气非常好，我们一起去公园散步吧，然后在湖边的小餐馆里吃一顿简单的午饭，下午再慢慢走回家休息。',
      '今日はとても良い天気なので、みんなで公園を散歩して、湖のそばの小さなお店で昼ごはんを食べましょう。',
      '오늘은 날씨가 아주 좋아서 우리 모두 함께 공원을 산책하고 호숫가의 작은 식당에서 점심을 먹읍시다.',
    ]) {
      const cues = translationCues(speech, [unit('t-s-w1', ['w1', 'w2'], text)]);
      expect(cues.length).toBeGreaterThan(1);
      expect(cues.every((c) => c.start >= 0 && c.end <= 1 && c.start < c.end)).toBe(true);
      expect(cues.every((c) => displayWidth(c.text) <= CUE_PARAMS.maxChars + CUE_PARAMS.overflowSlack)).toBe(true);
      expect(cues.map((c) => c.text).join(text.includes(' ') ? ' ' : '')).toBe(text);
    }
  });

  it('不用空格也没有标点的文字（泰文）按显示宽度硬切', () => {
    const text = 'สวัสดีครับวันนี้อากาศดีมากเราจะไปเที่ยวทะเลด้วยกันแล้วกินข้าวเที่ยงที่ร้านริมหาดก่อนกลับบ้านตอนเย็น';
    const cues = translationCues(speech, [unit('t-s-w1', ['w1', 'w2'], text)]);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((c) => displayWidth(c.text) <= CUE_PARAMS.maxChars + CUE_PARAMS.overflowSlack)).toBe(true);
    expect(cues.map((c) => c.text).join('')).toBe(text);
  });
});

const doc = (id: string, kind: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  kind,
  name: id,
  currentRevision: '1',
  revisions: {},
  ...extra,
});

describe('planCaptionLayer：智能体的 captions_create', () => {
  const translationBody = (units: unknown[]) => ({
    schema: 'baocut.translation/2',
    language: 'en',
    sourceBasis: { speechRef: { id: 'speech', revision: '1' }, sequenceId: 'seq', scopeLineage: [], editViewHash: 'h' },
    units,
  });
  const aligned = (id: string, words: string[], text: string) => ({
    id,
    sourceSentenceId: id.slice(2),
    sourceFingerprint: 'fp',
    naturalText: text,
    alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: words, textHash: 'sha256:x' },
    status: 'draft',
  });
  const documents: Record<string, DocumentRecord> = {
    speech: doc('speech', 'speech', { sourceAssetId: 'asset', language: 'zh-Hans' }),
    trans: doc('trans', 'translation', { sourceDocumentId: 'speech', language: 'en' }),
    orig: doc('orig', 'caption', { sourceDocumentId: 'speech', sourceAssetId: 'asset' }),
    tcap: doc('tcap', 'caption', { sourceDocumentId: 'trans', sourceAssetId: 'asset' }),
  };
  const bodies: Record<string, unknown> = {
    speech: speechBody,
    trans: translationBody([aligned('t-s-w1', ['w1', 'w2'], 'It is fine today.'), aligned('t-s-w3', ['w3', 'w4'], "Let's begin.")]),
  };
  const reader = (overrides: Record<string, unknown> = {}): CaptionDocumentReader => ({
    document: async (_videoId, documentId) => ({ revision: '1', body: { ...bodies, ...overrides }[documentId] }),
  });
  const tracks = [track('v1', 0, 'visual'), track('s1', 1, 'subtitle')];
  const translation = (bilingual: boolean) => ({
    kind: 'translation' as const,
    documentId: 'trans',
    bilingual,
    cues: 'sentence-alignment' as const,
  });
  const types = (plan: CaptionLayerPlan) => plan.operations.map((op: EditOperation) => op.type);

  async function plan(seq: Sequence, source: Parameters<typeof planCaptionLayer>[1]['source'], overrides?: Record<string, unknown>) {
    const result = await planCaptionLayer(reader(overrides), { videoId: 'v', sequence: seq, documents, source });
    if ('reason' in result) throw new Error(`没有算出事务：${result.reason}`);
    return result;
  }

  it('转写：原文字幕层放进空着的字幕轨，没有时新建一条', async () => {
    const created = await plan(sequence([video('a', 0, 90)]), { kind: 'speech', documentId: 'speech' });
    expect(types(created)).toEqual(['addTrack', 'putDocument', 'insertItems']);
    expect(created).toMatchObject({ cueCount: 2, enabled: true, existing: null });
    expect(created.operations[1]).toMatchObject({ kind: 'caption', sourceDocument: { documentId: 'speech' }, summary: { cueCount: 2 } });
    expect(created.operations[1]).not.toHaveProperty('extensions.pipeline');

    const free = await plan(sequence([video('a', 0, 90)], tracks), { kind: 'speech', documentId: 'speech' });
    expect(types(free)).toEqual(['putDocument', 'insertItems']);
    expect(free.operations[1]).toMatchObject({ items: [{ trackId: 's1', scopeItemIds: ['a'] }] });
  });

  it('转写已有字幕层：不覆盖，新的一层停用着放上去，existing 指出已有的那层', async () => {
    const seq = sequence([video('a', 0, 90), caption('o1', 's1', 'orig')], tracks);
    const again = await plan(seq, { kind: 'speech', documentId: 'speech' });
    expect(again).toMatchObject({ enabled: false, existing: { documentId: 'orig', itemIds: ['o1'] } });
    expect(again.operations.at(-1)).toMatchObject({ items: [{ enabled: false }] });
  });

  it('译文：按句级对齐切条，新建这门语言的字幕轨；只看译文时拿下配对的原文', async () => {
    const seq = sequence([video('a', 0, 90), caption('o1', 's1', 'orig')], tracks);
    const created = await plan(seq, translation(false));
    expect(types(created)).toEqual(['addTrack', 'putDocument', 'updateItem', 'insertItems']);
    expect(created).toMatchObject({ cueCount: 2, enabled: true, existing: null, paired: { documentId: 'orig', itemIds: ['o1'] } });
    expect(created.operations[0]).toMatchObject({ kind: 'subtitle', name: 'English' });
    expect(created.operations[1]).toMatchObject({
      kind: 'caption',
      language: 'en',
      sourceDocument: { documentId: 'trans' },
      extensions: { [TRANSLATION_CAPTION_EXTENSION]: { translationDocumentId: 'trans', speechDocumentId: 'speech', speechRevision: '1' } },
    });
    const cues = (created.operations[1] as { body: { cues: Array<{ id: string; text: string; start: number; end: number }> } }).body.cues;
    expect(cues.map((c) => [c.id, c.text, c.start, c.end])).toEqual([
      ['q-t-s-w1', 'It is fine today.', 0, 1000],
      ['q-t-s-w3', "Let's begin.", 2000, 3000],
    ]);
    expect(created.operations[2]).toMatchObject({ type: 'updateItem', itemId: 'o1', enabled: false });
  });

  it('双语：译文与原文共用一份新建的样式，原文留在画面上', async () => {
    const seq = sequence([video('a', 0, 90), caption('o1', 's1', 'orig')], tracks);
    const created = await plan(seq, translation(true));
    expect(types(created)).toEqual(['addTrack', 'putDocument', 'putDocument', 'setCaptionStyle', 'insertItems']);
    // 新建的样式是默认预设（规范 §5.6）：经典涂装（黑色描边、投影），普通逗号句号换成空格。
    expect(created.operations[2]).toMatchObject({ kind: 'caption-style', body: DEFAULT_CAPTION_STYLE_BODY });
    expect(DEFAULT_CAPTION_STYLE_BODY.style).toMatchObject({
      fontColor: '#FFFFFF',
      textOutline: { on: true, color: '#000000', width: 14 },
      background: false,
      punct: true,
    });
    expect(created.operations.at(-1)).toMatchObject({ items: [{ styleDocumentRef: 'caption-style' }] });
    expect(created.operations.some((op) => op.type === 'updateItem')).toBe(false);
  });

  it('双语而没有原文字幕层：pairOriginal 时同一笔事务里先给转写建原文的一层，两层共用新建的样式；不给时只建译文', async () => {
    const seq = sequence([video('a', 0, 90)], tracks);
    const both = await planCaptionLayer(reader(), {
      videoId: 'v',
      sequence: seq,
      documents,
      source: translation(true),
      pairOriginal: true,
    });
    if ('reason' in both) throw new Error(both.reason);
    expect(types(both)).toEqual(['putDocument', 'putDocument', 'insertItems', 'addTrack', 'putDocument', 'insertItems']);
    expect(both).toMatchObject({
      cueCount: 2,
      enabled: true,
      existing: null,
      paired: null,
      original: { documentRef: 'original-caption', cueCount: 2 },
    });
    expect(both.operations[0]).toMatchObject({ kind: 'caption-style', ref: 'caption-style', body: DEFAULT_CAPTION_STYLE_BODY });
    expect(both.operations[1]).toMatchObject({ kind: 'caption', ref: 'original-caption', sourceDocument: { documentId: 'speech' } });
    expect(both.operations[2]).toMatchObject({
      items: [{ documentRef: 'original-caption', trackId: 's1', styleDocumentRef: 'caption-style' }],
    });
    expect(both.operations[3]).toMatchObject({ type: 'addTrack', ref: 'caption-track', name: 'English' });
    expect(both.operations[4]).toMatchObject({ kind: 'caption', ref: 'caption', sourceDocument: { documentId: 'trans' } });
    expect(both.operations[5]).toMatchObject({
      items: [{ documentRef: 'caption', trackRef: 'caption-track', styleDocumentRef: 'caption-style' }],
    });
    expect(both.operations.some((op) => op.type === 'updateItem' || op.type === 'setCaptionStyle')).toBe(false);

    // 没有空着的字幕轨：原文的轨道新建，排在样式前面。
    const noTrack = await planCaptionLayer(reader(), {
      videoId: 'v',
      sequence: sequence([video('a', 0, 90)]),
      documents,
      source: translation(true),
      pairOriginal: true,
    });
    if ('reason' in noTrack) throw new Error(noTrack.reason);
    expect(types(noTrack)).toEqual(['addTrack', 'putDocument', 'putDocument', 'insertItems', 'addTrack', 'putDocument', 'insertItems']);
    expect(noTrack.operations[0]).toMatchObject({ ref: 'original-caption-track' });
    expect(noTrack.operations[3]).toMatchObject({ items: [{ trackRef: 'original-caption-track' }] });

    // 不给 pairOriginal（固定流程）：只建译文的一层，paired 为 null。
    const only = await plan(seq, translation(true));
    expect(types(only)).toEqual(['addTrack', 'putDocument', 'insertItems']);
    expect(only).toMatchObject({ paired: null });
    expect(only).not.toHaveProperty('original');

    // 同一份译文已有一层显示着：新的一层停用着放上去，也不顺带建原文。
    const shown = sequence([video('a', 0, 90), caption('t1', 's2', 'tcap')], [...tracks, track('s2', 2, 'subtitle')]);
    const dup = await planCaptionLayer(reader(), {
      videoId: 'v',
      sequence: shown,
      documents,
      source: translation(true),
      pairOriginal: true,
    });
    if ('reason' in dup) throw new Error(dup.reason);
    expect(types(dup)).toEqual(['addTrack', 'putDocument', 'insertItems']);
    expect(dup).toMatchObject({ enabled: false, paired: null });
    expect(dup).not.toHaveProperty('original');
  });

  it('同一份译文已有一层显示着：新的一层停用着放上去，不动配对的原文', async () => {
    const seq = sequence(
      [video('a', 0, 90), caption('o1', 's1', 'orig', { enabled: false }), caption('t1', 's2', 'tcap')],
      [...tracks, track('s2', 2, 'subtitle')],
    );
    const again = await plan(seq, translation(true));
    expect(again).toMatchObject({ enabled: false, existing: { documentId: 'tcap', itemIds: ['t1'] } });
    expect(types(again)).toEqual(['addTrack', 'putDocument', 'insertItems']);
    expect(again.operations.at(-1)).toMatchObject({ items: [{ enabled: false }] });
  });

  it('有没对齐的单元时拒绝（TRANSLATION_UNALIGNED）；素材不在时间线上、没有可显示的字幕条时不建', async () => {
    const seq = sequence([video('a', 0, 90)], tracks);
    const unaligned = translationBody([aligned('t-s-w1', ['w1', 'w2'], 'Fine.'), { ...aligned('t-s-w3', [], 'Go.'), alignment: null }]);
    const error = await planCaptionLayer(reader({ trans: unaligned }), {
      videoId: 'v',
      sequence: seq,
      documents,
      source: translation(false),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineStepError);
    expect(error).toMatchObject({ code: 'TRANSLATION_UNALIGNED', details: { documentId: 'trans', unitIds: ['t-s-w3'] } });

    const offline = await planCaptionLayer(reader(), {
      videoId: 'v',
      sequence: sequence([], tracks),
      documents,
      source: translation(false),
    });
    expect(offline).toEqual({ reason: 'not-on-timeline' });

    const stale = translationBody([{ ...aligned('t-s-w1', ['w1'], 'Fine.'), status: 'stale', alignment: null }]);
    const empty = await planCaptionLayer(reader({ trans: stale }), { videoId: 'v', sequence: seq, documents, source: translation(false) });
    expect(empty).toEqual({ reason: 'empty' });
  });

  it('原文与样式同笔提交；译文共用已有样式时不覆盖', async () => {
    const style = { ...DEFAULT_CAPTION_STYLE_BODY, style: { ...(DEFAULT_CAPTION_STYLE_BODY.style as Record<string, unknown>), punct: false, y: 74, width: 65 } };
    const seq = sequence([video('a', 0, 90)], tracks);
    const made = await planCaptionLayer(reader(), { videoId: 'v', sequence: seq, documents, source: { kind: 'speech', documentId: 'speech' }, captionStyle: style });
    expect(made).not.toHaveProperty('reason');
    if ('reason' in made) return;
    expect(made.operations[0]).toMatchObject({ kind: 'caption-style', body: style });
    expect(made.operations.at(-1)).toMatchObject({ items: [{ styleDocumentRef: 'caption-preferences-style' }] });
    const paired = sequence([video('a', 0, 90), caption('o1', 's1', 'orig', { styleDocumentId: 'saved-style' })], tracks);
    const translated = await planCaptionLayer(reader(), { videoId: 'v', sequence: paired, documents, source: translation(true), captionStyle: style });
    if ('reason' in translated) throw new Error(translated.reason);
    expect(translated.operations.some((op) => op.type === 'putDocument' && op.kind === 'caption-style')).toBe(false);
    expect(translated.operations.at(-1)).toMatchObject({ items: [{ styleDocumentId: 'saved-style' }] });
  });
});
