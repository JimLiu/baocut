import { describe, expect, it } from 'vitest';
import type { Sequence, SequenceItem } from '@baocut/protocol';
import type { VisualLayer } from '../render/frame-plan.ts';
import type { CaptionHit } from '../render/render-planner.ts';
import type { LiteSegment } from './lite-segments.ts';
import * as M from './markup.ts';

/** 轻量编辑器的标记（docs/design/lite-editor §4；原型 designs/baocut/app/model-markup.test.js）。 */

const frame = { w: 800, h: 400 };

describe('状态与历史', () => {
  it('初始：画笔、矩形、红、4px；加标记带当前颜色粗细并选中它', () => {
    const s = M.init();
    expect([s.tool, s.shape, s.color, s.width, s.marks, s.sel]).toEqual(['pen', 'box', 'red', 4, [], null]);
    const t = M.add(M.setColor(M.setWidth(s, 12), 'blue'), { timeMs: 0, kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(t.marks.length).toBe(1);
    expect([t.marks[0]!.color, t.marks[0]!.width, t.sel]).toEqual(['blue', 12, t.marks[0]!.id]);
    expect(M.setShape(s, 'arrow').tool).toBe('shape');
    expect(M.setTool(t, 'text').sel).toBeNull();
  });

  it('撤销 / 重做：每次改动进历史，撤销回上一组，重做再回来；新改动清掉未来', () => {
    let s = M.add(M.init(), { timeMs: 0, id: 'a', kind: 'box', x: 0, y: 0, w: 0.5, h: 0.5 });
    s = M.add(s, { timeMs: 0, id: 'b', kind: 'pin', x: 0.2, y: 0.2, w: 0, h: 0 });
    expect(M.canUndo(s) && !M.canRedo(s)).toBe(true);
    s = M.undo(s);
    expect(s.marks.map((m) => m.id)).toEqual(['a']);
    expect(M.canRedo(s)).toBe(true);
    s = M.redo(s);
    expect(s.marks.map((m) => m.id)).toEqual(['a', 'b']);
    s = M.undo(M.undo(s));
    expect([s.marks, M.canUndo(s)]).toEqual([[], false]);
    s = M.add(s, { timeMs: 0, id: 'c', kind: 'text', x: 0.5, y: 0.5, w: 0, h: 0, text: '字' });
    expect(M.canRedo(s)).toBe(false);
    expect(M.clear(s).marks).toEqual([]);
    expect(M.undo(M.clear(s)).marks.map((m) => m.id)).toEqual(['c']);
  });

  it('选中后改颜色 / 粗细连那条一起改；删除、拖动中的改动不进历史', () => {
    let s = M.add(M.init(), { timeMs: 0, id: 'a', kind: 'line', x: 0.1, y: 0.1, w: 0, h: 0, to: { x: 0.5, y: 0.5 } });
    s = M.setColor(s, 'green');
    expect(s.marks[0]!.color).toBe('green');
    s = M.select(s, null);
    s = M.setWidth(s, 8);
    expect([s.width, s.marks[0]!.width]).toEqual([8, 4]);
    const n = s.past.length;
    s = M.update(s, 'a', { x: 0.2 }, { history: false });
    expect([s.marks[0]!.x, s.past.length]).toEqual([0.2, n]);
    const orig = s.marks[0]!;
    s = M.update(s, 'a', { x: 0.3 }, { history: false });
    s = M.finishDrag(s, 'a', orig);
    expect([s.marks[0]!.x, s.past.length, s.past[n]!.find((m) => m.id === 'a')!.x]).toEqual([0.3, n + 1, 0.2]);
    expect(M.finishDrag(s, 'a', s.marks[0])).toBe(s);
    s = M.remove(s, 'a');
    expect([s.marks, s.sel, s.past.length]).toEqual([[], null, n + 2]);
  });

  it('发出去的几条从画面与整段历史里一起拿掉，撤销不再带回来', () => {
    let s = M.add(M.init(), { timeMs: 0, id: 'a', kind: 'box', x: 0, y: 0, w: 0.5, h: 0.5 });
    s = M.add(s, { timeMs: 0, id: 'c', kind: 'comment', x: 0.4, y: 0.3, w: 0, h: 0, text: '慢一点' });
    s = M.forget(s, ['c']);
    expect([s.marks.map((m) => m.id), s.sel]).toEqual([['a'], null]);
    expect(M.undo(s).marks.map((m) => m.id)).toEqual(['a']);
    expect(M.forget(s, [])).toBe(s);
  });
});

describe('几何', () => {
  it('手势换成归一化几何：矩形取两点的框，箭头带终点，画笔带点列与外接框，点只记一个点', () => {
    expect(M.fromGesture('box', { x: 600, y: 100 }, { x: 200, y: 300 }, frame)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(M.fromGesture('arrow', { x: -20, y: 0 }, { x: 900, y: 400 }, frame)).toEqual({ x: 0, y: 0, w: 0, h: 0, to: { x: 1, y: 1 } });
    const pen = M.fromGesture('pen', { x: 80, y: 40 }, null, frame, [
      { x: 80, y: 40 },
      { x: 160, y: 80 },
      { x: 120, y: 200 },
    ]);
    expect(pen.points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.15, y: 0.5 },
    ]);
    expect([pen.x, pen.y, pen.w, pen.h]).toEqual([0.1, 0.1, 0.1, 0.4]);
    expect(M.fromGesture('pin', { x: 400, y: 200 }, null, frame)).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 });
  });

  it('平移不出画面，点列与终点一起挪；把手：框八枚、线两端、点没有；拖把手改框不小于 1%', () => {
    const line = { kind: 'arrow' as const, x: 0.8, y: 0.8, w: 0, h: 0, to: { x: 0.9, y: 0.9 } };
    const moved = M.move(line, 0.5, -0.2);
    expect([moved.x, moved.y, moved.to]).toEqual([0.9, 0.6, { x: 1, y: 0.7 }]);
    const pen = {
      kind: 'pen' as const,
      x: 0,
      y: 0,
      w: 0.2,
      h: 0.2,
      points: [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.2 },
      ],
    };
    expect(M.move(pen, -0.5, 0.1).points).toEqual([
      { x: 0, y: 0.1 },
      { x: 0.2, y: 0.3 },
    ]);
    const box = { kind: 'box' as const, x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
    expect(M.handles(box).map((h) => h.k)).toEqual(M.BOX_HANDLES);
    expect(M.handles({ ...box, kind: 'element' }).length).toBe(8);
    expect(M.handles(box)[4]).toEqual({ k: 'se', x: 0.6, y: 0.4 });
    expect(M.handles(line).map((h) => h.k)).toEqual(['from', 'to']);
    expect(M.handles({ kind: 'pin', x: 0.5, y: 0.5, w: 0, h: 0 })).toEqual([]);
    expect(M.resize(box, 'se', 0.1, 0.1)).toEqual({ kind: 'box', x: 0.2, y: 0.2, w: 0.5, h: 0.3 });
    expect(M.resize(box, 'nw', 0.1, -0.5)).toEqual({ kind: 'box', x: 0.3, y: 0, w: 0.3, h: 0.4 });
    expect(M.resize(box, 'e', -0.9, 0).w).toBe(0.01);
    expect(M.resize(line, 'to', 0.5, 0.5).to).toEqual({ x: 1, y: 1 });
  });

  it('编号按加入顺序从 1 起；没写字的文字标记不发', () => {
    let s = M.add(M.init(), { timeMs: 0, id: 's1', kind: 'pin', x: 0.1, y: 0.1, w: 0, h: 0 });
    s = M.add(s, { timeMs: 0, id: 't', kind: 'text', x: 0.3, y: 0.3, w: 0, h: 0, text: '' });
    s = M.add(s, { timeMs: 0, id: 's2', kind: 'pin', x: 0.2, y: 0.2, w: 0, h: 0 });
    expect([M.stepNumber(s.marks, 's1'), M.stepNumber(s.marks, 's2'), M.stepNumber(s.marks, 't')]).toEqual([1, 2, null]);
    expect(M.sendable(s.marks).map((m) => m.id)).toEqual(['s1', 's2']);
    expect(M.stepNumber(M.remove(s, 's1').marks, 's2')).toBe(1);
  });
});

