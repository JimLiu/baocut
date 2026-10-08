import { describe, expect, it } from 'vitest';
import { chapter, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { chapterPieces } from './export-range.ts';
import {
  addChapterOperation,
  addChapterRefusal,
  bandSegments,
  chapterAt,
  chapterRows,
  cutChapterOperations,
  defaultChapterTitle,
  moveChapterOperation,
  moveParagraphPlan,
  nextChapterStart,
  paragraphSpan,
  prevChapterStart,
  removeChapterOperation,
  renameChapterOperation,
  sequenceChapters,
  startBounds,
  visibleChapters,
  type ChapterRow,
} from './chapters.ts';

// 60 秒的片子（30 fps）；三章：0、20、45 秒，第三章没起名。
const seq = sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
  markers: [chapter('m3', 1350, '  '), chapter('m1', 0, '开场'), chapter('m2', 600, '正文'), { id: 'n1', frame: 300, label: '备注', kind: 'note' }],
});
const chapters = sequenceChapters(seq);

describe('章节：区间', () => {
  it('按起点排，到下一章为止，最后一章到片尾；没名字的写「第 N 章」，其他标记不算', () => {
    expect(chapters.map((c) => [c.id, c.index, c.title, c.start, c.end, c.startFrame, c.endFrame])).toEqual([
      ['m1', 0, '开场', 0, 20, 0, 600],
      ['m2', 1, '正文', 20, 45, 600, 1350],
      ['m3', 2, '第 3 章', 45, 60, 1350, 1800],
    ]);
  });

  it('与导出页的章节区间同一口径', () => {
    expect(visibleChapters(chapters).map((c) => [c.id, c.title, c.start, c.end])).toEqual(chapterPieces(seq).map((p) => [p.id, p.label, p.start, p.end]));
  });

  it('起点在片尾之后的章还在，长度为 0，条上不画', () => {
    const late = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 300)], { markers: [chapter('a', 0, 'A'), chapter('b', 600, 'B')] }),
    );
    expect(late.map((c) => [c.id, c.start, c.end])).toEqual([
      ['a', 0, 10],
      ['b', 20, 20],
    ]);
    expect(visibleChapters(late).map((c) => c.id)).toEqual(['a']);
  });

  it('播放头在哪一章：左闭右开，最后一章含片尾；第一章之前是 -1', () => {
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 19.99)).toBe(0);
    expect(chapterAt(chapters, 20)).toBe(1);
    expect(chapterAt(chapters, 60)).toBe(2);
    const late = sequenceChapters(sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], { markers: [chapter('a', 300, 'A')] }));
    expect(chapterAt(late, 5)).toBe(-1);
    expect(chapterAt([], 5)).toBe(-1);
  });
});

describe('章节：上一章 / 下一章', () => {
  it('上一章：章中间先回本章起点，贴着起点时去上一章；最前面回到 0', () => {
    expect(prevChapterStart(chapters, 30)).toBe(20);
    expect(prevChapterStart(chapters, 20.03)).toBe(0);
    expect(prevChapterStart(chapters, 20)).toBe(0);
    expect(prevChapterStart(chapters, 0)).toBe(0);
    expect(prevChapterStart([], 12)).toBe(0);
  });

  it('下一章：后面最近的章起点；最后一章里去片尾；没有章时不动', () => {
    expect(nextChapterStart(chapters, 0)).toBe(20);
    expect(nextChapterStart(chapters, 19.97)).toBe(45);
    expect(nextChapterStart(chapters, 50)).toBe(60);
    expect(nextChapterStart([], 12)).toBe(12);
  });
});

describe('章节条', () => {
  it('章节铺满片长；第一章之前与章节之间的空当补成没有章的段', () => {
    const gap = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], {
        markers: [chapter('a', 300, 'A', { durationFrames: 300 }), chapter('b', 900, 'B')],
      }),
    );
    expect(bandSegments(gap, 60).map((s) => [s.chapter?.id ?? null, s.start, s.end])).toEqual([
      [null, 0, 10],
      ['a', 10, 20],
      [null, 20, 30],
      ['b', 30, 60],
    ]);
  });

  it('没有章时是一整段播放进度；片长为 0 时什么都不画', () => {
    expect(bandSegments([], 12).map((s) => [s.chapter, s.start, s.end])).toEqual([[null, 0, 12]]);
    expect(bandSegments(chapters, 0)).toEqual([]);
  });

  it('拖起点：晚于上一章、早于下一章，不出片尾；第一章最早到 0', () => {
    expect(startBounds(chapters, 0, 1800)).toEqual({ min: 0, max: 599 });
    expect(startBounds(chapters, 1, 1800)).toEqual({ min: 1, max: 1349 });
    expect(startBounds(chapters, 2, 1800)).toEqual({ min: 601, max: 1799 });
  });
});

