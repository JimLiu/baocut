import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, VIDEO_ANNOTATION_LIMITS } from '@baocut/protocol';
import {
  addVideoAnnotation,
  annotationTimecode,
  candidateBounds,
  normalizeShape,
  placeOf,
  removeVideoAnnotation,
  sentVideoAnnotations,
  videoAnnotationErrorText,
  videoAnnotationLabel,
  videoAnnotationPins,
  videoAnnotationsElsewhere,
  type DraftVideoAnnotation,
} from './video-annotations.ts';

const video = { conversationId: 'c1', path: 'videos/demo' };
const note = (over: Partial<DraftVideoAnnotation> = {}): DraftVideoAnnotation => ({
  id: 'n1',
  videoId: 'v1',
  video,
  revision: '3',
  timeMs: 42_300,
  kind: 'box',
  region: { x: 0.7, y: 0.1, w: 0.2, h: 0.1 },
  label: '',
  text: '这里的字幕太小',
  ...over,
});

// 测试进程钉在简体中文（vitest.config 的 BAOCUT_LOCALE）；看英文时换掉环境变量，跑完换回来。
const initial = getLocale();
afterEach(() => {
  vi.unstubAllEnvs();
  setLocale(initial);
});

describe('video-annotations', () => {
  it('手势换成归一化区域：夹在画面内，框取两点围成的矩形，箭头记终点，文字与编号只记一个点', () => {
    const frame = { w: 200, h: 100 };
    expect(normalizeShape('box', { x: 150, y: 80 }, { x: 50, y: -10 }, frame)).toEqual({ region: { x: 0.25, y: 0, w: 0.5, h: 0.8 } });
    expect(normalizeShape('arrow', { x: 20, y: 10 }, { x: 300, y: 50 }, frame)).toEqual({
      region: { x: 0.1, y: 0.1, w: 0, h: 0 },
      to: { x: 1, y: 0.5 },
    });
    expect(normalizeShape('pin', { x: 100, y: 50 }, null, frame)).toEqual({ region: { x: 0.5, y: 0.5, w: 0, h: 0 } });
    expect(normalizeShape('text', { x: 1, y: 1 }, { x: 99, y: 99 }, { w: 3, h: 3 }).region).toEqual({ x: 0.333, y: 0.333, w: 0, h: 0 });
  });

  it('九宫位置按中心点', () => {
    expect(placeOf({ x: 0.7, y: 0.1, w: 0.2, h: 0.1 })).toBe('topRight');
    expect(placeOf({ x: 0.5, y: 0.5, w: 0, h: 0 })).toBe('center');
    expect(placeOf({ x: 0.1, y: 0.5, w: 0, h: 0 })).toBe('left');
    expect(placeOf({ x: 0.5, y: 0.9, w: 0, h: 0 })).toBe('bottom');
  });

  it('时码与标签跟界面语言', () => {
    expect(annotationTimecode(42_300)).toBe('00:42.3');
    expect(annotationTimecode(59_960)).toBe('01:00.0');
    expect(annotationTimecode(3_723_400)).toBe('1:02:03.4');
    expect(videoAnnotationLabel(note())).toBe('00:42.3 · 框 · 画面右上');
    expect(videoAnnotationErrorText('too-many')).toBe(`一条消息最多带 ${VIDEO_ANNOTATION_LIMITS.perMessage} 条视频标注，先把这些发出去`);
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(videoAnnotationLabel(note())).toBe('00:42.3 · Box · top right of the frame');
  });

  it('加一条：批注去掉首尾空白，补上标签；空的、超长的、超过条数的、没拖开的箭头与框不收', () => {
    const one = addVideoAnnotation([], note({ text: '  小一点 \n' }));
    expect(one.error).toBeNull();
    expect(one.list[0]!.text).toBe('小一点');
    expect(one.list[0]!.label).toBe('00:42.3 · 框 · 画面右上');
    expect(addVideoAnnotation([], note({ label: '已有' })).list[0]!.label).toBe('已有');
    expect(addVideoAnnotation([], note({ text: '  ' })).error).toBe('empty');
    expect(addVideoAnnotation([], note({ text: 'x'.repeat(VIDEO_ANNOTATION_LIMITS.text + 1) })).error).toBe('too-long');
    expect(addVideoAnnotation([], note({ kind: 'arrow', region: { x: 0.1, y: 0.1, w: 0, h: 0 } })).error).toBe('no-arrow-end');
    expect(addVideoAnnotation([], note({ region: { x: 0.1, y: 0.1, w: 0.2, h: 0 } })).error).toBe('no-area');
    const full = Array.from({ length: VIDEO_ANNOTATION_LIMITS.perMessage }, (_, i) => note({ id: `n${i}` }));
    const over = addVideoAnnotation(full, note({ id: 'extra' }));
    expect(over.error).toBe('too-many');
    expect(over.list).toBe(full);
  });

  it('删一条；没有这条时原样返回', () => {
    const list = [note(), note({ id: 'n2' })];
    expect(removeVideoAnnotation(list, 'missing')).toBe(list);
    expect(removeVideoAnnotation(list, 'n1').map((n) => n.id)).toEqual(['n2']);
  });

  it('画面上的标记只画这部视频播放头 ±500ms 的，编号是整份草稿里的序号；其余的计数', () => {
    const list = [
      note({ id: 'a', timeMs: 1_000 }),
      note({ id: 'b', timeMs: 42_300 }),
      note({ id: 'c', videoId: 'v2', timeMs: 42_300 }),
      note({ id: 'd', timeMs: 42_800 }),
    ];
    expect(videoAnnotationPins(list, 'v1', 42.3).map((p) => [p.id, p.n])).toEqual([
      ['b', 2],
      ['d', 4],
    ]);
    expect(videoAnnotationsElsewhere(list, 'v1', 42.3)).toBe(1);
    expect(videoAnnotationPins(list, 'v1', 42.9).map((p) => p.id)).toEqual(['d']);
  });

  it('候选区间：同一视频两条以上才有', () => {
    expect(candidateBounds([note()], 'v1')).toBeNull();
    expect(candidateBounds([note({ timeMs: 9_000 }), note({ timeMs: 2_000 }), note({ videoId: 'v2', timeMs: 0 })], 'v1')).toEqual({
      fromMs: 2_000,
      toMs: 9_000,
    });
  });

  it('随消息交出去的那一份去掉界面里的 id 与视频 id', () => {
    const arrow = note({ kind: 'arrow', region: { x: 0.1, y: 0.2, w: 0, h: 0 }, to: { x: 0.5, y: 0.6 }, label: 'L' });
    expect(sentVideoAnnotations([arrow])).toEqual([
      {
        video,
        revision: '3',
        timeMs: 42_300,
        kind: 'arrow',
        region: { x: 0.1, y: 0.2, w: 0, h: 0 },
        to: { x: 0.5, y: 0.6 },
        label: 'L',
        text: '这里的字幕太小',
      },
    ]);
    expect(Object.keys(sentVideoAnnotations([note()])[0]!)).not.toContain('to');
  });

  it('截图随消息交出去：画的标记只在那一帧截到图时写 shot 与附件 id，评论的落点总带着', () => {
    const box = note({ shot: { timeMs: 42_300 } });
    const comment = note({
      id: 'n2',
      kind: 'comment',
      region: { x: 0.4, y: 0.3, w: 0, h: 0 },
      shot: { timeMs: 42_300, stamp: { x: 0.4, y: 0.3 } },
    });
    const attachmentOf = (n: DraftVideoAnnotation) => (n.id === 'n1' ? 'att_1' : undefined);
    const [sentBox, sentComment] = sentVideoAnnotations([box, comment], attachmentOf);
    expect(sentBox!.shot).toEqual({ timeMs: 42_300, attachment: 'att_1' });
    expect(sentComment!.shot).toEqual({ timeMs: 42_300, stamp: { x: 0.4, y: 0.3 } });
    // 没截到图：画的标记不写 shot（协议里 shot 表示「这一帧有截图」）
    expect(Object.keys(sentVideoAnnotations([box])[0]!)).not.toContain('shot');
  });
});