describe('选择元素', () => {
  const canvas = { width: 1920, height: 1080 };
  const sequence = {
    tracks: [
      { id: 'v1', order: 0, kind: 'visual' },
      { id: 'v2', order: 1, kind: 'visual' },
    ],
    items: [
      { id: 'main', type: 'video', trackId: 'v1' },
      { id: 'logo', type: 'text', trackId: 'v2', text: '宝玉讲明白' },
      { id: 'pic', type: 'image', trackId: 'v2', name: 'cover' },
    ],
  } as unknown as Sequence;
  const layer = (itemId: string, kind: VisualLayer['kind'], matrix: VisualLayer['matrix']) =>
    ({ itemId, kind, matrix, opacity: 1 }) as VisualLayer;
  const layers = [
    layer('main', 'video', [1920, 0, 0, 1080, 0, 0]),
    layer('pic', 'image', [200, 0, 0, 100, 1000, 100]),
    layer('logo', 'text', [200, 0, 0, 100, 100, 100]),
  ];
  const poses: Record<string, { cx: number; cy: number; w: number; h: number; rotation: number }> = {
    logo: { cx: 200, cy: 150, w: 200, h: 100, rotation: 0 },
    pic: { cx: 1100, cy: 150, w: 200, h: 100, rotation: 0 },
  };
  const poseOf = (item: SequenceItem) => poses[item.id] ?? null;
  const hit = (over: Partial<CaptionHit>): CaptionHit => ({
    layerId: 'cap',
    itemId: 'cap',
    documentId: 'doc',
    cueId: 'c3',
    cx: 960,
    cy: 950,
    w: 800,
    h: 60,
    rotation: 0,
    ...over,
  });

  it('先认字幕行（同一句的几行并成一个框），带那一句的文字', () => {
    const captionHits = [hit({}), hit({ cy: 1010 })];
    const pick = M.pickElement({
      point: { x: 960, y: 950 },
      canvas,
      captionHits,
      layers,
      sequence,
      poseOf,
      cueText: () => ' 它没有掉下来 ',
    });
    expect(pick).toEqual({ rect: { x: 560, y: 920, w: 800, h: 120 }, element: { kind: 'caption', id: 'cap:c3', text: '它没有掉下来' } });
    const bare = M.pickElement({ point: { x: 960, y: 950 }, canvas, captionHits, layers, sequence, poseOf });
    expect(bare?.element).toEqual({ kind: 'caption', id: 'cap:c3' });
  });

  it('再认画面元素：文字用它的字，别的用名字；主视频不算', () => {
    const pick = (x: number, y: number) => M.pickElement({ point: { x, y }, canvas, captionHits: [], layers, sequence, poseOf });
    expect(pick(200, 150)).toEqual({
      rect: { x: 100, y: 100, w: 200, h: 100 },
      element: { kind: 'element', id: 'logo', text: '宝玉讲明白' },
    });
    expect(pick(1100, 150)?.element).toEqual({ kind: 'element', id: 'pic', text: 'cover' });
    expect(pick(900, 600)).toBeNull();
    expect(M.normalizedRect({ x: 100, y: 100, w: 200, h: 100 }, canvas)).toEqual({ x: 0.052, y: 0.093, w: 0.104, h: 0.093 });
  });

  it('命中实时合成层那件才再问 iframe；问到的节点记成 html（尺寸是节点的 CSS 像素，框裁在画布内）', () => {
    const live = M.pickElement({ point: { x: 200, y: 150 }, canvas, captionHits: [], layers, sequence, poseOf });
    expect(M.wantsLivePick(live, 'logo')).toBe(true);
    expect(M.wantsLivePick(live, 'pic')).toBe(false);
    expect(M.wantsLivePick(live, null)).toBe(false);
    expect(M.wantsLivePick(null, 'logo')).toBe(false);
    expect(M.wantsLivePick({ rect: { x: 0, y: 0, w: 1, h: 1 }, element: { kind: 'caption', id: 'logo' } }, 'logo')).toBe(false);

    const node = {
      selector: 'button#play.icon',
      w: 32,
      h: 32,
      name: 'Play',
      role: 'button',
      focusable: true,
      rect: { x: 0, y: 0, w: 32, h: 32 },
    };
    expect(M.htmlPick({ rect: { x: -20, y: 1000, w: 120, h: 120 }, node }, canvas)).toEqual({
      rect: { x: 0, y: 1000, w: 100, h: 80 },
      element: { kind: 'html', selector: 'button#play.icon', w: 32, h: 32, name: 'Play', role: 'button', focusable: true },
    });
    const bare = M.htmlPick(
      { rect: { x: 10, y: 10, w: 5, h: 5 }, node: { selector: 'div', w: 5, h: 5, focusable: false, rect: node.rect } },
      canvas,
    );
    expect(bare?.element).toEqual({ kind: 'html', selector: 'div', w: 5, h: 5, focusable: false });
    expect(M.htmlPick({ rect: { x: 3000, y: 10, w: 5, h: 5 }, node }, canvas)).toBeNull();
  });
});