describe('章节：编辑操作', () => {
  it('加一章：按帧提交、exact-frame；预填「第 N 章」', () => {
    expect(defaultChapterTitle(chapters, 900)).toBe('第 3 章');
    expect(defaultChapterTitle([], 0)).toBe('第 1 章');
    expect(addChapterOperation(seq, chapters, 900, ' 插曲 ')).toEqual({
      ok: true,
      operation: { type: 'upsertChapter', sequenceId: 'seq', at: { unit: 'frames', value: 900 }, alignment: 'exact-frame', title: '插曲' },
    });
  });

  it('加一章不成立：那一帧已有一章、落在片尾、名字空白', () => {
    expect(addChapterOperation(seq, chapters, 600, 'x')).toEqual({ ok: false, reason: 'exists' });
    expect(addChapterOperation(seq, chapters, 1800, 'x')).toEqual({ ok: false, reason: 'beyond' });
    expect(addChapterOperation(seq, chapters, 900, '   ')).toEqual({ ok: false, reason: 'blank' });
    expect([addChapterRefusal(seq, chapters, 600), addChapterRefusal(seq, chapters, 1800), addChapterRefusal(seq, chapters, 900)]).toEqual([
      'exists',
      'beyond',
      null,
    ]);
  });

  it('改名：去空白；空白或没变时不写，标题过长截到 200 字', () => {
    const second = chapters[1]!;
    expect(renameChapterOperation('seq', second, ' 正片 ')).toEqual({ type: 'upsertChapter', sequenceId: 'seq', chapterId: 'm2', title: '正片' });
    expect(renameChapterOperation('seq', second, '正文')).toBeNull();
    expect(renameChapterOperation('seq', second, '  ')).toBeNull();
    const long = renameChapterOperation('seq', second, '长'.repeat(300));
    expect(long && 'title' in long ? long.title?.length : 0).toBe(200);
  });

  it('挪起点与删除', () => {
    const second = chapters[1]!;
    expect(moveChapterOperation('seq', second, 750)).toEqual({
      type: 'upsertChapter',
      sequenceId: 'seq',
      chapterId: 'm2',
      at: { unit: 'frames', value: 750 },
      alignment: 'exact-frame',
    });
    expect(moveChapterOperation('seq', second, 600)).toBeNull();
    expect(removeChapterOperation('seq', second)).toEqual({ type: 'removeChapter', sequenceId: 'seq', chapterId: 'm2' });
  });
});

describe('文稿按章分组', () => {
  const brief = (rows: ChapterRow[]) => rows.map((r) => (r.kind === 'chapter' ? `#${r.chapter?.id ?? '-'}:${r.count}` : r.index));

  it('段中点落在哪一章就归哪一章，章变了插头行', () => {
    const paras = [
      { start: 0, end: 8 },
      { start: 8, end: 22 },
      { start: 22, end: 40 },
      { start: 46, end: 58 },
    ];
    expect(brief(chapterRows(chapters, paras, true))).toEqual(['#m1:2', 0, 1, '#m2:1', 2, '#m3:1', 3]);
  });

  it('整段剪掉的跟着前一段，开头的跟着后一段', () => {
    const paras = [null, { start: 2, end: 6 }, null, { start: 25, end: 30 }];
    expect(brief(chapterRows(chapters, paras, false))).toEqual(['#m1:3', 0, 1, 2, '#m2:1', 3]);
  });

  it('没有段落的章：只有一份转写时照样出头行（开头、中间、结尾），几份转写时不列', () => {
    const paras = [{ start: 25, end: 30 }];
    expect(brief(chapterRows(chapters, paras, true))).toEqual(['#m1:0', '#m2:1', 0, '#m3:0']);
    expect(brief(chapterRows(chapters, paras, false))).toEqual(['#m2:1', 0]);
  });

  it('第一章之前的段不插头行；片段挪过之后又回到第一章之前，插「第一章之前」', () => {
    const late = sequenceChapters(sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], { markers: [chapter('a', 300, 'A')] }));
    const paras = [
      { start: 0, end: 4 },
      { start: 12, end: 20 },
      { start: 2, end: 6 },
    ];
    expect(brief(chapterRows(late, paras, true))).toEqual([0, '#a:1', 1, '#-:1', 2]);
  });

  it('片段挪过、章号往回跳时照次序插头行，有段落的章不再当空章补', () => {
    const paras = [
      { start: 2, end: 6 },
      { start: 50, end: 55 },
      { start: 25, end: 30 },
    ];
    expect(brief(chapterRows(chapters, paras, true))).toEqual(['#m1:1', 0, '#m3:1', 1, '#m2:1', 2]);
  });

  it('段的区间：首个还在的词起点到末个还在的词终点；整段剪掉是 null', () => {
    const at = (start: number, end: number) => ({ start, end });
    expect(paragraphSpan([{ placements: [] }, { placements: [at(2, 3)] }, { placements: [at(4, 5), at(9, 10)] }, { placements: [] }])).toEqual(at(2, 5));
    expect(paragraphSpan([{ placements: [] }])).toBeNull();
  });

  it('没有章时不插头行', () => {
    expect(brief(chapterRows([], [{ start: 0, end: 1 }, null], true))).toEqual([0, 1]);
  });
});

