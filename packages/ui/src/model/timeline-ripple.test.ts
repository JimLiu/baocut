import { describe, expect, it } from 'vitest';
import { audioItem, captionItem, chapter, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { gapsAfterDelete, mergeSpans, rippleOperations, selectionSpans, shiftFrame, uncoveredSpans } from './timeline-ripple.ts';

// 30 fps：视频在播放头 300 帧处切成两段，字幕也切成两段，下面一条配乐只盖前 5 秒。
const tracks = [track('s1', 'subtitle', 3), track('v1', 'visual', 1), track('a1', 'audio', 2)];
const items = [
  videoItem('vL', 'v1', 0, 300),
  videoItem('vR', 'v1', 300, 600),
  captionItem('cL', 's1', 'doc', 0, 300),
  captionItem('cR', 's1', 'doc', 300, 600),
  audioItem('m', 'a1', 0, 5),
];
const seq = sequence(tracks, items);

describe('区间', () => {
  it('并集：排序、相接的并成一段、空的去掉', () => {
    expect(
      mergeSpans([
        { start: 30, end: 40 },
        { start: 0, end: 10 },
        { start: 10, end: 20 },
        { start: 50, end: 50 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('没盖住的部分', () => {
    expect(uncoveredSpans([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 60, end: 120 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
    ]);
  });

  it('时刻换算：段后的前移，段里的回到段首，段前不动', () => {
    const spans = [
      { start: 100, end: 200 },
      { start: 300, end: 350 },
    ];
    expect(shiftFrame(50, spans)).toBe(50);
    expect(shiftFrame(100, spans)).toBe(100);
    expect(shiftFrame(150, spans)).toBe(100);
    expect(shiftFrame(250, spans)).toBe(150);
    expect(shiftFrame(320, spans)).toBe(200);
    expect(shiftFrame(400, spans)).toBe(250);
  });
});

describe('删除后合拢', () => {
  it('框选左边所有轨道再删：左边整段空了，合拢', () => {
    expect(gapsAfterDelete(seq, ['vL', 'cL', 'm'])).toEqual([{ start: 0, end: 300 }]);
  });

  it('只删左边的视频：字幕还占着，不合拢', () => {
    expect(gapsAfterDelete(seq, ['vL'])).toEqual([]);
  });

  it('配乐还盖着的那一截不合拢，只合拢它之后的', () => {
    expect(gapsAfterDelete(seq, ['vL', 'cL'])).toEqual([{ start: 150, end: 300 }]);
  });

  it('跟着序列末尾的实例不算占着', () => {
    const watermark = videoItem('w', 'v2', 0, 900, { untilSequenceEnd: true });
    const withMark = sequence([...tracks, track('v2', 'visual', 4)], [...items, watermark]);
    expect(gapsAfterDelete(withMark, ['vL', 'cL', 'm'])).toEqual([{ start: 0, end: 300 }]);
  });

  it('音频的小数帧留下的不到一帧的缝不算', () => {
    const short = sequence(tracks, [videoItem('v', 'v1', 0, 300), audioItem('a', 'a1', 0, 9.99)]);
    expect(gapsAfterDelete(short, ['v'])).toEqual([]);
  });

  it('跟着视频的字幕：视频删了那一截字幕也没了，合拢；没有作用实例的字幕照旧占着', () => {
    const scoped = sequence(tracks, [
      videoItem('vL', 'v1', 0, 300),
      videoItem('vR', 'v1', 300, 600),
      captionItem('c', 's1', 'doc', 0, 900, { scopeItemIds: ['vL', 'vR'] }),
    ]);
    expect(gapsAfterDelete(scoped, ['vL'])).toEqual([{ start: 0, end: 300 }]);
    const withMusic = sequence(tracks, [...scoped.items, audioItem('m', 'a1', 0, 5)]);
    expect(gapsAfterDelete(withMusic, ['vL']), '用户放的音频照旧占着').toEqual([{ start: 150, end: 300 }]);
    const plain = sequence(tracks, [videoItem('vL', 'v1', 0, 300), videoItem('vR', 'v1', 300, 600), captionItem('c', 's1', 'doc', 0, 900)]);
    expect(gapsAfterDelete(plain, ['vL'])).toEqual([]);
  });

  it('配音分离出的背景声不算占着，合拢时一起拿掉那一段；配音块算占着', () => {
    const stem = { 'baocut.dub': { stem: 'background', groupId: 'g1' } };
    const separated = sequence(tracks, [
      videoItem('vL', 'v1', 0, 300),
      videoItem('vR', 'v1', 300, 600),
      audioItem('bg', 'a1', 0, 30, { extensions: stem }),
    ]);
    expect(gapsAfterDelete(separated, ['vL'])).toEqual([{ start: 0, end: 300 }]);
    expect(rippleOperations(separated, [{ start: 0, end: 300 }], ['vL']).operations[0]).toMatchObject({ trackIds: ['v1', 'a1'] });
    const dubbed = sequence(tracks, [
      videoItem('vL', 'v1', 0, 300),
      videoItem('vR', 'v1', 300, 600),
      audioItem('d', 'a1', 30, 3, { extensions: { 'baocut.dub': { groupId: 'g1', sentenceId: 's1' } } }),
    ]);
    expect(gapsAfterDelete(dubbed, ['vL'])).toEqual([
      { start: 0, end: 30 },
      { start: 120, end: 300 },
    ]);
  });
});

describe('从所有轨道删除一段', () => {
  it('选中片段盖住的时间并成几段，字幕实例不算', () => {
    expect(selectionSpans(seq, ['vL', 'cR'])).toEqual([{ start: 0, end: 300 }]);
    expect(selectionSpans(seq, ['cL', 'cR'])).toEqual([]);
  });

  it('音频的小数帧往外扩到整帧', () => {
    const odd = sequence(tracks, [audioItem('a', 'a1', 10, 1.01)]);
    expect(selectionSpans(odd, ['a'])).toEqual([{ start: 10, end: 41 }]);
  });
});

describe('拿掉的事务', () => {
  it('每段一条 removeRange，从右往左；声明段首之后还有片段的轨道，按轨道次序', () => {
    const plan = rippleOperations(seq, [
      { start: 0, end: 60 },
      { start: 400, end: 500 },
    ]);
    expect(plan.frames).toBe(160);
    expect(plan.spans).toEqual([
      { start: 0, end: 60 },
      { start: 400, end: 500 },
    ]);
    expect(plan.operations).toEqual([
      { type: 'removeRange', sequenceId: 'seq', from: { unit: 'frames', value: 400 }, to: { unit: 'frames', value: 500 }, trackIds: ['v1', 's1'], alignment: 'exact-frame' },
      { type: 'removeRange', sequenceId: 'seq', from: { unit: 'frames', value: 0 }, to: { unit: 'frames', value: 60 }, trackIds: ['v1', 'a1', 's1'], alignment: 'exact-frame' },
    ]);
  });

  it('同一笔里先删掉的片段不算在轨上；后面什么都没有的段不用拿', () => {
    const plan = rippleOperations(seq, [{ start: 0, end: 300 }], ['vL', 'cL', 'm']);
    expect(plan.operations[0]).toMatchObject({ trackIds: ['v1', 's1'] });
    const tail = rippleOperations(seq, [{ start: 900, end: 960 }]);
    expect(tail).toEqual({ operations: [], spans: [], frames: 0, locked: [] });
  });

  it('后面有锁住的轨道或片段：这一段不拿，记在 locked；锁住的空轨不拦', () => {
    const lockedTrack = sequence([...tracks.slice(0, 2), track('a1', 'audio', 2, { locked: true })], items);
    expect(rippleOperations(lockedTrack, [{ start: 0, end: 60 }]).locked).toEqual([{ start: 0, end: 60 }]);
    expect(rippleOperations(lockedTrack, [{ start: 200, end: 260 }]).spans).toEqual([{ start: 200, end: 260 }]);
    const lockedItem = sequence(tracks, items.map((item) => (item.id === 'vR' ? { ...item, locked: true } : item)));
    const plan = rippleOperations(lockedItem, [{ start: 0, end: 60 }]);
    expect(plan.operations).toEqual([]);
    expect(plan.locked).toEqual([{ start: 0, end: 60 }]);
    const empty = sequence([...tracks, track('v9', 'visual', 9, { locked: true })], items);
    expect(rippleOperations(empty, [{ start: 0, end: 60 }]).spans).toEqual([{ start: 0, end: 60 }]);
  });

  it('后面的章跟着前移；整章在段里的删掉，落到段首的留起点最晚的那一章', () => {
    const marked = sequence(tracks, items, {
      markers: [chapter('k0', 0, '开场'), chapter('k1', 120, '一'), chapter('k2', 200, '二'), chapter('k3', 450, '三'), chapter('k4', 600, '四')],
    });
    const plan = rippleOperations(marked, [
      { start: 100, end: 300 },
      { start: 400, end: 500 },
    ]);
    expect(plan.operations.filter((op) => op.type !== 'removeRange')).toEqual([
      { type: 'removeChapter', sequenceId: 'seq', chapterId: 'k1' },
      { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'k2', at: { unit: 'frames', value: 100 }, alignment: 'exact-frame' },
      { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'k3', at: { unit: 'frames', value: 200 }, alignment: 'exact-frame' },
      { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'k4', at: { unit: 'frames', value: 300 }, alignment: 'exact-frame' },
    ]);
  });

  it('章贴着段首、后一章在段里：贴着的那章整章拿掉', () => {
    const marked = sequence(tracks, items, { markers: [chapter('a', 0, 'A'), chapter('b', 100, 'B'), chapter('c', 150, 'C')] });
    const chapterOps = rippleOperations(marked, [{ start: 100, end: 200 }]).operations.filter((op) => op.type !== 'removeRange');
    expect(chapterOps).toEqual([{ type: 'removeChapter', sequenceId: 'seq', chapterId: 'b' }, { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'c', at: { unit: 'frames', value: 100 }, alignment: 'exact-frame' }]);
  });

  it('锁住没拿的段不挪章', () => {
    const marked = sequence([...tracks.slice(0, 2), track('a1', 'audio', 2, { locked: true })], items, { markers: [chapter('a', 400, 'A')] });
    expect(rippleOperations(marked, [{ start: 0, end: 60 }]).operations).toEqual([]);
  });
});
