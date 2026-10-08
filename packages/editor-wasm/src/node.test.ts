import { describe, expect, it } from 'vitest';
import {
  EditorWasmError,
  SENTENCE_DERIVATION,
  applySpeakers,
  editorWasmAvailable,
  sourceChapters,
  speakerProposal,
  speechSentences,
} from './node.ts';

const built = editorWasmAvailable();
if (!built) console.warn('编辑语义的 WASM 还没有构建（npm run build:wasm），跳过');

const speech = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  words: [
    { id: 'w0', start: 0, end: 400, text: 'Hello', speaker: 'a' },
    { id: 'w1', start: 500, end: 900, text: ' there;', speaker: 'a' },
    { id: 'w2', start: 1000, end: 1300, text: ' friend.', speaker: 'a' },
    { id: 'w3', start: 1400, end: 1600, text: ' Hidden', speaker: 'a', hidden: true },
    { id: 'w4', start: 3500, end: 3700, text: ' Next', speaker: 'a' },
  ],
};

describe.skipIf(!built)('editor-wasm（Node）', () => {
  it('分句与指纹出自字幕与翻译核心', () => {
    const result = speechSentences(speech);
    expect(result.derivation).toBe(SENTENCE_DERIVATION);
    expect(result.timescale).toBe(1000);
    expect(result.editViewHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.sentences.map((s) => s.id)).toEqual(['s-w0', 's-w4']);
    expect(result.sentences[0]).toMatchObject({
      wordIds: ['w0', 'w1', 'w2'],
      text: 'Hello there; friend.',
      speaker: 'a',
      start: 0,
      end: 1300,
    });
    expect(result.sentences[0]!.fingerprint).toMatch(/^3:w0:w2:[0-9a-z]+$/);
    // 隐藏的词不进句子，也不算停顿的起点之外的词。
    expect(result.sentences[1]!.wordIds).toEqual(['w4']);
  });

  it('同一份正文得出同一个结果；改一个字指纹就变', () => {
    const again = speechSentences(structuredClone(speech));
    expect(again).toEqual(speechSentences(speech));
    const edited = structuredClone(speech);
    edited.words[2]!.text = ' friends.';
    const changed = speechSentences(edited);
    expect(changed.sentences[0]!.fingerprint).not.toBe(again.sentences[0]!.fingerprint);
    expect(changed.sentences[1]!.fingerprint).toBe(again.sentences[1]!.fingerprint);
    expect(changed.editViewHash).not.toBe(again.editViewHash);
    // 全文指纹算全部的词（含隐藏的），改一个字就变。
    expect(again.contentFingerprint).toMatch(/^5:w0:w4:[0-9a-z]+$/);
    expect(changed.contentFingerprint).not.toBe(again.contentFingerprint);
  });

  it('读不了的正文抛 INVALID_SPEECH', () => {
    expect(() => speechSentences({ schema: 'baocut.speech/1', words: [{ id: 'w0', text: 'x' }] })).toThrow(EditorWasmError);
    try {
      speechSentences({ schema: 'baocut.caption/1', words: [] });
    } catch (error) {
      expect((error as EditorWasmError).code).toBe('INVALID_SPEECH');
    }
  });
});

describe.skipIf(!built)('editor-wasm：识别说话人（Node）', () => {
  const words = ['Hello', ' there,', ' how', ' are', ' you?'].map((text, i) => ({
    id: `w${i}`,
    start: i * 500,
    end: i * 500 + 400,
    text,
    speaker: 'a',
  }));
  const body = { schema: 'baocut.speech/1', timescale: 1000, speakers: [{ id: 'a', name: '说话人 1' }], words };

  it('提案复用重叠最多的已有说话人，新聚类新建说话人；应用按提案改词', () => {
    const proposal = speakerProposal(body, [], ['A', 'A', 'A', 'B', 'B']);
    expect(proposal.speakers.map((s) => [s.id, s.name, s.isNew, s.sentences])).toEqual([
      ['a', '说话人 1', false, 1],
      ['spk-2', '说话人 2', true, 1],
    ]);
    expect(proposal.wordSpeakers).toEqual({ w3: 'spk-2', w4: 'spk-2' });
    const applied = applySpeakers(body, [], proposal.wordSpeakers, [{ id: 'spk-2', name: '嘉宾' }]);
    expect((applied.speech.words as Array<{ speaker: string }>).map((w) => w.speaker)).toEqual(['a', 'a', 'a', 'spk-2', 'spk-2']);
    expect(applied.speech.speakers).toEqual([
      { id: 'a', name: '说话人 1' },
      { id: 'spk-2', name: '嘉宾' },
    ]);
    expect(applied.translations).toEqual([]);
  });

  it('labels 与词数不符抛 INVALID_PROPOSAL', () => {
    expect(() => speakerProposal(body, [], ['A'])).toThrow(expect.objectContaining({ code: 'INVALID_PROPOSAL' }));
  });
});

describe.skipIf(!built)('editor-wasm：来源自带章节（Node）', () => {
  const body = {
    schema: 'baocut.speech/1',
    timescale: 1000,
    speakers: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    words: [
      { id: 'w0', start: 0, end: 400, text: 'Hello.', speaker: 'a' },
      { id: 'w1', start: 60_000, end: 60_400, text: 'Next.', speaker: 'b' },
    ],
    sentences: null,
  };

  it('简介里的时间戳大纲吸到段落起点；不吸附时保留原时间', () => {
    const source = { description: 'Chapters:\n0:00 Intro\n0:59 Next part' };
    const snapped = sourceChapters({ speech: body, source, durationSeconds: 90 });
    expect(snapped.rows).toEqual([
      { title: 'Intro', start: 0, end: 60, status: 'matched' },
      { title: 'Next part', start: 60, end: 90, status: 'matched' },
    ]);
    expect(snapped.entries[1]!.anchor).toMatchObject({ tier: 'paragraph', id: 'p-w1', time: 60 });
    const parsed = sourceChapters({ source, durationSeconds: 90, snap: false });
    expect(parsed.entries.map((e) => [e.status, e.at])).toEqual([
      ['unanchored', 0],
      ['unanchored', 59],
    ]);
  });

  it('没有来源章节时返回空的结果', () => {
    expect(sourceChapters({ source: { title: 'x' }, durationSeconds: 10 }).sourceChapters).toEqual([]);
  });
});
