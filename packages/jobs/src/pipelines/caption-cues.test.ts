import { describe, expect, it } from 'vitest';
import { CUE_PARAMS, captionBody, deriveCues, readSpeechWords, splitUntimed } from './caption-cues.ts';

type W = [id: string, start: number, end: number, text: string, flags?: { hidden?: boolean; timingQuality?: string; glue?: true }];

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
  it('glue 保留到字幕文字与量宽，不在无空格词缝处提前断条', () => {
    const read = readSpeechWords(speechBody([
      ['w1', 0, 0.5, 'inter'], ['w2', 0.5, 1, 'national', { glue: true }],
    ]))!;
    const cues = deriveCues(read.words, { ...CUE_PARAMS, maxChars: 13 });
    expect(cues.map((cue) => cue.text)).toEqual(['international']);
    expect(cues[0]!.wordIds).toEqual(['w1', 'w2']);
  });

  it('转写把西文词切成几段（后一段贴前）：停顿、溢出都不在词内断，整词跟着上一条', () => {
    const tokens = [...'我们今天来讲一讲这个很有名的模型就是它', 'Tra', 'nsformer', ...'的注意力'];
    const list = (pause: number): W[] =>
      tokens.map((text, i) => {
        const at = i * 0.2 + (i >= 20 ? pause : 0);
        return [`w${i}`, at, at + 0.2, text, i === 20 ? { glue: true } : undefined];
      });
    for (const pause of [0, 0.7]) {
      const texts = deriveCues(readSpeechWords(speechBody(list(pause)))!.words).map((cue) => cue.text);
      expect(texts.some((text) => text.includes('Transformer')), texts.join('|')).toBe(true);
    }
  });

  it('没有词时间的长段按宽度切时，一串西文整串挪进下一段', () => {
    const pieces = splitUntimed('我们今天要讲的是Transformer模型为什么能够理解上下文', 0, 5, 20).map((p) => p.text);
    expect(pieces.join('')).toBe('我们今天要讲的是Transformer模型为什么能够理解上下文');
    expect(pieces.some((piece) => piece.includes('Transformer'))).toBe(true);
  });

  it('中文转写一个字一个词时，溢出落在词里就延长到词尾（「修程｜序崩溃」「代｜码审查」）；没有词时间的段按宽度切也不拆词', () => {
    const list = (text: string): W[] => [...text].map((char, i) => [`w${i}`, i * 0.2, i * 0.2 + 0.2, char]);
    const texts = (text: string) => deriveCues(readSpeechWords(speechBody(list(text)))!.words).map((cue) => cue.text);
    expect(texts('我们今天来讲一讲这个很有名的模型就是它修程序崩溃的问题')).toEqual([
      '我们今天来讲一讲这个很有名的模型就是它修程序',
      '崩溃的问题',
    ]);
    expect(texts('我们今天来讲一讲这个很有名的模型就是它的代码审查流程')).toEqual(['我们今天来讲一讲这个很有名的模型就是它的代码', '审查流程']);
    // 词比余量还长时照样按宽度断。
    const tight = deriveCues(readSpeechWords(speechBody(list('我们今天来讲一讲这个很有名的模型就是它修程序崩溃的问题')))!.words, {
      ...CUE_PARAMS,
      overflowSlack: 0,
    });
    expect(tight[0]!.text).toBe('我们今天来讲一讲这个很有名的模型就是它修程');
    for (const maxChars of [14, 16, 18, 20]) {
      const pieces = splitUntimed('我们让它帮忙修程序崩溃然后再做代码审查', 0, 5, maxChars).map((p) => p.text);
      expect(pieces.join('')).toBe('我们让它帮忙修程序崩溃然后再做代码审查');
      for (const [a, b] of pieces.slice(1).map((piece, n) => [pieces[n]!, piece] as const))
        for (const word of ['程序', '崩溃', '代码', '审查']) expect(a.endsWith(word[0]!) && b.startsWith(word[1]!), pieces.join('|')).toBe(false);
    }
  });

  it('零时长词并进相邻词时仍保留 glue 指定的词缝', () => {
    const read = readSpeechWords(speechBody([
      ['w1', 0, 0, 'i'], ['w2', 0, 0.5, 'nter', { glue: true }],
      ['w3', 0.5, 0.5, 'na', { glue: true }], ['w4', 0.5, 1, 'tional', { glue: true }],
    ]))!;
    expect(deriveCues(read.words).map((cue) => cue.text)).toEqual(['international']);
  });

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
