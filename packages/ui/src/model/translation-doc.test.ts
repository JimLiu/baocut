import { editorWasmAvailable } from '@baocut/editor-wasm';
import { describe, expect, it } from 'vitest';
import {
  editUnit,
  pairRows,
  pairStats,
  readTranslation,
  sha256Hex,
  speechSentences,
  unitState,
  type SourceSentence,
  type TranslationBody,
  type TranslationUnit,
} from './translation-doc.ts';
import workerSample from './fixtures/worker-translation.json';

/**
 * 转写：句末标点断句、分号不断；停顿 1.5 秒不断、1.9 秒断；换说话人断；隐藏的词不进文本与指纹。
 */
const speech = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  words: [
    { id: 'w1', start: 0, end: 400, text: 'Hello', speaker: 'A' },
    { id: 'w2', start: 400, end: 800, text: 'world;', speaker: 'A' },
    { id: 'w3', start: 800, end: 1100, text: 'again.', speaker: 'A' },
    { id: 'w4', start: 1200, end: 1500, text: 'This', speaker: 'A' },
    { id: 'w5', start: 1500, end: 1700, text: 'um', speaker: 'A', hidden: true },
    { id: 'w6', start: 1700, end: 2000, text: 'works', speaker: 'A' },
    { id: 'w7', start: 3500, end: 3800, text: 'fine', speaker: 'A' },
    { id: 'w8', start: 5700, end: 6000, text: 'later', speaker: 'A' },
    { id: 'w9', start: 6000, end: 6400, text: '你好', speaker: 'B' },
    { id: 'w10', start: 6400, end: 6800, text: '世界', speaker: 'B' },
  ],
};

describe.skipIf(!editorWasmAvailable())('原文的句子与指纹（字幕与翻译核心的规则，经 editor-wasm）', () => {
  // 指纹是核心对同样的正文算出来的；规则一变这里就红。
  it('按停顿 ≥ 1.8 秒、换说话人、句末标点断句，分号不断', () => {
    const expected = [
      { id: 's-w1', wordIds: ['w1', 'w2', 'w3'], text: 'Hello world; again.', fingerprint: '3:w1:w3:2lr52qv73aau9' },
      { id: 's-w4', wordIds: ['w4', 'w6', 'w7'], text: 'This works fine', fingerprint: '3:w4:w7:3dwdwn9n9zq56' },
      { id: 's-w8', wordIds: ['w8'], text: 'later', fingerprint: '1:w8:w8:ucpsrxvtapoi' },
      { id: 's-w9', wordIds: ['w9', 'w10'], text: '你好世界', fingerprint: '2:w9:w10:2qbxjbuvi5uj7' },
    ];
    expect(speechSentences(speech)).toEqual(expected);
  });

  it('正文里存下的句子不参与', () => {
    const stored = { ...speech, sentences: [{ id: 'S1', first: 'w1', last: 'w10' }] };
    expect(speechSentences(stored)!.map((s) => s.id)).toEqual(['s-w1', 's-w4', 's-w8', 's-w9']);
  });

  it('改了字指纹就变，隐藏的词改了不变', () => {
    const edit = (id: string, patch: object) => ({ ...speech, words: speech.words.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
    const fingerprint = (body: unknown) => speechSentences(body)!.find((s) => s.id === 's-w4')!.fingerprint;
    expect(fingerprint(edit('w6', { text: 'worked' }))).not.toBe('3:w4:w7:3dwdwn9n9zq56');
    expect(fingerprint(edit('w5', { text: 'uh' }))).toBe('3:w4:w7:3dwdwn9n9zq56');
  });

  it('不是转写、或转写不合格式（词没有源时间）时 null', () => {
    expect(speechSentences({ schema: 'baocut.caption/1', cues: [] })).toBeNull();
    expect(speechSentences(null)).toBeNull();
    expect(speechSentences({ schema: 'baocut.speech/1', words: [{ id: 'x', text: 'a' }] })).toBeNull();
  });

  it('译文的 textHash 是 SHA-256', async () => {
    expect(await sha256Hex('Bonjour le monde.')).toBe('4178c4d4c2fd95163ebbe7eca64d886ca5e6f69a9c1f51d0760ac80207a343e6');
  });
});

const sentence = (id: string, text: string, fingerprint = `fp-${id}`, wordIds = [id]): SourceSentence => ({
  id,
  wordIds,
  text,
  fingerprint,
});

function unit(sentenceId: string, text: string, extra: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: `t-${sentenceId}`,
    sourceSentenceId: sentenceId,
    sourceFingerprint: `fp-${sentenceId}`,
    naturalText: text,
    alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: [sentenceId], textHash: 'sha256:old' },
    status: 'draft',
    ...extra,
  };
}

