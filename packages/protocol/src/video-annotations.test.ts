import { describe, expect, it } from 'vitest';
import { methodParamSchemas } from './schemas.ts';
import { groupVideoAnnotationsByFrame, VIDEO_ANNOTATION_LIMITS, videoAnnotationFrameMs } from './video.ts';

describe('conversations.send / steer 带的视频标注（产品设计 §3.2.3「视频标注」）', () => {
  const base = { conversationId: 'c', text: 'hi', commandId: 'k' };
  const box = {
    video: { projectId: 'p', path: 'talk' },
    revision: '3',
    timeMs: 10000,
    kind: 'box',
    region: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 },
    label: '00:10.0 · 框 · 画面正中',
    text: '这块字幕挡住了脸',
  };
  const arrow = { ...box, kind: 'arrow', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.6, y: 0.5 } };
  const pin = { ...box, kind: 'pin', region: { x: 0.8, y: 0.2, w: 0, h: 0 } };
  const text = { ...pin, kind: 'text' };

  it('send 与 steer 都收四种标注，三种 video 写法都认，可以与另外三种标注同时带', () => {
    const system = { system: { conversationId: 'c', path: 'ds' }, anchor: 'a', label: 'l', text: 'x' };
    for (const method of ['conversations.send', 'conversations.steer'] as const) {
      const schema = methodParamSchemas[method];
      expect(schema.safeParse({ ...base, videoAnnotations: [box, arrow, pin, text] }).success).toBe(true);
      expect(schema.safeParse({ ...base, videoAnnotations: [{ ...box, video: { entryId: 'e1' } }] }).success).toBe(true);
      expect(schema.safeParse({ ...base, videoAnnotations: [{ ...box, video: { conversationId: 'c', path: 'talk' } }] }).success).toBe(
        true,
      );
      expect(schema.safeParse({ ...base, designSystemAnnotations: [system], videoAnnotations: [pin] }).success).toBe(true);
    }
  });

  it('每条消息至多 20 条，单条批注至多 2000 字', () => {
    const send = methodParamSchemas['conversations.send'];
    const many = Array.from({ length: VIDEO_ANNOTATION_LIMITS.perMessage + 1 }, () => pin);
    expect(send.safeParse({ ...base, videoAnnotations: many }).success).toBe(false);
    expect(send.safeParse({ ...base, videoAnnotations: many.slice(1) }).success).toBe(true);
    const long = (n: number) => [{ ...pin, text: 'x'.repeat(n) }];
    expect(send.safeParse({ ...base, videoAnnotations: long(VIDEO_ANNOTATION_LIMITS.text + 1) }).success).toBe(false);
    expect(send.safeParse({ ...base, videoAnnotations: long(VIDEO_ANNOTATION_LIMITS.text) }).success).toBe(true);
  });

  it('按种类核对形状：框要面积、点没有面积、箭头必有终点、别的种类没有终点；坐标 0–1、时刻非负整数、版本是数字串、不收别的字段', () => {
    const send = methodParamSchemas['conversations.send'];
    for (const bad of [
      { ...box, region: { x: 0.1, y: 0.1, w: 0, h: 0.2 } },
      { ...box, region: { x: 0.1, y: 0.1, w: 0.2, h: 0 } },
      { ...box, to: { x: 0.5, y: 0.5 } },
      { ...arrow, to: undefined },
      { ...arrow, region: { x: 0.1, y: 0.1, w: 0.1, h: 0 } },
      { ...pin, region: { x: 0.8, y: 0.2, w: 0.1, h: 0.1 } },
      { ...pin, to: { x: 0.5, y: 0.5 } },
      { ...text, region: { x: 0.8, y: 0.2, w: 0, h: 0.1 } },
      { ...pin, region: { x: 1.2, y: 0.2, w: 0, h: 0 } },
      { ...pin, region: { x: -0.1, y: 0.2, w: 0, h: 0 } },
      { ...arrow, to: { x: 0.5, y: 1.5 } },
      { ...pin, timeMs: -1 },
      { ...pin, timeMs: 1.5 },
      { ...pin, revision: 3 },
      { ...pin, revision: 'r3' },
      { ...pin, kind: 'circle' },
      { ...text, text: '   ' },
      { ...pin, id: 'n1' },
      { ...pin, anchor: 'x' },
      { ...pin, region: { x: 0.8, y: 0.2, w: 0, h: 0, z: 0 } },
      { ...pin, video: { path: 'talk' } },
      { ...pin, label: 'l'.repeat(1001) },
    ]) {
      expect(send.safeParse({ ...base, videoAnnotations: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('轻量视图标记工具送来的视频标注（docs/design/lite-editor §4）', () => {
  const base = { conversationId: 'c', text: 'hi', commandId: 'k' };
  const send = methodParamSchemas['conversations.send'];
  const common = { video: { projectId: 'p', path: 'talk' }, revision: '12', timeMs: 12400, label: '00:12.4 · 框 · 画面正中', text: '' };
  const style = { color: 'red', width: 4 } as const;
  const segment = { id: 's01', kind: 'scene', index: 0, title: '钩子' };
  const line = { id: 's01:l3', index: 3, text: '它没有掉下来也没有慢下来' };
  const box = { ...common, kind: 'box', region: { x: 0.42, y: 0.36, w: 0.18, h: 0.22 }, style, segment, line };
  const ellipse = { ...box, kind: 'ellipse' };
  const lineMark = { ...common, kind: 'line', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.6, y: 0.5 }, style };
  const points = [
    { x: 0.1, y: 0.2 },
    { x: 0.4, y: 0.2 },
  ];
  const pen = { ...common, kind: 'pen', region: { x: 0.1, y: 0.2, w: 0.3, h: 0 }, points, style };
  const caption = { kind: 'caption', id: 's01:l3', text: '它没有掉下来也没有慢下来', detail: 'caption s01:l3 "它没有掉下来也没有慢下来"' };
  const html = { kind: 'html', selector: 'button#play.bc-icon-button', w: 32, h: 32, name: '播放', role: 'button', focusable: true };
  const blue = { color: 'blue', width: 4 } as const;
  const element = { ...common, kind: 'element', region: { x: 0.16, y: 0.84, w: 0.68, h: 0.05 }, element: caption, style: blue };
  const shot = { timeMs: 12400, stamp: { x: 0.4, y: 0.3 } };
  const comment = {
    ...common,
    kind: 'comment',
    region: { x: 0.4, y: 0.3, w: 0, h: 0 },
    element: html,
    shot,
    text: '这里慢一点',
    style: blue,
    segment,
  };
  const text = { ...common, kind: 'text', region: { x: 0.6, y: 0.3, w: 0, h: 0 }, text: '字太小', style };
  const pin = { ...common, kind: 'pin', region: { x: 0.8, y: 0.2, w: 0, h: 0 }, style };

  it('九种都收；画的标记可以不写批注，带颜色粗细、元素、截图与落点', () => {
    const layer = { ...element, element: { kind: 'element', id: 'logo' } };
    expect(send.safeParse({ ...base, videoAnnotations: [box, ellipse, lineMark, pen, element, comment, text, pin, layer] }).success).toBe(
      true,
    );
    expect(send.safeParse({ ...base, videoAnnotations: [{ ...comment, element: undefined }] }).success).toBe(true);
    expect(send.safeParse({ ...base, videoAnnotations: [{ ...element, region: { x: 0.1, y: 0.1, w: 0, h: 0 } }] }).success).toBe(true);
    expect(send.safeParse({ ...base, videoAnnotations: [{ ...box, style: undefined, text: '  ' }] }).success).toBe(true);
    // 画的标记也带那一帧的截图（没有印章位置）；评论的截图必须带印章位置
    expect(
      send.safeParse({
        ...base,
        videoAnnotations: [
          { ...box, shot: { timeMs: 70000 } },
          { ...pen, shot: { timeMs: 0 } },
          { ...box, shot: { timeMs: 70000, attachment: 'att_1' } },
          { ...comment, shot: { ...shot, attachment: 'att_1' } },
        ],
      }).success,
    ).toBe(true);
    for (const color of ['red', 'blue', 'green', 'black', 'white'])
      for (const width of [2, 4, 8, 12])
        expect(send.safeParse({ ...base, videoAnnotations: [{ ...box, style: { color, width } }] }).success).toBe(true);
  });

  it('按种类核对新字段：画笔要点列、直线要终点、元素要元素、评论要截图与批注；文字与评论不能空，样式只认五色四档，不收别的字段', () => {
    for (const bad of [
      { ...text, text: '' },
      { ...comment, text: '' },
      { ...comment, text: '  ' },
      { ...pen, points: undefined },
      { ...pen, points: [{ x: 0.1, y: 0.2 }] },
      { ...pen, points: [...points, { x: 1.1, y: 0.2 }] },
      { ...pen, points: Array.from({ length: 2001 }, () => ({ x: 0.1, y: 0.1 })) },
      { ...lineMark, to: undefined },
      { ...lineMark, region: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
      { ...ellipse, region: { x: 0.1, y: 0.1, w: 0, h: 0.2 } },
      { ...element, element: undefined },
      { ...element, element: { kind: 'layer', id: 'x' } },
      { ...element, element: { ...caption, label: '字幕' } },
      { ...element, element: { kind: 'html', selector: '' } },
      { ...comment, shot: undefined },
      { ...comment, region: { x: 0.4, y: 0.3, w: 0.1, h: 0.1 } },
      { ...comment, shot: { timeMs: 12400, stamp: { x: 1.4, y: 0.3 } } },
      { ...box, points },
      { ...box, shot: { timeMs: -1 } },
      { ...box, shot: { timeMs: 1, attachment: '' } },
      { ...box, shot: { timeMs: 1, attachment: 7 } },
      { ...comment, shot: { timeMs: 12400 } },
      { ...box, element: caption },
      { ...pin, to: { x: 0.5, y: 0.5 } },
      { ...box, style: { color: 'purple', width: 4 } },
      { ...box, style: { color: 'red', width: 3 } },
      { ...box, style: { color: 'red' } },
      { ...box, style: { ...style, opacity: 1 } },
      { ...box, segment: { ...segment, index: -1 } },
      { ...box, segment: { id: 's01', index: 0 } },
      { ...box, line: { ...line, index: 0 } },
      { ...box, line: { ...line, extra: 1 } },
      { ...box, detail: 'caption x' },
    ]) {
      expect(send.safeParse({ ...base, videoAnnotations: [bad] }).success, JSON.stringify(bad).slice(0, 200)).toBe(false);
    }
  });
});

describe('按帧归条（docs/design/lite-editor §4.1）', () => {
  it('一处标记属于截图那一帧，没有截图时是它的时刻；同一视频同一帧的并成一条，按第一次出现的先后编号', () => {
    expect(videoAnnotationFrameMs({ timeMs: 12_380, shot: { timeMs: 12_400 } })).toBe(12_400);
    expect(videoAnnotationFrameMs({ timeMs: 12_380 })).toBe(12_380);
    const notes = [
      { id: 'a', video: 'talk', timeMs: 12_400, shot: { timeMs: 12_400 } },
      { id: 'b', video: 'talk', timeMs: 30_000 },
      { id: 'c', video: 'other', timeMs: 12_400 },
      { id: 'd', video: 'talk', timeMs: 12_390, shot: { timeMs: 12_400 } },
    ];
    expect(groupVideoAnnotationsByFrame(notes, (n) => n.video).map((f) => [f.key, f.n, f.timeMs, f.items.map((n) => n.id)])).toEqual([
      ['talk@12400', 1, 12_400, ['a', 'd']],
      ['talk@30000', 2, 30_000, ['b']],
      ['other@12400', 3, 12_400, ['c']],
    ]);
  });
});
