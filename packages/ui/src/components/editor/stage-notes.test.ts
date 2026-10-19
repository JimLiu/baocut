// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DraftVideoAnnotation } from '../../model/video-annotations.ts';
import { useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { StageNotesLayer } from './stage-notes.tsx';

/** 画面上的标注层（产品设计 §5.3；轻量视图标记工具送来的五种见 docs/design/lite-editor §4.1）：按种类画标记，带 `style` 的照它的颜色与粗细。 */

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
  it('没有 style 的标记照旧画：箭头带头，框是 2px 描边', () => {
    const arrow = render([note({ kind: 'arrow', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.5, y: 0.5 }, text: '挪到这里' })]);
    expect(arrow).toContain('<line');
    expect(arrow).toContain('stroke-width="2"');
    expect(arrow.match(/aria-hidden="true"/g)?.length).toBe(2);
    const box = render([note({ text: '这块' })]);
    expect(box).not.toContain('border-width');
  });

  it('直线不带头、画笔是穿过各点的折线、圆与元素是框；粗细照 style', () => {
    const style = { color: 'red', width: 8 } as const;
    const line = render([note({ kind: 'line', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.5, y: 0.5 }, style })]);
    expect(line).toContain('<line');
    expect(line).toContain('stroke-width="8"');
    expect(line.match(/aria-hidden="true"/g)?.length).toBe(1);
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.2 },
    ];
    const pen = render([note({ kind: 'pen', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, points, style })]);
    expect(pen).toContain('<polyline points="10,10 30,20"');
    const ellipse = render([note({ kind: 'ellipse', style })]);
    expect(ellipse).toContain('border-width: 8px');
    const element = render([note({ kind: 'element', element: { kind: 'caption', id: 's01:l3' }, style })]);
    expect(element).toContain('border-width: 8px');
    // 颜色按 tone 换类名：红色的圆与蓝色（默认）的框不同
    expect(ellipse).not.toBe(render([note({ kind: 'ellipse', style: { color: 'blue', width: 8 } })]));
  });

  it('评论是一枚印章，读屏名在没有批注时退回标签', () => {
    const shot = { timeMs: 0, stamp: { x: 0.4, y: 0.3 } };
    const comment = render([note({ kind: 'comment', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, shot, text: '慢一点' })]);
    expect(comment).toContain('慢一点');
    const pin = render([note({ kind: 'pin', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, style: { color: 'green', width: 2 } })]);
    expect(pin).toContain('第 1 条批注：L');
    expect(comment).not.toBe(render([note({ kind: 'pin', region: { x: 0.4, y: 0.3, w: 0, h: 0 }, text: '慢一点' })]));
  });
});
