import { describe, expect, it } from 'vitest';
import { captionBody, deriveCues, readSpeechWords } from './caption-cues.ts';

type W = [id: string, start: number, end: number, text: string, flags?: { hidden?: boolean; timingQuality?: string }];

/** 转写正文：秒写成微秒刻度（本地转写流程写的刻度）。 */
function speechBody(list: W[]) {
  return {
    schema: 'baocut.speech/1',
    clock: 'source-asset',
    timescale: 1_000_000,
    speakers: [{ id: 'spk-1', name: '说话人 1' }],
    words: list.map(([id, start, end, text, flags]) => ({
      id,
      start: Math.round(start * 1_000_000),
      end: Math.round(end * 1_000_000),
      text,
      speaker: 'spk-1',
      ...(flags ?? {}),
    })),
    sentences: null,
  };
}

describe('读转写（与编辑器的 speech-cues.ts 同一条规则）', () => {
  it('零时长的词不丢：后面有空隙就占一小段（至多 0.08 秒），整句进同一条字幕', () => {
    // 真实样本：对齐器把「ask—you」的起止解到同一格，后面有 0.24 秒的空隙。
    const read = readSpeechWords(
      speechBody([
        ['w1', 14.716, 14.956, 'just'],
        ['w2', 14.956, 14.956, 'ask—you'],
        ['w3', 15.196, 15.436, 'know,'],
      ]),
    )!;
    expect(read.words.map((w) => [w.id, w.text])).toEqual([
      ['w1', 'just'],
      ['w2', 'ask—you'],
      ['w3', 'know,'],
    ]);
    expect(read.words[1]!.start).toBeCloseTo(14.956);
    expect(read.words[1]!.end).toBeCloseTo(15.036);
    const cues = deriveCues(read.words);
    expect(cues.map((cue) => [cue.text, cue.wordIds])).toEqual([['just ask—you know,', ['w1', 'w2', 'w3']]]);
    const body = captionBody(cues, read.speakers);
    expect(body.cues).toEqual([{ id: 'q-w1', start: 14716, end: 15436, text: 'just ask—you know,', words: { first: 'w1', last: 'w3' } }]);
  });

  it('没有空隙的零时长词把文字并进相邻的词（前面有词接前面，没有就接后面）；隐藏的词不进字幕，但它的时间照样算空隙的边界', () => {
    const read = readSpeechWords(
      speechBody([
        ['w1', 1, 1, 'to'],
        ['w2', 1, 1.3, 'be'],
        ['w3', 1.3, 1.3, 'frank,'],
        ['w4', 1.3, 1.5, 'um', { hidden: true }],
        ['w5', 1.5, 1.8, 'yes.'],
        ['w6', 1.8, 1.8, 'Bye.'],
      ]),
    )!;
    expect(read.words.map((w) => [w.id, w.text, w.start, w.end])).toEqual([
      ['w2', 'to be frank,', 1, 1.3],
      ['w5', 'yes.', 1.5, 1.8],
      ['w6', 'Bye.', 1.8, 1.88],
    ]);
    expect(deriveCues(read.words).map((cue) => cue.text)).toEqual(['to be frank,', 'yes.', 'Bye.']);
  });

  it('隐藏的、空白的词不进字幕；不是转写正文返回 null', () => {
    const read = readSpeechWords(
      speechBody([
        ['w1', 0, 0.5, 'Hello'],
        ['w2', 0.5, 0.7, ' ', {}],
        ['w3', 0.7, 1, 'world.', { hidden: true }],
      ]),
    )!;
    expect(read.words.map((w) => w.id)).toEqual(['w1']);
    expect(readSpeechWords({ schema: 'baocut.caption/1', cues: [] })).toBeNull();
  });
});
