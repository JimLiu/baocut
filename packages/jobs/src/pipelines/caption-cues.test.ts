import { describe, expect, it } from 'vitest';
import { CUE_PARAMS, captionBody, deriveCues, readSpeechWords, rewordSpeechCaption, splitUntimed } from './caption-cues.ts';

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

describe('切条：成对符号里不切，太短的条并进同一句（与编辑器的 speech-cues.ts 同一条规则）', () => {
  const even = (tokens: string[], step: number): W[] => tokens.map((text, i) => [`w${i}`, i * step, (i + 1) * step, text]);
  /** 整个词表是一句。 */
  const oneSentence = (list: W[]) => ({ ...speechBody(list), sentences: [{ id: 's1', first: list[0]![0], last: list.at(-1)![0] }] });
  const cut = (body: unknown) => deriveCues(readSpeechWords(body)!.words);
  const texts = (body: unknown) => cut(body).map((cue) => cue.text);

  it('再收一个词就超行宽时，书名号、引号从开符号起整段挪进下一条（中文《》、日文「」、英文直引号）；没存句子时一样', () => {
    const zh = even([...'伍尔夫在日记里很不客气地写道狄更斯的《大卫·科波菲尔》不过是业余作者的粗劣之作。'], 0.2);
    expect(texts(oneSentence(zh))).toEqual(['伍尔夫在日记里很不客气地写道狄更斯的', '《大卫·科波菲尔》不过是业余作者的粗劣之作。']);
    expect(texts(speechBody(zh))).toEqual(texts(oneSentence(zh)));
    const ja = even([...'トルストイは日記の中で「絞首台は恐ろしい道具だ」と書いている。'], 0.2);
    expect(texts(oneSentence(ja))).toEqual(['トルストイは日記の中で', '「絞首台は恐ろしい道具だ」と書いている。']);
    // 末尾的「an amateur.」只有 0.7 秒，并回上一条超宽，改成从上一条挪一个词过来。
    const en = even('Woolf wrote in her diary that "David Copperfield" was merely the clumsy work of an amateur.'.split(' '), 0.35);
    expect(texts(oneSentence(en))).toEqual(['Woolf wrote in her diary that', '"David Copperfield" was merely the clumsy', 'work of an amateur.']);
  });

  it('太短的条并不进去时从同一句相邻的一条挪词，两条都不短于 1 秒；并回去超过 7 秒时同样挪词；句子的时间范围不变', () => {
    const zh = even([...'我们今天来讲一讲这个很有名的模型就是它修程序崩溃的问题。'], 0.15);
    expect(cut(oneSentence(zh)).map((cue) => cue.text)).toEqual(['我们今天来讲一讲这个很有名的', '模型就是它修程序崩溃的问题。']);
    const en = even('one two three four five six seven eight.'.split(' '), 0.9);
    expect(cut(oneSentence(en)).map((cue) => [cue.text, cue.start, cue.end])).toEqual([
      ['one two three four', 0, 3.6],
      ['five six seven eight.', 3.6, 7.2],
    ]);
  });

  it('不跨句、不跨说话人并；没存句子的转写不并', () => {
    const list: W[] = [...even('It is a fine day for a walk in the park today.'.split(' '), 0.3), ['y', 3.6, 4, 'Yes.']];
    const body = { ...speechBody(list), sentences: [{ id: 's1', first: 'w0', last: 'w11' }, { id: 's2', first: 'y', last: 'y' }] };
    expect(cut(body).map((cue) => [cue.text, cue.start, cue.end])).toEqual([
      ['It is a fine day for a walk in the park today.', 0, 3.6],
      ['Yes.', 3.6, 4],
    ]);
    const en = even('one two three four five six seven eight.'.split(' '), 0.9);
    expect(texts(speechBody(en))).toEqual(['one two three four five six seven', 'eight.']);
    const swapped = oneSentence(en);
    swapped.words[7]!.speaker = 'spk-2';
    expect(texts(swapped)).toEqual(['one two three four five six seven', 'eight.']);
  });
});

