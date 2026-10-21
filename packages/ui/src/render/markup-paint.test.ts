import { describe, expect, it } from 'vitest';
import type { Mark } from '../model/markup.ts';
import { paintMarks } from './markup-paint.ts';

/** 标记截图的画法（lite-editor §4.1）：文字照它的样子画，元素框带一枚标签。 */

/** 记下画布 2D 的调用与画字时的字体。 */
function recorder() {
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1 };
  for (const name of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'closePath', 'arc', 'ellipse', 'roundRect'])
    ctx[name] = (...a: unknown[]) => calls.push([name, ...a]);
  for (const name of ['fillText', 'strokeText', 'fillRect', 'strokeRect'])
    ctx[name] = (...a: unknown[]) => calls.push([name, ctx.font, ...a]);
  ctx.measureText = (text: string) => ({ width: text.length * 10 });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const base = { id: 'm', timeMs: 0, color: 'red', width: 4, x: 0.1, y: 0.1, w: 0, h: 0 } as const;

describe('paintMarks', () => {
  it('文字照它的粗体 / 斜体 / 字号 / 字体画，按画布比画面放大；下划线补一道', () => {
    const { ctx, calls } = recorder();
    const text: Mark = { ...base, kind: 'text', text: 'Hi', bold: false, italic: true, underline: true, size: 28, font: 'serif' };
    paintMarks(ctx, [text], { w: 1280, h: 720 }, { w: 640, h: 360 }, 'Me');
    expect(calls.find((c) => c[0] === 'fillText')).toEqual(['fillText', 'italic normal 56px serif', 'Hi', 128, 72]);
    const under = calls.find((c) => c[0] === 'fillRect')!;
    expect(under.slice(2, 5)).toEqual([128, 72 + 56 * 0.95, 20]);
  });

  it('没带样子的旧文字：粗体无衬线，字号按粗细档', () => {
    const { ctx, calls } = recorder();
    paintMarks(ctx, [{ ...base, kind: 'text', text: 'Hi', width: 8 }], { w: 640, h: 360 }, { w: 640, h: 360 }, 'Me');
    expect(calls.find((c) => c[0] === 'fillText')![1]).toBe('bold 28px sans-serif');
    expect(calls.some((c) => c[0] === 'fillRect')).toBe(false);
  });

  it('元素框左上角带一枚写着元素是什么的标签，上面放不下时贴进框里', () => {
    const { ctx, calls } = recorder();
    const element: Mark = {
      ...base,
      kind: 'element',
      x: 0.25,
      y: 0.5,
      w: 0.2,
      h: 0.1,
      element: { kind: 'html', selector: 'h1.title', w: 300, h: 80 },
    };
    paintMarks(ctx, [element, { ...element, id: 'top', y: 0 }], { w: 640, h: 360 }, { w: 640, h: 360 }, 'Me');
    const labels = calls.filter((c) => c[0] === 'fillText');
    expect(labels.map((c) => c[2])).toEqual(['h1.title · 300 × 80', 'h1.title · 300 × 80']);
    const tags = calls.filter((c) => c[0] === 'roundRect' && c[4] === 20);
    // 第一个贴在框外上方（框顶 180、描边 4、牌高 20），第二个框顶在画布顶边，贴进框里
    expect(tags.map((c) => c[2])).toEqual([180 - 2 - 20, 0 + 2]);
  });
});