describe('轻量视图标记工具送来的视频标注（docs/design/lite-editor §4）', () => {
  const style = { color: 'red', width: 4 } as const;
  const segment = { id: 's03', kind: 'scene', index: 2, title: '倒着为什么不掉' };
  const line = { id: 's03:l2', index: 2, text: '那一个有点危险的做法' };
  const caption = { kind: 'caption', id: 's01:l3', text: '它没有掉下来也没有慢下来，一直贴着天花板往前走到了尽头' } as const;

  it('手势：圆与框同一块矩形，直线与箭头记两端，画笔记点列与外接框，元素与评论只记一个点', () => {
    const frame = { w: 200, h: 100 };
    expect(normalizeShape('ellipse', { x: 150, y: 80 }, { x: 50, y: -10 }, frame)).toEqual({ region: { x: 0.25, y: 0, w: 0.5, h: 0.8 } });
    expect(normalizeShape('line', { x: 20, y: 10 }, { x: 300, y: 50 }, frame)).toEqual({
      region: { x: 0.1, y: 0.1, w: 0, h: 0 },
      to: { x: 1, y: 0.5 },
    });
    const pts = [
      { x: 20, y: 10 },
      { x: 100, y: 60 },
      { x: 60, y: 200 },
    ];
    expect(normalizeShape('pen', pts[0]!, null, frame, pts)).toEqual({
      region: { x: 0.1, y: 0.1, w: 0.4, h: 0.9 },
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.6 },
        { x: 0.3, y: 1 },
      ],
    });
    expect(normalizeShape('pen', { x: 20, y: 10 }, null, frame)).toEqual({
      region: { x: 0.1, y: 0.1, w: 0, h: 0 },
      points: [{ x: 0.1, y: 0.1 }],
    });
    expect(normalizeShape('comment', { x: 100, y: 50 }, { x: 150, y: 80 }, frame)).toEqual({ region: { x: 0.5, y: 0.5, w: 0, h: 0 } });
    expect(normalizeShape('element', { x: 100, y: 50 }, null, frame)).toEqual({ region: { x: 0.5, y: 0.5, w: 0, h: 0 } });
  });

  it('标签：点中元素时用元素的说法代替种类与位置；带落点时接段与第几句；跟界面语言', () => {
    const at = { timeMs: 12_400, region: { x: 0.16, y: 0.84, w: 0.68, h: 0.05 } };
    expect(videoAnnotationLabel({ ...at, kind: 'box', segment, line })).toBe('00:12.4 · 框 · 画面下方 · s03 · 第 2 句');
    expect(videoAnnotationLabel({ ...at, kind: 'ellipse', segment })).toBe('00:12.4 · 圆 · 画面下方 · s03');
    expect(videoAnnotationLabel({ ...at, kind: 'element', element: caption, segment, line })).toBe(
      '00:12.4 · 字幕 · “它没有掉下来也没有慢下来，一直贴着天花板往前走…” · s03 · 第 2 句',
    );
    expect(videoAnnotationLabel({ ...at, kind: 'comment', element: { kind: 'element', id: 'logo' } })).toBe('00:12.4 · 元素 · logo');
    expect(videoAnnotationLabel({ ...at, kind: 'comment', region: { x: 0.5, y: 0.5, w: 0, h: 0 } })).toBe('00:12.4 · 评论 · 画面中央');
    const html = { kind: 'html', selector: 'button#play.bc-icon-button', w: 32, h: 32, name: '播放', role: 'button' } as const;
    expect(videoAnnotationLabel({ ...at, kind: 'element', element: html })).toBe('00:12.4 · button#play.bc-icon-button · 32 × 32');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(videoAnnotationLabel({ ...at, kind: 'pen', segment, line })).toBe('00:12.4 · Pen · bottom of the frame · s03 · line 2');
    expect(videoAnnotationLabel({ ...at, kind: 'element', element: { kind: 'caption', id: 'c1' } })).toBe('00:12.4 · Caption');
  });

  it('加一条：带样式的标记可以不写批注，文字与评论总得写；直线要终点、圆要面积、画笔要两个点、元素要元素', () => {
    const mark = (over: Partial<DraftVideoAnnotation>) => note({ text: '', style, ...over });
    expect(addVideoAnnotation([], mark({})).error).toBeNull();
    expect(addVideoAnnotation([], mark({ style: undefined })).error).toBe('empty');
    expect(addVideoAnnotation([], mark({ kind: 'text', region: { x: 0.1, y: 0.1, w: 0, h: 0 } })).error).toBe('empty');
    const shot = { timeMs: 42_300, stamp: { x: 0.4, y: 0.3 } };
    expect(addVideoAnnotation([], mark({ kind: 'comment', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, shot })).error).toBe('empty');
    expect(
      addVideoAnnotation([], mark({ kind: 'comment', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, shot, text: '慢一点' })).error,
    ).toBeNull();
    expect(addVideoAnnotation([], mark({ kind: 'line', region: { x: 0.1, y: 0.1, w: 0, h: 0 } })).error).toBe('no-line-end');
    expect(addVideoAnnotation([], mark({ kind: 'ellipse', region: { x: 0.1, y: 0.1, w: 0, h: 0.2 } })).error).toBe('no-area');
    expect(addVideoAnnotation([], mark({ kind: 'pen', points: [{ x: 0.1, y: 0.1 }] })).error).toBe('no-path');
    expect(addVideoAnnotation([], mark({ kind: 'element' })).error).toBe('no-element');
    const added = addVideoAnnotation([], mark({ kind: 'element', element: caption, segment, line })).list[0]!;
    expect(added.label).toBe('00:42.3 · 字幕 · “它没有掉下来也没有慢下来，一直贴着天花板往前走…” · s03 · 第 2 句');
    expect(videoAnnotationErrorText('no-path')).toBe('画笔要画出一道线');
  });

  it('随消息交出去的那一份带上标记的字段，只去掉 id 与视频 id', () => {
    const shot = { timeMs: 42_300, stamp: { x: 0.4, y: 0.3 } };
    const comment = note({
      kind: 'comment',
      region: { x: 0.4, y: 0.3, w: 0, h: 0 },
      style,
      element: caption,
      shot,
      segment,
      line,
      label: 'L',
    });
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.2 },
    ];
    const pen = note({ kind: 'pen', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, points, style, label: 'P', text: '' });
    const [sentComment, sentPen] = sentVideoAnnotations([comment, pen]);
    expect(sentComment).toEqual({
      video,
      revision: '3',
      timeMs: 42_300,
      kind: 'comment',
      region: { x: 0.4, y: 0.3, w: 0, h: 0 },
      style,
      element: caption,
      shot,
      segment,
      line,
      label: 'L',
      text: '这里的字幕太小',
    });
    expect(sentPen).toEqual({ video, revision: '3', timeMs: 42_300, kind: 'pen', region: pen.region, points, style, label: 'P', text: '' });
    expect(sentPen!.points).not.toBe(points);
  });
});