describe('转写改了字，原文字幕跟着改（rewordSpeechCaption）', () => {
  /** 按转写建一层原文字幕（与 captions_create 同一条路）。 */
  const layer = (body: ReturnType<typeof speechBody>) => {
    const read = readSpeechWords(body)!;
    return captionBody(deriveCues(read.words), read.speakers);
  };
  /** 照 updateWords 改词文本。 */
  const update = (body: ReturnType<typeof speechBody>, texts: Record<string, string>) => ({
    ...body,
    words: body.words.map((word) => (word.id in texts ? { ...word, text: texts[word.id]! } : word)),
  });
  const rows = (body: Record<string, unknown>) =>
    (body.cues as Array<{ id: string; text: string; start: number; end: number }>).map((c) => [c.id, c.text, c.start, c.end]);

  const english = speechBody([
    ['w1', 0, 0.5, 'inter'],
    ['w2', 0.5, 1, 'national', { glue: true }],
    ['w3', 1, 1.5, 'news.'],
    ['w4', 3, 3.5, 'Good'],
    ['w5', 3.5, 4, 'night.'],
  ]);

  it('用到改过的词的句子按切条的拼法重拼（认贴前），时间、ID 与别的句子不动', () => {
    const caption = layer(english);
    expect(rows(caption)).toEqual([
      ['q-w1', 'international news.', 0, 1500],
      ['q-w4', 'Good night.', 3000, 4000],
    ]);
    const result = rewordSpeechCaption(caption, english, update(english, { w2: 'nationale', w3: 'news!' }))!;
    expect(result.changed).toBe(1);
    expect(result.kept).toEqual([]);
    expect(rows(result.body)).toEqual([
      ['q-w1', 'internationale news!', 0, 1500],
      ['q-w4', 'Good night.', 3000, 4000],
    ]);
    const cues = result.body.cues as unknown[];
    expect(cues[1]).toBe((caption.cues as unknown[])[1]);
    // 词文本没变：原样返回。
    const same = rewordSpeechCaption(caption, english, english)!;
    expect(same).toEqual({ body: caption, changed: 0, kept: [] });
  });

  it('文字被手改过的句子不覆盖；用到了改过的词的报在 kept，没用到的不报', () => {
    const caption = layer(english);
    const cues = caption.cues as Array<{ text: string }>;
    cues[0]!.text = 'International News';
    cues[1]!.text = 'Good night!';
    const result = rewordSpeechCaption(caption, english, update(english, { w1: 'Inter' }))!;
    expect(result.changed).toBe(0);
    expect(result.kept).toEqual(['q-w1']);
    expect(result.body).toBe(caption);
  });

  it('字幕生成在隐藏之前：连隐藏的词一起拼对得上，照样改（隐藏的词画的时候再拿掉）', () => {
    const caption = layer(english);
    const hidden = { ...english, words: english.words.map((word) => (word.id === 'w2' ? { ...word, hidden: true } : word)) };
    const result = rewordSpeechCaption(caption, hidden, update(hidden, { w3: 'today.' }))!;
    expect(result.changed).toBe(1);
    expect(rows(result.body)[0]).toEqual(['q-w1', 'international today.', 0, 1500]);
  });

  it('中文按字拼、不加空格；句子用 wordIds 指词时同样认', () => {
    const chinese = speechBody([
      ['c1', 0, 0.4, '我们'],
      ['c2', 0.4, 0.6, '修'],
      ['c3', 0.6, 1, '程序。'],
    ]);
    const caption = {
      schema: 'baocut.caption/1',
      clock: 'source-asset',
      timescale: 1000,
      cues: [{ id: 'k1', start: 0, end: 1000, text: '我们修程序。', words: { wordIds: ['c1', 'c2', 'c3'] } }],
    };
    const result = rewordSpeechCaption(caption, chinese, update(chinese, { c3: '程式。' }))!;
    expect(rows(result.body)).toEqual([['k1', '我们修程式。', 0, 1000]]);
  });

  it('改过的词拆块的方式变了（中间多了空白，成了没有词时间的几块）时对不上切法，不换，报出来', () => {
    const caption = layer(english);
    const result = rewordSpeechCaption(caption, english, update(english, { w5: 'good night.' }))!;
    expect(result.changed).toBe(0);
    expect(result.kept).toEqual(['q-w4']);
  });

  it('没写 words 的句子不动；有一份不是转写时 null', () => {
    const caption = { schema: 'baocut.caption/1', timescale: 1000, cues: [{ id: 'x', start: 0, end: 1500, text: 'international news.' }] };
    expect(rewordSpeechCaption(caption, english, update(english, { w3: 'today.' }))).toEqual({ body: caption, changed: 0, kept: [] });
    expect(rewordSpeechCaption(caption, english, { schema: 'baocut.caption/1' })).toBeNull();
  });
});