describe('换成视频标注', () => {
  const lines = [
    { id: 's1:l1', start: 0, end: 2, text: '第一句' },
    { id: 's1:l2', start: 2, end: 5, text: '那一个有点危险的做法' },
  ];
  const segments: LiteSegment[] = [
    { id: 's1', index: 0, source: 'chapter', title: '钩子', start: 0, end: 10, lines },
    { id: 's2', index: 1, source: 'chapter', title: '倒着为什么不掉', start: 10, end: 20, lines: [] },
  ];

  it('落点：段与句（句序从 1 起）；没有当前句时省略', () => {
    expect(M.markupPlacement(segments, 3)).toEqual({
      segment: { id: 's1', kind: 'chapter', index: 0, title: '钩子' },
      line: { id: 's1:l2', index: 2, text: '那一个有点危险的做法' },
    });
    expect(M.markupPlacement(segments, 12)).toEqual({ segment: { id: 's2', kind: 'chapter', index: 1, title: '倒着为什么不掉' } });
    expect(M.markupPlacement([], 3)).toEqual({});
  });

  it('HTML 节点的元素标记只带协议字段，detail 照 DevTools 的说法', () => {
    const element = { kind: 'html' as const, selector: 'button#play', w: 32, h: 32, name: 'Play', role: 'button', focusable: true };
    const s = M.add(M.init(), {
      timeMs: 0,
      id: 'e',
      kind: 'element',
      x: 0.1,
      y: 0.1,
      w: 0.1,
      h: 0.1,
      element,
      elementBox: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    });
    const [note] = M.toNotes(s.marks, { videoId: 'v', video: { conversationId: 'c', path: 'p' }, revision: '1' });
    expect(note!.element).toEqual({ ...element, detail: 'html button#play 32×32 name="Play" role=button' });
    expect(note!.label).toContain('button#play · 32 × 32');
  });

  it('矩形是 box、编号是 pin，带颜色粗细与落点；文字与评论的内容进批注；元素只带协议字段与 detail；每条带那一帧的截图，评论另带印章位置', () => {
    let s = M.add(M.init(), { timeMs: 3000, id: 'a', kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    s = M.add(s, { timeMs: 3000, id: 'b', kind: 'pin', x: 0.5, y: 0.5, w: 0, h: 0 });
    s = M.add(s, { timeMs: 3000, id: 'c', kind: 'text', x: 0.6, y: 0.6, w: 0, h: 0, text: ' 字太小 ' });
    s = M.add(s, { timeMs: 3000, id: 'd', kind: 'text', x: 0.7, y: 0.7, w: 0, h: 0, text: '' });
    s = M.add(s, {
      timeMs: 3000,
      id: 'e',
      kind: 'element',
      x: 0.2,
      y: 0.8,
      w: 0.6,
      h: 0.1,
      element: { kind: 'caption', id: 'cap:c3', text: '你好' },
    });
    s = M.add(s, {
      timeMs: 3000,
      id: 'f',
      kind: 'comment',
      x: 0.4,
      y: 0.3,
      w: 0,
      h: 0,
      text: '这里慢一点',
      element: { kind: 'element', id: 'logo' },
      elementBox: { x: 0.3, y: 0.2, w: 0.2, h: 0.2 },
    });
    s = M.add(s, { timeMs: 3000, id: 'g', kind: 'comment', x: 0.5, y: 0.3, w: 0, h: 0, text: '' });
    s = M.add(s, { timeMs: 3000, id: 'h', kind: 'line', x: 0.1, y: 0.1, w: 0, h: 0, to: { x: 0.3, y: 0.4 }, color: 'white', width: 8 });
    const base = {
      videoId: 'v1',
      video: { conversationId: 'c1', path: 'talk' },
      revision: '12',
      segments,
    };
    const notes = M.toNotes(s.marks, base);
    expect(notes.map((n) => n.kind)).toEqual(['box', 'pin', 'text', 'element', 'comment', 'line']);
    expect(notes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'e', 'f', 'h']);
    expect(notes[0]).toEqual({
      id: 'a',
      videoId: 'v1',
      video: { conversationId: 'c1', path: 'talk' },
      revision: '12',
      timeMs: 3000,
      kind: 'box',
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      style: { color: 'red', width: 4 },
      shot: { timeMs: 3000 },
      segment: { id: 's1', kind: 'chapter', index: 0, title: '钩子' },
      line: { id: 's1:l2', index: 2, text: '那一个有点危险的做法' },
      label: '00:03.0 · 框 · 画面左上 · s1 · 第 2 句',
      text: '',
    });
    expect(notes[2]!.text).toBe('字太小');
    expect(notes[3]!.element).toEqual({ kind: 'caption', id: 'cap:c3', text: '你好', detail: 'caption cap:c3 "你好"' });
    expect(notes[3]!.label).toBe('00:03.0 · 字幕 · “你好” · s1 · 第 2 句');
    expect(notes[4]!.shot).toEqual({ timeMs: 3000, stamp: { x: 0.4, y: 0.3 } });
    expect(notes[4]!.element).toEqual({ kind: 'element', id: 'logo', detail: 'element logo' });
    expect(notes[4]).not.toHaveProperty('elementBox');
    expect([notes[5]!.to, notes[5]!.style]).toEqual([
      { x: 0.3, y: 0.4 },
      { color: 'white', width: 8 },
    ]);
    const bare = M.toNotes([s.marks[0]!], { ...base, segments: undefined });
    expect(bare[0]).not.toHaveProperty('segment');
  });

  it('每条标记记自己的帧：时刻与落点按各自的播放头算，同一帧的共一张截图', () => {
    let s = M.add(M.init(), { id: 'a', timeMs: 3000, kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    s = M.add(s, { id: 'b', timeMs: 70000, kind: 'pin', x: 0.5, y: 0.5, w: 0, h: 0 });
    s = M.add(s, { id: 'c', timeMs: 3000, kind: 'comment', x: 0.4, y: 0.3, w: 0, h: 0, text: '慢一点' });
    const notes = M.toNotes(s.marks, { videoId: 'v1', video: { conversationId: 'c1', path: 'talk' }, revision: '12', segments });
    expect(notes.map((n) => [n.timeMs, n.segment?.id ?? null, n.shot])).toEqual([
      [3000, 's1', { timeMs: 3000 }],
      [70000, null, { timeMs: 70000 }],
      [3000, 's1', { timeMs: 3000, stamp: { x: 0.4, y: 0.3 } }],
    ]);
    expect(M.markFrames(s.marks)).toEqual([3000, 70000]);
  });

  it('进了草稿的标注画回画面：toNotes 的反向，没有 style 的按蓝色 2px；序号钮落在锚点上（画笔是第一个点）', () => {
    let s = M.add(M.init(), { id: 'a', timeMs: 3000, kind: 'arrow', x: 0.1, y: 0.1, w: 0, h: 0, to: { x: 0.5, y: 0.5 } });
    s = M.add(s, { id: 'b', timeMs: 3000, kind: 'text', x: 0.6, y: 0.3, w: 0, h: 0, text: '字太小' });
    const base = { videoId: 'v1', video: { conversationId: 'c1', path: 'talk' } as const, revision: '12' };
    const [arrow, text] = M.toNotes(s.marks, base);
    expect(M.markOfAnnotation(arrow!)).toEqual({
      id: 'a',
      timeMs: 3000,
      kind: 'arrow',
      color: 'red',
      width: 4,
      x: 0.1,
      y: 0.1,
      w: 0,
      h: 0,
      to: { x: 0.5, y: 0.5 },
    });
    expect(M.markOfAnnotation(text!)).toMatchObject({ kind: 'text', text: '字太小', color: 'red', width: 4 });
    const { style: _style, ...bare } = arrow!;
    expect(M.markOfAnnotation(bare)).toMatchObject({ color: 'blue', width: 2 });
    expect(M.markAnchor({ kind: 'box', x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3 });
    expect(
      M.markAnchor({
        kind: 'pen',
        x: 0.1,
        y: 0.1,
        points: [
          { x: 0.4, y: 0.5 },
          { x: 0.6, y: 0.7 },
        ],
      }),
    ).toEqual({ x: 0.4, y: 0.5 });
  });
});

describe('截图模式（Web，lite-editor §4.1、§8）', () => {
  it('只看宿主平台：Web 是截图模式，别的添加到对话；截图模式没有评论，换不过去', () => {
    expect(M.markupMode('web')).toBe('screenshot');
    expect(M.markupMode('darwin')).toBe('agent');
    expect(M.markupTools('agent')).toEqual(M.MARKUP_TOOLS);
    expect(M.markupTools('screenshot')).toEqual(['element', 'pen', 'shape', 'text']);
    const shot = M.init({ mode: 'screenshot' });
    expect(M.setTool(shot, 'element').tool).toBe('element');
    expect(M.setTool(shot, 'comment')).toBe(shot);
    expect(M.setTool(shot, 'text').tool).toBe('text');
    expect(M.setTool(M.init(), 'comment').tool).toBe('comment');
  });

  it('当前帧上的标记：±500 ms 之内算这一帧', () => {
    let s = M.add(M.init(), { timeMs: 3000, id: 'a', kind: 'box', x: 0, y: 0, w: 0.5, h: 0.5 });
    s = M.add(s, { timeMs: 3400, id: 'b', kind: 'pin', x: 0.2, y: 0.2, w: 0, h: 0 });
    s = M.add(s, { timeMs: 9000, id: 'c', kind: 'pin', x: 0.2, y: 0.2, w: 0, h: 0 });
    expect(M.marksOnFrame(s.marks, 3200).map((m) => m.id)).toEqual(['a', 'b']);
    expect(M.marksOnFrame(s.marks, 3600).map((m) => m.id)).toEqual(['b']);
    expect(M.isOnFrame(s.marks[2]!, 8500)).toBe(true);
    expect(M.isOnFrame(s.marks[2]!, 8499)).toBe(false);
  });

  it('下载的文件名：视频名去掉不能用的字符，接播放头的分、秒、毫秒；满一小时带小时', () => {
    expect(M.screenshotFileName('倒着开的跑车', 12_400)).toBe('倒着开的跑车-00m12s400.png');
    expect(M.screenshotFileName('a/b: c?', 0)).toBe('a_b_ c_-00m00s000.png');
    expect(M.screenshotFileName('', 3_723_005)).toBe('video-1h02m03s005.png');
  });
});

describe('标记帧的书签与时间线印章（lite-editor §4.1）', () => {
  const at = (id: string, timeMs: number, kind: M.Mark['kind'] = 'box', text?: string): M.Mark => ({
    id,
    timeMs,
    kind,
    x: 0.1,
    y: 0.1,
    w: 0.1,
    h: 0.1,
    color: 'red',
    width: 4,
    ...(text === undefined ? {} : { text }),
  });

  it('按帧数标记：±0.5 s 内的几刻算同一帧（从最早的那一刻量起），没写字的文字不算', () => {
    const marks = [at('c', 12_000), at('a', 3_000), at('b', 3_400), at('d', 3_900), at('e', 20_000, 'text', ' ')];
    expect(M.markedFrames(marks)).toEqual([
      { timeMs: 3_000, count: 2 },
      { timeMs: 3_900, count: 1 },
      { timeMs: 12_000, count: 1 },
    ]);
    expect(M.markedFrames([])).toEqual([]);
  });

  it('印章挤在一起时合成一枚：离这一枚的第一帧不到最小间距就并进来', () => {
    const frames = [
      { timeMs: 10_000, count: 1 },
      { timeMs: 11_000, count: 2 },
      { timeMs: 12_500, count: 1 },
      { timeMs: 60_000, count: 1 },
    ];
    // 整片 100 s、整条 1000 px：1 s = 10 px
    const stamps = M.bookmarkStamps(frames, 100_000, 1000, 20);
    expect(stamps.map((s) => [s.timeMs, s.at, s.frames.length])).toEqual([
      [10_000, 0.1, 2],
      [12_500, 0.125, 1],
      [60_000, 0.6, 1],
    ]);
    // 条够宽时一帧一枚；整片时长不明时不画
    expect(M.bookmarkStamps(frames, 100_000, 10_000, 20)).toHaveLength(4);
    expect(M.bookmarkStamps(frames, 0, 1000, 20)).toEqual([]);
    // 超出片尾的落在末端
    expect(M.bookmarkStamps([{ timeMs: 120_000, count: 1 }], 100_000, 1000, 20)[0]!.at).toBe(1);
  });

  it('点印章：不在它的帧上去第一帧，在其中一帧上去下一帧，到头回第一帧；播放头在哪一枚书签上', () => {
    const stamp = {
      frames: [
        { timeMs: 10_000, count: 1 },
        { timeMs: 11_000, count: 1 },
        { timeMs: 12_000, count: 1 },
      ],
    };
    expect(M.stampTarget(stamp, 0)).toBe(10_000);
    expect(M.stampTarget(stamp, 10_200)).toBe(11_000);
    expect(M.stampTarget(stamp, 11_000)).toBe(12_000);
    expect(M.stampTarget(stamp, 12_000)).toBe(10_000);
    expect(M.currentFrame(stamp.frames, 11_400)).toEqual({ timeMs: 11_000, count: 1 });
    expect(M.currentFrame(stamp.frames, 30_000)).toBeNull();
  });
});

describe('文字的样子与副工具条（lite-editor §4.1）', () => {
  it('新写的文字带工具条的当前样子；改样子时选中的是文字就连它一起改（进历史），别的种类不带', () => {
    let s = M.setTextStyle(M.init(), { italic: true, size: 36, font: 'serif' });
    expect(s.textStyle).toEqual({ bold: true, italic: true, underline: false, size: 36, font: 'serif' });
    s = M.add(s, { timeMs: 0, id: 't', kind: 'text', x: 0.1, y: 0.1, w: 0, h: 0, text: '字' });
    s = M.add(s, { timeMs: 0, id: 'b', kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(s.marks[1]).not.toHaveProperty('size');
    s = M.select(s, 't');
    s = M.setTextStyle(s, { underline: true, bold: false });
    expect(M.textStyleOf(s.marks[0]!)).toEqual({ bold: false, italic: true, underline: true, size: 36, font: 'serif' });
    expect(M.textStyleOf(M.undo(s).marks[0]!).underline).toBe(false);
    s = M.select(s, 'b');
    const box = s.marks[1];
    s = M.setTextStyle(s, { size: 48 });
    expect(s.marks[1]).toBe(box);
    expect(s.textStyle.size).toBe(48);
  });

  it('没带样子的文字（旧标记、别的客户端的标注）字号按粗细档的旧对应，别的取默认', () => {
    expect(M.textStyleOf({ width: 8 })).toEqual({ ...M.MARKUP_TEXT_STYLE, size: 28 });
    expect(M.textStyleOf({ width: 2, italic: true })).toEqual({ ...M.MARKUP_TEXT_STYLE, size: 16, italic: true });
    expect(M.textStyleOf({ width: 12, size: 20 }).size).toBe(20);
  });

  it('文字的样子随标注的 style 出去、画回来；别的种类的 style 只有颜色与粗细', () => {
    let s = M.setTextStyle(M.init(), { underline: true, font: 'mono' });
    s = M.add(s, { timeMs: 0, id: 't', kind: 'text', x: 0.1, y: 0.1, w: 0, h: 0, text: '字' });
    s = M.add(s, { timeMs: 0, id: 'p', kind: 'pin', x: 0.3, y: 0.3, w: 0, h: 0 });
    const [text, pin] = M.toNotes(s.marks, { videoId: 'v', video: { conversationId: 'c', path: 'p' }, revision: '1' });
    expect(text!.style).toEqual({ color: 'red', width: 4, bold: true, italic: false, underline: true, size: 20, font: 'mono' });
    expect(pin!.style).toEqual({ color: 'red', width: 4 });
    expect(M.textStyleOf(M.markOfAnnotation(text!))).toEqual({ bold: true, italic: false, underline: true, size: 20, font: 'mono' });
    expect(M.markOfAnnotation({ ...text!, style: { color: 'blue', width: 8 } })).not.toHaveProperty('size');
  });

  it('文字与评论没有粗细', () => {
    expect(M.MARKUP_TOOLS.filter(M.hasWidth)).toEqual(['element', 'pen', 'shape']);
  });
});
