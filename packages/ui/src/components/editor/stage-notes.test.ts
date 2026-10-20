// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DraftVideoAnnotation } from '../../model/video-annotations.ts';
import { useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { StageNotesLayer } from './stage-notes.tsx';

/**
 * 画面上的标注层（产品设计 §5.3）：已进草稿的标注按标记层同一套画法画（markup-marks.tsx，docs/design/lite-editor §4.1），
 * 带 `style` 的照它的颜色与粗细，每条多一枚写着序号的钮。画面 640 × 360，SVG 里的是像素坐标。
 */

const frame = { left: 0, top: 0, width: 640, height: 360 };
const note = (over: Partial<DraftVideoAnnotation>): DraftVideoAnnotation => ({
  id: 'n1',
  videoId: 'v1',
  video: { conversationId: 'c1', path: 'talk' },
  revision: '3',
  timeMs: 0,
  kind: 'box',
  region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  label: 'L',
  text: '',
  ...over,
});
let container: HTMLDivElement;
let root: Root;
const render = (notes: DraftVideoAnnotation[]) => {
  act(() => {
    useDraftVideoAnnotations.setState({ annotations: { v1: notes } });
    useEditor.setState({ playhead: 0, annotating: false });
    root.render(createElement(StageNotesLayer, { videoId: 'v1', frame }));
  });
  return container.innerHTML;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useDraftVideoAnnotations.setState({ annotations: {} });
});

describe('StageNotesLayer', () => {
  it('没有 style 的标注按蓝色 2px 画，画法与标记层同一套：箭头是带三角头的线，框是描边的矩形', () => {
    const arrow = render([note({ kind: 'arrow', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.5, y: 0.5 }, text: '挪到这里' })]);
    expect(arrow).toContain('<line x1="64" y1="36" x2="320" y2="180"');
    expect(arrow).toContain('stroke-width="2"');
    expect(arrow).toContain('<polygon');
    const box = render([note({ text: '这块' })]);
    expect(box).toContain('<rect x="64" y="36"');
    expect(box).toContain('stroke-width="2"');
    expect(box).toContain('data-mark="box"');
    // 颜色按 tone 换类名：没有 style 的（蓝）与红的不同
    expect(box).not.toBe(render([note({ text: '这块', style: { color: 'red', width: 2 } })]));
  });

  it('直线不带头、画笔是穿过各点的折线、圆是椭圆、元素是圆角框；粗细照 style', () => {
    const style = { color: 'red', width: 8 } as const;
    const line = render([note({ kind: 'line', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.5, y: 0.5 }, style })]);
    expect(line).toContain('<line x1="64" y1="36" x2="320" y2="180"');
    expect(line).toContain('stroke-width="8"');
    expect(line).not.toContain('<polygon');
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.2 },
    ];
    const pen = render([note({ kind: 'pen', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, points, style })]);
    expect(pen).toContain('<polyline points="64,36 192,72"');
    // 画笔的序号钮落在第一个点上
    expect(pen).toContain('left: 10%; top: 10%;');
    const ellipse = render([note({ kind: 'ellipse', style })]);
    expect(ellipse).toContain('<ellipse');
    expect(ellipse).toContain('stroke-width="8"');
    const element = render([note({ kind: 'element', element: { kind: 'caption', id: 's01:l3' }, style })]);
    expect(element).toContain('rx="4"');
  });

  it('每条带一枚写着草稿里序号的钮：编号就是那枚圆点，评论是印章，文字标记画出那行字；读屏名在没有批注时退回标签', () => {
    const shot = { timeMs: 0, stamp: { x: 0.4, y: 0.3 } };
    const comment = render([note({ kind: 'comment', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, shot, text: '慢一点' })]);
    expect(comment).toContain('第 1 条批注：慢一点');
    expect(comment).toContain('data-mark="comment"');
    expect(comment).toContain('>1</button>');
    const pin = render([note({ kind: 'pin', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, style: { color: 'green', width: 2 } })]);
    expect(pin).toContain('第 1 条批注：L');
    expect(pin).toContain('data-mark="pin"');
    // 印章与圆点的画法不同
    expect(comment).not.toBe(render([note({ kind: 'pin', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, text: '慢一点' })]));
    const text = render([
      note({ kind: 'text', region: { x: 0.6, y: 0.3, w: 0, h: 0 }, text: '字太小', style: { color: 'red', width: 4 } }),
    ]);
    expect(text).toContain('data-mark="text"');
    expect(text).toContain('font-size: 20px');
    expect(text).toContain('>字太小</span>');
  });
});
