import { createIcon } from '@react-spectrum/s2';
import type { LiteLoopMode } from '../../model/lite-segments.ts';

/**
 * 走带上 S2 没有对应原件的图标，按原型的描边几何自绘（20×20 网格、1.5 笔宽、圆端头、只吃 currentColor），放进按钮与菜单的
 * 图标槽时与 S2 原件一样对齐。路径与原型逐字一致（原型 `icon-sync.test.js` 核对）。
 */
function lineIcon(paths: readonly string[]) {
  return createIcon((props) => (
    <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  ));
}

/** 上一段 / 上一章、下一段 / 下一章：两枚三角加一条到底的竖杠（原型 icons.jsx 的 `prev` / `next`）。 */
export const PREV_PATHS = ['M17.4 4.9L10.9 10l6.5 5.1z', 'M10.2 4.9L3.7 10l6.5 5.1z', 'M2.6 4.9v10.2'];
export const NEXT_PATHS = ['M2.6 4.9L9.1 10l-6.5 5.1z', 'M9.8 4.9l6.5 5.1-6.5 5.1z', 'M17.4 4.9v10.2'];
export const PrevIcon = lineIcon(PREV_PATHS);
export const NextIcon = lineIcon(NEXT_PATHS);

/**
 * 审片走带循环键的三枚图标（原型 editor-lite.jsx 的 `LOOP_PATHS`）：整片是首尾相接的两枚箭头，当前段在中间加一个「1」，
 * 不循环加一道斜杠。
 */
const LOOP_BASE = ['M4 9V8a3 3 0 0 1 3-3h8.5', 'M13.5 2.5 16 5l-2.5 2.5', 'M16 11v1a3 3 0 0 1-3 3H4.5', 'M7 17.5 4.5 15 7 12.5'];
export const LOOP_PATHS: Record<LiteLoopMode, string[]> = {
  whole: LOOP_BASE,
  segment: [...LOOP_BASE, 'M8.8 8.8 10.4 7.6v4.8'],
  off: [...LOOP_BASE, 'M3 3l14 14'],
};
export const LOOP_ICONS = {
  whole: lineIcon(LOOP_PATHS.whole),
  segment: lineIcon(LOOP_PATHS.segment),
  off: lineIcon(LOOP_PATHS.off),
} satisfies Record<LiteLoopMode, unknown>;
