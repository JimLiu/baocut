import { describe, expect, it } from 'vitest';
import type { ChapterSpan } from './chapters.ts';
import type { TranscriptWord } from './transcript-cut.ts';
import {
  clampLiteZoom,
  liteBoundaryPreview,
  DEFAULT_EDITOR_VIEW,
  liteChips,
  liteFitZoom,
  liteKeepInView,
  liteLineAt,
  liteSegmentAt,
  liteSegments,
  liteZoomIn,
  liteZoomLabel,
  liteZoomOut,
  LITE_ZOOM_MAX,
  nextSegmentStart,
  prevSegmentStart,
  rememberEditorView,
  resolveEditorView,
  speechLineGroups,
  speechLines,
  VIEW_MEMORY_MAX,
  type LiteLine,
} from './lite-segments.ts';

const chapter = (id: string, index: number, start: number, end: number, title = id): ChapterSpan => ({
  id,
  index,
  label: title,
  title,
  startFrame: start * 30,
  endFrame: end * 30,
  start,
  end,
});
const line = (id: string, start: number, end: number, text = id): LiteLine => ({ id, start, end, text });

function word(id: string, start: number, end: number, text: string, extra: Partial<TranscriptWord> = {}): TranscriptWord {
  return {
    id,
    index: 0,
    start,
    end,
    text,
    paragraphStart: false,
    state: 'kept',
    spaced: true,
    placements: [{ id, start, end, text, paragraphStart: false, itemId: 'i1', trackId: 't1' } as never],
    ...extra,
  };
}

describe('轻量视图的段：来源与兜底', () => {
  it('有章节按章节分段，段尾接下一章的起点，末章到片尾；句按中点归段', () => {
    const chapters = [chapter('c1', 0, 0, 10), chapter('c2', 1, 10, 20)];
    const lines = [line('l1', 1, 3), line('l2', 9, 11), line('l3', 15, 18)];
    const segs = liteSegments({ chapters, lines, duration: 25, title: 'v' });
    expect(segs.map((s) => [s.id, s.source, s.start, s.end])).toEqual([
      ['c1', 'chapter', 0, 10],
      ['c2', 'chapter', 10, 25],
    ]);
    expect(segs[0]!.lines.map((l) => l.id)).toEqual(['l1']);
    expect(segs[1]!.lines.map((l) => l.id)).toEqual(['l2', 'l3']);
  });

  it('没有章节按旁白的停顿分段：停顿 ≥ 1.8 s 断开，首段从 0 起、末段到片尾，标题取首句', () => {
    const lines = [
      line('a', 2, 4, '第一句很长很长很长很长很长很长很长很长很长很长很长很长'),
      line('b', 5, 7, '第二句'),
      line('c', 9, 11, '第三句'),
    ];
    const segs = liteSegments({ chapters: [], lines, duration: 20, title: 'v' });
    expect(segs.map((s) => [s.id, s.source, s.start, s.end, s.lines.length])).toEqual([
      ['speech-1', 'speech', 0, 9, 2],
      ['speech-2', 'speech', 9, 20, 1],
    ]);
    expect(segs[0]!.title).toBe('第一句很长很长很长很长很长很长很长很长很长很长很');
    expect([...segs[0]!.title].length).toBe(24);
  });

  it('一段累计超过 60 秒时在下一句前断开', () => {
    const lines = Array.from({ length: 40 }, (_, i) => line(`l${i}`, i * 2, i * 2 + 1.5));
    const segs = liteSegments({ chapters: [], lines, duration: 80, title: 'v' });
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.end - s.start).toBeLessThanOrEqual(62);
  });

  it('既没有章节也没有句：整条一段，标题是视频名', () => {
    expect(liteSegments({ chapters: [], lines: [], duration: 12, title: '我的视频' })).toEqual([
      { id: 'whole', index: 0, source: 'whole', title: '我的视频', start: 0, end: 12, lines: [] },
    ]);
  });

  it('章节表的脚本按标记 ID 挂到章节段上，没有脚本的章节不带', () => {
    const chapters = [chapter('c1', 0, 0, 10), chapter('c2', 1, 10, 20)];
    const segs = liteSegments({ chapters, lines: [], duration: 20, title: 'v', scripts: new Map([['c2', '## 第二章\n\n旁白']]) });
    expect(segs[0]).not.toHaveProperty('script');
    expect(segs[1]!.script).toBe('## 第二章\n\n旁白');
  });

  it('长度为 0 的章节（起点在片尾）不成段', () => {
    const segs = liteSegments({ chapters: [chapter('c1', 0, 0, 10), chapter('c2', 1, 10, 10)], lines: [], duration: 10, title: 'v' });
    expect(segs.map((s) => s.id)).toEqual(['c1']);
  });
});