describe('文稿里换章、剪章', () => {
  // 第一章两段，第二章两段，第三章一段。
  const paras = [
    { start: 0, end: 8 },
    { start: 8.5, end: 18 },
    { start: 22, end: 30 },
    { start: 31.02, end: 40 },
    { start: 46, end: 58 },
  ];

  it('往后挪：下一章的起点挪到这一段开头（向下取整到帧），同侧后面的段一起走', () => {
    expect(moveParagraphPlan(seq, chapters, paras, 1, 1)).toMatchObject({
      from: { id: 'm1' },
      to: { id: 'm2' },
      frame: 255,
      moved: 1,
      operation: { type: 'upsertChapter', chapterId: 'm2', at: { unit: 'frames', value: 255 }, alignment: 'exact-frame' },
    });
  });

  it('往前挪：这一章的起点挪到同章下一段的开头', () => {
    expect(moveParagraphPlan(seq, chapters, paras, 2, -1)).toMatchObject({
      from: { id: 'm2' },
      to: { id: 'm1' },
      frame: 930,
      moved: 1,
      operation: { chapterId: 'm2', at: { unit: 'frames', value: 930 } },
    });
  });

  it('不成立：会掏空本章、前后没有章、整段剪掉、在第一章之前', () => {
    expect(moveParagraphPlan(seq, chapters, paras, 0, 1)).toBeNull();
    expect(moveParagraphPlan(seq, chapters, paras, 3, -1)).toBeNull();
    expect(moveParagraphPlan(seq, chapters, paras, 0, -1)).toBeNull();
    expect(moveParagraphPlan(seq, chapters, paras, 4, 1)).toBeNull();
    expect(moveParagraphPlan(seq, chapters, [null, ...paras], 0, 1)).toBeNull();
    const late = sequenceChapters(
      sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], { markers: [chapter('a', 300, 'A'), chapter('b', 900, 'B')] }),
    );
    expect(
      moveParagraphPlan(
        seq,
        late,
        [
          { start: 0, end: 4 },
          { start: 5, end: 8 },
        ],
        1,
        1,
      ),
    ).toBeNull();
  });

  it('剪掉一章：删区间、删标记、后面的章按升序前移这一章的长度，一笔事务', () => {
    expect(cutChapterOperations(seq, chapters, chapters[0]!, ['v1'])).toEqual({
      ok: true,
      frames: 600,
      operations: [
        {
          type: 'removeRange',
          sequenceId: 'seq',
          from: { unit: 'frames', value: 0 },
          to: { unit: 'frames', value: 600 },
          trackIds: ['v1'],
          alignment: 'exact-frame',
        },
        { type: 'removeChapter', sequenceId: 'seq', chapterId: 'm1' },
        { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'm2', at: { unit: 'frames', value: 0 }, alignment: 'exact-frame' },
        { type: 'upsertChapter', sequenceId: 'seq', chapterId: 'm3', at: { unit: 'frames', value: 750 }, alignment: 'exact-frame' },
      ],
    });
    const last = cutChapterOperations(seq, chapters, chapters[2]!, ['v1']);
    expect(last.ok && last.operations.map((op) => op.type)).toEqual(['removeRange', 'removeChapter']);
  });

  it('剪掉一章不成立：整个视频就这一章、没有长度、没有要剪的轨道', () => {
    const only = sequence([track('v1', 'visual', 1)], [videoItem('c1', 'v1', 0, 1800)], { markers: [chapter('a', 0, 'A'), chapter('z', 1800, 'Z')] });
    const list = sequenceChapters(only);
    expect(cutChapterOperations(only, list, list[0]!, ['v1'])).toEqual({ ok: false, reason: 'whole' });
    expect(cutChapterOperations(only, list, list[1]!, ['v1'])).toEqual({ ok: false, reason: 'empty' });
    expect(cutChapterOperations(seq, chapters, chapters[1]!, [])).toEqual({ ok: false, reason: 'no-tracks' });
  });
});
