import { describe, expect, it } from 'vitest';
import type { Sequence, Track } from '@baocut/protocol';
import {
  captionBodyOf,
  guessLanguage,
  importCaptionOperations,
  joiner,
  listCues,
  mergeCue,
  readingSpeed,
  setCueTexts,
  splitCue,
  splitTicks,
} from './cue-edit.ts';

const body = {
  schema: 'baocut.caption/1',
  clock: 'source-asset',
  timescale: 1000,
  cues: [
    { id: 'b', start: 3000, end: 5000, text: '第二句话', speaker: 'S1', words: ['w3'] },
    { id: 'a', start: 0, end: 3000, text: 'Hello world', speaker: 'S1', words: ['w1', 'w2'], paragraphStart: true },
    { id: 'c', start: 5000, end: 6000, text: '换人了', speaker: 'S2' },
  ],
};

describe('字幕列表', () => {
  it('按开始时刻排好；没有 ID 的按下标补上', () => {
    expect(listCues(body)!.cues.map((cue) => cue.id)).toEqual(['a', 'b', 'c']);
    expect(listCues({ ...body, cues: [{ start: 0, end: 1000, text: 'x' }] })!.cues[0]).toMatchObject({ id: 'cue-0', start: 0, end: 1 });
    expect(listCues({ schema: 'other' })).toBeNull();
  });

  it('改字：别的字段原样带走，词级时间扔掉；没变就不算', () => {
    const { body: next, changed } = setCueTexts(
      body,
      new Map([
        ['a', 'Hi world'],
        ['b', '第二句话'],
      ]),
    );
    expect(changed).toBe(1);
    expect((next.cues as object[])[1]).toEqual({ id: 'a', start: 0, end: 3000, text: 'Hi world', speaker: 'S1', paragraphStart: true });
    expect((next.cues as object[])[0]).toHaveProperty('words');
  });
});

describe('拆与并', () => {
  it('拆分点按字数比例，两边各留 0.3 秒，落在 0.01 秒上', () => {
    expect(splitTicks(0, 3000, 1, 2, 1000)).toBe(1000);
    expect(splitTicks(0, 3000, 1, 99, 1000)).toBe(300);
    expect(splitTicks(0, 500, 1, 9, 1000)).toBe(250);
    expect(splitTicks(0, 1_000_000, 1, 2, 1_000_000)).toBe(330_000);
  });

  it('在光标处拆成两句：新句 ID 不重复，段首只留在前一句', () => {
    const result = splitCue(body, 'a', 'Hello world', 5)!;
    expect(result.id).toBe('a-1');
    const cues = listCues(result.body)!.cues;
    expect(cues.map((cue) => [cue.id, cue.text, cue.start, cue.end])).toEqual([
      ['a', 'Hello', 0, 1.5],
      ['a-1', 'world', 1.5, 3],
      ['b', '第二句话', 3, 5],
      ['c', '换人了', 5, 6],
    ]);
    const raw = result.body.cues as Record<string, unknown>[];
    expect(raw[1]).not.toHaveProperty('words');
    expect(raw[2]).toEqual({ id: 'a-1', start: 1500, end: 3000, text: 'world', speaker: 'S1' });
    expect(splitCue(result.body, 'a-1', 'world', 0)).toBeNull();
    expect(splitCue(splitCue(result.body, 'a', 'Hel lo', 3)!.body, 'a', 'x y', 1)!.id).toBe('a-3');
  });

  it('并入上一句：文字按语种接、时间接上；说话人不同或到头了不并', () => {
    const up = mergeCue(body, 'b', null, -1);
    expect(up).toMatchObject({ id: 'a', caret: 11 });
    if ('refused' in up) throw new Error('refused');
    expect(listCues(up.body)!.cues.map((cue) => [cue.id, cue.text, cue.start, cue.end])).toEqual([
      ['a', 'Hello world第二句话', 0, 5],
      ['c', '换人了', 5, 6],
    ]);
    expect((up.body.cues as object[]).find((cue) => (cue as { id: string }).id === 'a')).not.toHaveProperty('words');
    expect(mergeCue(body, 'b', null, 1)).toEqual({ refused: 'speaker' });
    expect(mergeCue(body, 'a', null, -1)).toEqual({ refused: 'edge' });
    const down = mergeCue(body, 'a', 'Hello there', 1);
    expect('refused' in down ? null : listCues(down.body)!.cues[0]!.text).toBe('Hello there第二句话');
    expect(joiner('Hello', 'world')).toBe(' ');
    expect(joiner('你好', 'world')).toBe('');
  });
});

describe('阅读速度与语言', () => {
  it('中日韩用更低的阈值', () => {
    expect(readingSpeed('一二三四五六七八九十', 1, 'zh-CN')).toEqual({ value: 10, level: 'warn' });
    expect(readingSpeed('一二三四五六七八九十', 1, 'en')).toEqual({ value: 10, level: 'ok' });
    expect(readingSpeed('abcdefghijklmnopqrstuvw', 1, undefined).level).toBe('bad');
    expect(readingSpeed('  ', 1, 'zh').level).toBe('none');
  });

  it('按字猜语言', () => {
    expect(guessLanguage('今天天气不错，我们出去走走。')).toBe('zh');
    expect(guessLanguage('こんにちは、元気ですか')).toBe('ja');
    expect(guessLanguage('Hello there')).toBeUndefined();
  });
});

describe('导入字幕文件', () => {
  const track = (id: string, order: number, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({
    id,
    order,
    kind,
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: 'visual' },
    ...extra,
  });
  const sequence = (tracks: Track[], items: Sequence['items'] = []): Sequence => ({
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
  });
  const cues = [
    { index: 1, start: 0.5, end: 2.25, text: '第一句' },
    { index: 2, start: 2.5, end: 4.01, text: '第二句' },
  ];

  it('正文是序列时钟、毫秒刻度', () => {
    expect(captionBodyOf(cues)).toEqual({
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [
        { id: 'c1', start: 500, end: 2250, text: '第一句' },
        { id: 'c2', start: 2500, end: 4010, text: '第二句' },
      ],
    });
  });

  it('有空着的字幕轨就放进去，没有就新建一条；实例从 0 到最后一句结束', () => {
    const ops = importCaptionOperations(
      sequence([track('s0', 1, 'subtitle', { locked: true }), track('s1', 2, 'subtitle')]),
      cues,
      'a.srt',
      'zh',
    );
    expect(ops.map((op) => op.type)).toEqual(['putDocument', 'insertItems']);
    expect(ops[0]).toMatchObject({ kind: 'caption', ref: 'imported-caption', name: 'a.srt', language: 'zh', summary: { cueCount: 2 } });
    expect(ops[1]).toMatchObject({
      items: [{ type: 'caption', trackId: 's1', documentRef: 'imported-caption', span: { fromFrame: 0, durationFrames: 121 } }],
    });
    const fresh = importCaptionOperations(sequence([track('v0', 0, 'visual')]), cues, 'a.srt', undefined);
    expect(fresh[0]).toMatchObject({ type: 'addTrack', kind: 'subtitle', ref: 'new-subtitle-track' });
    expect(fresh[1]).not.toHaveProperty('language');
    expect(fresh[2]).toMatchObject({ items: [{ trackRef: 'new-subtitle-track' }] });
  });
});
