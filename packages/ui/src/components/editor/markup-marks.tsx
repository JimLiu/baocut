import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { Mark } from '../../model/markup.ts';

/*
 * 画面上一条标记的画法（lite-editor §4.1）：标记层（markup.tsx，还没发的一组）与标注层（stage-notes.tsx，已进草稿的）同一套，
 * 两种视图都是；截图上的画法（render/markup-paint.ts）照这里的几何。线、框、圆、画笔与元素框画在画面大小的 SVG 里（像素坐标），
 * 编号、文字与评论印章是 HTML（按画面的百分比定位）。颜色按 `tone`（协议的五色），粗细是描边像素。
 */

export const pct = (v: number) => `${v * 100}%`;
/** 画在 SVG 里的种类；别的（编号、文字、评论）是 HTML。 */
export const SVG_KINDS = new Set<Mark['kind']>(['pen', 'line', 'arrow', 'box', 'ellipse', 'element']);
/** 线条的点选范围：至少这么宽，描边再粗就随描边。 */
const HIT_MIN = 12;

/** 画面大小的 SVG：铺满画面，不裁边，自己不接指针（点选接在各条标记的透明宽描边上）。 */
export const drawing = style({ position: 'absolute', inset: 0, width: 'full', height: 'full', overflow: 'visible', pointerEvents: 'none' });
const ink = style({
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
});
const hitStroke = style({ cursor: 'move' });
/** 编号：一枚写着序号的圆点，以那个点为中心。标注层里它是看批注的钮（`isButton`：有悬停态与焦点环，不是拖动的光标）。 */
export const pinMark = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderWidth: 0,
  transform: 'translate(-50%, -50%)',
  backgroundColor: {
    default: 'red-900',
    tone: {
      red: { default: 'red-900', isHovered: 'red-1000', isPressed: 'red-1000' },
      blue: { default: 'blue-900', isHovered: 'blue-1000', isPressed: 'blue-1000' },
      green: { default: 'green-900', isHovered: 'green-1000', isPressed: 'green-1000' },
      black: { default: 'black', isHovered: 'gray-800', isPressed: 'gray-800' },
      white: { default: 'white', isHovered: 'gray-200', isPressed: 'gray-200' },
    },
  },
  font: 'ui-xs',
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  boxShadow: '[0 0 0 2px white]',
  fontWeight: 'bold',
  cursor: { default: 'move', isButton: 'default' },
  userSelect: 'none',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
/** 文字：一行粗体的字，左上角在那个点上，字号跟粗细档走（`MARKUP_TEXT_SIZE`），描一圈反色的影免得淹在画面里。 */
export const textMark = style({
  position: 'absolute',
  whiteSpace: 'pre',
  fontWeight: 'bold',
  lineHeight: '[1.2]',
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  textShadow: { default: '[0 0 3px rgb(255 255 255 / 0.9)]', tone: { white: '[0 0 3px rgb(0 0 0 / 0.9)]' } },
  cursor: 'move',
  userSelect: 'none',
});
/** 评论的印章：一枚带尖角的圆（像一个对话气泡），尖角落在那个点上；标记层里写评论人的缩写，标注层里是写着序号的钮（`isButton`）。 */
export const stampMark = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  height: 28,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderBottomStartRadius: 'none',
  borderWidth: 0,
  transform: 'translateY(-100%)',
  backgroundColor: {
    default: 'red-900',
    tone: {
      red: { default: 'red-900', isHovered: 'red-1000', isPressed: 'red-1000' },
      blue: { default: 'blue-900', isHovered: 'blue-1000', isPressed: 'blue-1000' },
      green: { default: 'green-900', isHovered: 'green-1000', isPressed: 'green-1000' },
      black: { default: 'black', isHovered: 'gray-800', isPressed: 'gray-800' },
      white: { default: 'white', isHovered: 'gray-200', isPressed: 'gray-200' },
    },
  },
  font: 'ui-xs',
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  boxShadow: '[0 0 0 2px white, 0 1px 4px rgb(0 0 0 / 0.4)]',
  fontWeight: 'bold',
  cursor: { default: 'move', isButton: 'default' },
  userSelect: 'none',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});

/** 一条线、框、圆、画笔或元素框：像素坐标画在画面大小的 SVG 里；`onGrab` 接在一条透明的宽描边上（框与圆只有边能点中）。 */
export function SvgMark({
  mark: m,
  frame,
  onGrab,
}: {
  mark: Mark;
  frame: { w: number; h: number };
  onGrab?: (event: ReactPointerEvent) => void;
}) {
  const X = (v: number) => v * frame.w;
  const Y = (v: number) => v * frame.h;
  const sw = m.width;
  const hit = Math.max(HIT_MIN, sw + 8);
  const grabProps = onGrab ? { className: hitStroke, pointerEvents: 'stroke' as const, onPointerDown: onGrab } : null;
  let shape: ReactElement | null = null;
  let hitShape: ReactElement | null = null;
  if (m.kind === 'pen' && m.points?.length) {
    const points = m.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
    shape = <polyline points={points} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
    hitShape = grabProps ? <polyline points={points} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else if ((m.kind === 'line' || m.kind === 'arrow') && m.to) {
    const x1 = X(m.x);
    const y1 = Y(m.y);
    const x2 = X(m.to.x);
    const y2 = Y(m.to.y);
    const headSize = sw * 3 + 6;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const tip = (a: number) => `${x2 - headSize * Math.cos(angle - a)},${y2 - headSize * Math.sin(angle - a)}`;
    shape = (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        {m.kind === 'arrow' ? (
          <polygon
            points={`${x2},${y2} ${tip(0.45)} ${tip(-0.45)}`}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : null}
      </>
    );
    hitShape = grabProps ? <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else if (m.kind === 'ellipse') {
    const props = { cx: X(m.x + m.w / 2), cy: Y(m.y + m.h / 2), rx: X(m.w) / 2, ry: Y(m.h) / 2 };
    shape = <ellipse {...props} fill="none" stroke="currentColor" strokeWidth={sw} />;
    hitShape = grabProps ? <ellipse {...props} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else {
    const props = { x: X(m.x), y: Y(m.y), width: X(m.w), height: Y(m.h) };
    shape = <rect {...props} rx={m.kind === 'element' ? 4 : 2} fill="none" stroke="currentColor" strokeWidth={sw} />;
    hitShape = grabProps ? <rect {...props} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  }
  return (
    <g className={ink({ tone: m.color })} data-mark={m.kind}>
      {shape}
      {hitShape}
    </g>
  );
}