function translation(units: TranslationUnit[]): TranslationBody {
  return {
    schema: 'baocut.translation/2',
    language: 'en',
    sourceBasis: { speechRef: { id: 'speech', revision: '1' }, sequenceId: 'seq', scopeLineage: [], editViewHash: 'sha256:x' },
    units,
  };
}

describe('原文与译文逐句配对', () => {
  it('按转写的句子次序；原句没了的排在前一个单元后面；新出现的句子列为未翻译', () => {
    const sentences = [sentence('s1', '一'), sentence('s3', '三'), sentence('s4', '四', 'fp-new')];
    const body = translation([
      unit('s0', 'zero'),
      unit('s1', 'one'),
      unit('s2', 'two'),
      unit('s4', 'four'),
      unit('s5', 'five', { status: 'stale' }),
    ]);
    const rows = pairRows(sentences, body);
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ['t-s0', 'sentence-gone'],
      ['t-s1', 'ok'],
      ['t-s2', 'sentence-gone'],
      ['s:s3', 'untranslated'],
      ['t-s4', 'source-changed'],
      ['t-s5', 'marked-stale'],
    ]);
    expect(pairStats(rows)).toEqual({ sentences: 3, untranslated: 1, stale: 2, gone: 2 });
  });

  it('状态的先后与 dub.ts 相同：标了过期 > 原句没了 > 原句改过 > 没有译文', () => {
    expect(unitState(unit('s1', 'x', { status: 'stale' }), null)).toBe('marked-stale');
    expect(unitState(unit('s1', 'x'), null)).toBe('sentence-gone');
    expect(unitState(unit('s1', ''), sentence('s1', '一', 'other'))).toBe('source-changed');
    expect(unitState(unit('s1', '  '), sentence('s1', '一'))).toBe('empty');
    expect(unitState(unit('s1', 'x', { displayRewrite: { text: 'X!', reason: 'width', reviewed: false } }), sentence('s1', '一'))).toBe(
      'ok',
    );
    expect(unitState(null, sentence('s1', '一'))).toBe('untranslated');
  });

  it('只认 /2 的正文', () => {
    expect(readTranslation(translation([unit('s1', 'one')]))?.units).toHaveLength(1);
    expect(readTranslation({ schema: 'baocut.translation/1', units: [] })).toBeNull();
    expect(readTranslation({ ...translation([]), units: [{ id: 'x' }] })).toBeNull();
  });
});