describe('文稿的词折成逐句', () => {
  it('句末标点、停顿超过 1 秒、段首与说话人切换处断开；剪掉的与没落位的词不算', () => {
    const words = [
      word('w1', 0, 0.5, '你好'),
      word('w2', 0.5, 1, '世界。'),
      word('w3', 1.2, 1.6, '第二句'),
      word('w4', 3, 3.5, '第三句', { state: 'cut' }),
      word('w5', 3.6, 4, '继续'),
      word('w6', 4, 4.4, '说', { placements: [] }),
      word('w7', 4.5, 5, '话', { paragraphStart: true }),
      word('w8', 5, 5.5, '换人', { speaker: 'B' }),
    ];
    expect(speechLines(words).map((l) => [l.text, l.start, l.end])).toEqual([
      ['你好 世界。', 0, 1],
      ['第二句', 1.2, 1.6],
      ['继续', 3.6, 4],
      ['话', 4.5, 5],
      ['换人', 5, 5.5],
    ]);
  });

  it('识别器给了句子 ID 时按它分句', () => {
    const words = [
      word('w1', 0, 1, '一。', { sentenceId: 's1' }),
      word('w2', 1, 2, '二', { sentenceId: 's1' }),
      word('w3', 2, 3, '三', { sentenceId: 's2' }),
    ];
    expect(speechLines(words).map((l) => l.text)).toEqual(['一。 二', '三']);
  });

  it('每句带上组成它的词（按句对齐译文用），与 speechLines 一一对应', () => {
    const words = [
      word('w1', 0, 0.5, '你好'),
      word('w2', 0.5, 1, '世界。'),
      word('w3', 1.2, 1.6, '剪掉', { state: 'cut' }),
      word('w4', 1.7, 2, '第二句'),
    ];
    const groups = speechLineGroups(words);
    expect(groups.map((g) => g.line)).toEqual(speechLines(words));
    expect(groups.map((g) => g.words.map((w) => w.id))).toEqual([['w1', 'w2'], ['w4']]);
  });
});

describe('当前段、当前句与上一段 / 下一段', () => {
  const segs = liteSegments({
    chapters: [chapter('c1', 0, 0, 10), chapter('c2', 1, 10, 20)],
    lines: [line('l1', 2, 4), line('l2', 6, 8)],
    duration: 20,
    title: 'v',
  });

  it('末段含右端点，负数与超长回 null', () => {
    expect(liteSegmentAt(segs, 0)!.id).toBe('c1');
    expect(liteSegmentAt(segs, 10)!.id).toBe('c2');
    expect(liteSegmentAt(segs, 20)!.id).toBe('c2');
    expect(liteSegmentAt(segs, 21)).toBeNull();
    expect(liteSegmentAt([], 1)).toBeNull();
  });

  it('句与句之间的空隙算前一句，第一句之前没有当前句', () => {
    const lines = segs[0]!.lines;
    expect(liteLineAt(lines, 1)).toBeNull();
    expect(liteLineAt(lines, 3)!.id).toBe('l1');
    expect(liteLineAt(lines, 5)!.id).toBe('l1');
    expect(liteLineAt(lines, 7)!.id).toBe('l2');
  });

  it('上一段 / 下一段带 0.05 秒容差，两端分别到 0 与片尾', () => {
    expect(prevSegmentStart(segs, 15)).toBe(10);
    expect(prevSegmentStart(segs, 10.02)).toBe(0);
    expect(prevSegmentStart(segs, 0)).toBe(0);
    expect(nextSegmentStart(segs, 3)).toBe(10);
    expect(nextSegmentStart(segs, 15)).toBe(20);
    expect(nextSegmentStart([], 3)).toBe(3);
  });
});

