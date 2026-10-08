import { describe, expect, it } from 'vitest';
import { formatClock } from './format.ts';
import { SeekQueue } from './seek.ts';
import { activeCues, decodeSubtitleText, nearIndex, parseSubtitles, seekTimeOf, subtitleFormatOf } from './subtitles.ts';

describe('字幕解析', () => {
  it('SRT：CRLF、BOM、多行、标签；坏块跳过；按开始时间排序', () => {
    const srt = [
      '﻿1',
      '00:00:05,500 --> 00:00:07,000',
      '<i>第二句</i>',
      '',
      '2',
      '00:00:01,000 --> 00:00:03,250',
      '{\\an8}第一句',
      '第一句的第二行',
      '',
      '3',
      '这不是时间行',
      '跳过',
      '',
      '4',
      '01:02:03,4 --> 01:02:04,45',
      '很后面',
      '',
    ].join('\r\n');
    const cues = parseSubtitles(srt, 'srt');
    expect(cues).toEqual([
      { index: 1, start: 1, end: 3.25, text: '第一句\n第一句的第二行' },
      { index: 2, start: 5.5, end: 7, text: '第二句' },
      { index: 3, start: 3723.4, end: 3724.45, text: '很后面' },
    ]);
  });

  it('WebVTT：文件头、NOTE、STYLE、标识行、设置、实体与说话人标签', () => {
    const vtt = [
      'WEBVTT - 标题',
      '',
      'NOTE 这是注释',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'intro',
      '00:01.000 --> 00:02.500 align:start position:10%',
      '<v 主持人>大家好 &amp; 欢迎</v>',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'Tom &lt;3 <00:00:03.500>Jerry',
      '',
    ].join('\n');
    expect(parseSubtitles(vtt, 'vtt')).toEqual([
      { index: 1, start: 1, end: 2.5, text: '大家好 & 欢迎' },
      { index: 2, start: 3, end: 4, text: 'Tom <3 Jerry' },
    ]);
  });

  it('ASS：按 Format 取列，文字里的逗号保留，去掉覆盖标记，Comment 跳过', () => {
    const ass = [
      '[Script Info]',
      'Title: x',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname',
      'Style: Default,Arial',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.50,0:00:02.00,Default,,0,0,0,,{\\b1}你好，世界, 再见{\\b0}\\N第二行',
      'Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,注释',
      'Dialogue: 0,0:00:00.00,0:00:00.80,Default,,0,0,0,,开头\\h了',
    ].join('\n');
    expect(parseSubtitles(ass, 'ass')).toEqual([
      { index: 1, start: 0, end: 0.8, text: '开头 了' },
      { index: 2, start: 1.5, end: 2, text: '你好，世界, 再见\n第二行' },
    ]);
  });

  it('编码：UTF-8（带不带 BOM）、GBK、UTF-16', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\n你好\n';
    expect(decodeSubtitleText(new TextEncoder().encode(text))).toBe(text);
    expect(decodeSubtitleText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('你好')]))).toBe('你好');
    // 「你好」的 GBK 编码。
    expect(decodeSubtitleText(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('你好');
    expect(decodeSubtitleText(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toBe('你好');
  });

  it('格式按扩展名认；结束不晚于开始、没有文字的句子丢掉', () => {
    expect(subtitleFormatOf('a.SRT')).toBe('srt');
    expect(subtitleFormatOf('a.zh.vtt')).toBe('vtt');
    expect(subtitleFormatOf('a.ssa')).toBe('ass');
    expect(subtitleFormatOf('a.txt')).toBeNull();
    expect(parseSubtitles('1\n00:00:02,000 --> 00:00:01,000\n倒着\n\n2\n00:00:03,000 --> 00:00:04,000\n\n', 'srt')).toEqual([]);
  });

  it('当前句：重叠的都算，结束那一刻不算；点一句定位到句首之后', () => {
    const cues = parseSubtitles(
      ['1', '00:00:00,000 --> 00:00:10,000', '长句', '', '2', '00:00:02,000 --> 00:00:03,000', '短句', ''].join('\n'),
      'srt',
    );
    expect(activeCues(cues, 2.5).map((c) => c.text)).toEqual(['长句', '短句']);
    expect(activeCues(cues, 3).map((c) => c.text)).toEqual(['长句']);
    expect(activeCues(cues, 10)).toEqual([]);
    expect(seekTimeOf(cues[1]!)).toBeCloseTo(2.001);
    expect(activeCues(cues, seekTimeOf(cues[1]!)).map((c) => c.index)).toContain(2);
  });

  it('列表停靠：当前句；空档里取下一句；过了结尾取最后一句', () => {
    const cues = parseSubtitles(
      ['1', '00:00:01,000 --> 00:00:02,000', '一', '', '2', '00:00:04,000 --> 00:00:05,000', '二', ''].join('\n'),
      'srt',
    );
    expect(nearIndex([], 1)).toBeNull();
    expect(nearIndex(cues, 0)).toBe(1);
    expect(nearIndex(cues, 1.5)).toBe(1);
    expect(nearIndex(cues, 3)).toBe(2);
    expect(nearIndex(cues, 4.5)).toBe(2);
    expect(nearIndex(cues, 99)).toBe(2);
  });
});

describe('定位排队', () => {
  it('一次只发一个 seek；拖动中只保留最新的请求；全部落地后才交还媒体时间', () => {
    const media = { currentTime: 0 };
    const queue = new SeekQueue(media);
    expect(queue.target).toBeNull();

    queue.request(10);
    expect(media.currentTime).toBe(10);
    queue.request(20);
    queue.request(30);
    // 第一次 seek 还没完成：不打断它，显示最新的请求。
    expect(media.currentTime).toBe(10);
    expect(queue.target).toBe(30);

    // 10 落地：中间的 20 丢掉，直接发 30。
    expect(queue.settle()).toBe(false);
    expect(media.currentTime).toBe(30);
    expect(queue.target).toBe(30);

    expect(queue.settle()).toBe(true);
    expect(queue.target).toBeNull();
    // 不是我们发起的 seeked 不影响状态。
    expect(queue.settle()).toBe(true);
  });

  it('reset 丢掉在途与排队的请求', () => {
    const queue = new SeekQueue({ currentTime: 0 });
    queue.request(1);
    queue.request(2);
    queue.reset();
    expect(queue.target).toBeNull();
    expect(queue.settle()).toBe(true);
  });
});

describe('时间显示', () => {
  it('向下截断，不显示还没到的时间', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7.99)).toBe('0:07');
    expect(formatClock(65.3, { tenths: true })).toBe('1:05.3');
    expect(formatClock(2.3, { tenths: true })).toBe('0:02.3');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(5, { hours: true })).toBe('0:00:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-1)).toBe('0:00');
  });
});