describe('就地改一句译文', () => {
  const sentences = [sentence('s1', '一'), sentence('s2', '二', 'fp-new', ['s2', 's2b']), sentence('s3', '三')];

  it('改 naturalText、重算 textHash、记为 reviewed；文字没变时不写', async () => {
    const body = translation([unit('s1', 'one'), unit('s2', 'two'), unit('s3', 'three')]);
    const rows = pairRows(sentences, body);
    expect(await editUnit(body, sentences, rows[0]!, ' one ')).toBeNull();
    const result = await editUnit(body, sentences, rows[0]!, 'One!');
    expect(result!.unit).toMatchObject({ id: 't-s1', naturalText: 'One!', status: 'reviewed', sourceFingerprint: 'fp-s1' });
    expect(result!.unit.alignment!.textHash).toBe(`sha256:${await sha256Hex('One!')}`);
    expect(result!.body.units.map((u) => u.naturalText)).toEqual(['One!', 'two', 'three']);
    // 别的字段原样。
    expect(result!.body.sourceBasis).toBe(body.sourceBasis);
  });

  it('原句改过的：对着现在的原文改，指纹与词成员换成现在这一句的', async () => {
    const body = translation([unit('s1', 'one'), unit('s2', 'two'), unit('s3', 'three')]);
    const rows = pairRows(sentences, body);
    expect(rows[1]!.state).toBe('source-changed');
    const result = await editUnit(body, sentences, rows[1]!, 'Two, revised');
    expect(result!.unit).toMatchObject({ sourceFingerprint: 'fp-new', status: 'reviewed' });
    expect(result!.unit.alignment!.sourceWordIds).toEqual(['s2', 's2b']);
    expect(unitState(result!.unit, sentences[1]!)).toBe('ok');
  });

  it('有字幕显示改写的改改写，自然译文不动', async () => {
    const body = translation([unit('s1', 'one', { displayRewrite: { text: 'One', reason: 'width', reviewed: false } })]);
    const rows = pairRows([sentences[0]!], body);
    const result = await editUnit(body, [sentences[0]!], rows[0]!, 'Uno');
    expect(result!.unit.naturalText).toBe('one');
    expect(result!.unit.displayRewrite).toEqual({ text: 'Uno', reason: 'width', reviewed: true });
    expect(result!.unit.alignment!.textHash).toBe('sha256:old');
  });

  it('还没有译文的句子新建一个单元，插在前面最近一句的后面；原句没了的不让改', async () => {
    const body = translation([unit('s1', 'one'), unit('s0', 'gone'), unit('s3', 'three')]);
    const rows = pairRows(sentences, body);
    const fresh = rows.find((r) => r.key === 's:s2')!;
    expect(await editUnit(body, sentences, fresh, '  ')).toBeNull();
    const result = await editUnit(body, sentences, fresh, 'two');
    expect(result!.body.units.map((u) => u.id)).toEqual(['t-s1', 't-s2', 't-s0', 't-s3']);
    expect(result!.unit).toMatchObject({ sourceSentenceId: 's2', sourceFingerprint: 'fp-new', status: 'reviewed' });
    expect(result!.unit.alignment).toMatchObject({ basis: 'natural', correspondence: 'sentence', sourceWordIds: ['s2', 's2b'] });
    const gone = rows.find((r) => r.key === 't-s0')!;
    expect(await editUnit(body, sentences, gone, 'nope')).toBeNull();
  });
});

/**
 * 端到端：`fixtures/worker-translation.json` 是同一份转写交给真的 Speech Worker 翻译（模型是假的）写出的译文，连同那份转写。
 * 界面按自己取的句子与指纹逐句核对，每一句都应是正常的——两边用的是同一份核心规则。转写里有分号、1.5 秒与 1.9 秒的停顿、
 * 隐藏的词与换说话人。样例由 packages/jobs 的 speech-worker.test.ts 用真的 Worker 核对（`BAOCUT_WRITE_FIXTURES=1` 时重写）。
 */
describe.skipIf(!editorWasmAvailable())('Speech Worker 写出的译文在界面里核对', () => {
  const translation = readTranslation(workerSample.translation)!;
  const sentences = speechSentences(workerSample.speech)!;

  it('每一句都配上译文，状态正常', () => {
    expect(translation).not.toBeNull();
    expect(sentences.map((s) => s.id)).toEqual(['s-w1', 's-w11', 's-w17', 's-w21', 's-w25', 's-w28']);
    const rows = pairRows(sentences, translation);
    expect(rows.map((r) => [r.key, r.state])).toEqual(translation.units.map((u) => [u.id, 'ok']));
    expect(pairStats(rows)).toEqual({ sentences: 6, untranslated: 0, stale: 0, gone: 0 });
  });

  it('改了一句原文的字：只有那一句过期；就地改过译文后又正常', async () => {
    const speech = {
      ...workerSample.speech,
      words: workerSample.speech.words.map((w) => (w.id === 'w19' ? { ...w, text: ' mix' } : w)),
    };
    const changed = speechSentences(speech)!;
    const rows = pairRows(changed, translation);
    expect(rows.filter((r) => r.state !== 'ok').map((r) => [r.sentence!.id, r.state])).toEqual([['s-w17', 'source-changed']]);
    const result = await editUnit(
      translation,
      changed,
      rows.find((r) => r.state === 'source-changed')!,
      '然后我们混音。',
    );
    expect(pairRows(changed, result!.body).every((r) => r.state === 'ok')).toBe(true);
  });
});