describe('片条与缩放', () => {
  const segs = liteSegments({ chapters: [chapter('c1', 0, 0, 10), chapter('c2', 1, 10, 40)], lines: [], duration: 40, title: 'v' });

  it('片按时长占比，播放头与悬停点换成片内的 0–1', () => {
    const chips = liteChips(segs, 5, 40, 30);
    expect(chips.map((c) => [c.flex, c.current, c.head, c.hover])).toEqual([
      [0.25, true, 0.5, null],
      [0.75, false, null, 2 / 3],
    ]);
  });

  it('拖边界的预览：这一片的终点与下一片的起点一起挪，总长不变；占比跟着变', () => {
    const preview = liteBoundaryPreview(segs, 0, 20);
    expect(preview.map((s) => [s.id, s.start, s.end])).toEqual([
      ['c1', 0, 20],
      ['c2', 20, 40],
    ]);
    expect(liteChips(preview, 5, 40, null).map((c) => c.flex)).toEqual([0.5, 0.5]);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 40],
    ]);
    expect(liteBoundaryPreview(segs, 1, 30)).toEqual(segs);
  });

  it('缩放夹在 1–8 倍，每档 ×1.5，标签是整数百分比', () => {
    expect(clampLiteZoom(0.3)).toBe(1);
    expect(clampLiteZoom(99)).toBe(LITE_ZOOM_MAX);
    expect(liteZoomIn(1)).toBe(1.5);
    expect(liteZoomOut(1.5)).toBe(1);
    expect(liteZoomLabel(2.25)).toBe('225%');
    expect(liteFitZoom(segs[0]!, 40)).toBe(4);
    expect(liteFitZoom(null, 40)).toBe(1);
  });

  it('播放头出了视野就滚到让它落在 1/3 处', () => {
    expect(liteKeepInView(100, 0, 600)).toBeNull();
    expect(liteKeepInView(700, 0, 600)).toBe(500);
    expect(liteKeepInView(10, 0, 600)).toBe(0);
  });
});

describe('默认视图与记忆', () => {
  it('路由 > 这部视频上次的选择 > 全局默认 > 审片', () => {
    expect(resolveEditorView({ route: 'lite', remembered: 'timeline', preference: 'timeline' })).toBe('lite');
    expect(resolveEditorView({ route: null, remembered: 'lite', preference: 'timeline' })).toBe('lite');
    expect(resolveEditorView({ route: null, remembered: undefined, preference: 'timeline' })).toBe('timeline');
    expect(resolveEditorView({ route: null, remembered: undefined, preference: 'auto' })).toBe('lite');
    expect(DEFAULT_EDITOR_VIEW).toBe('lite');
  });

  it('按视频记一份，只留最近的 200 部', () => {
    let byVideo = rememberEditorView({}, 'v1', 'lite');
    expect(byVideo).toEqual({ v1: 'lite' });
    for (let i = 0; i < VIEW_MEMORY_MAX + 5; i++) byVideo = rememberEditorView(byVideo, `x${i}`, 'timeline');
    expect(Object.keys(byVideo).length).toBe(VIEW_MEMORY_MAX);
    expect(byVideo.v1).toBeUndefined();
    expect(rememberEditorView(byVideo, 'x3', 'lite').x3).toBe('lite');
  });
});
