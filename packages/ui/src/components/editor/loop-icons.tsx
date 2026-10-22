import { createIcon } from '@react-spectrum/s2';
import type { LiteLoopMode } from '../../model/lite-segments.ts';

/**
 * 审片走带循环键的三枚图标（原型 editor-lite.jsx 的 `LOOP_PATHS`，路径逐字一致）：S2 没有「重复」图标，按 20×20 网格、1.5 笔宽、
 * 只吃 currentColor 自绘。整片是首尾相接的两枚箭头，当前段在中间加一个「1」，不循环加一道斜杠。
 */
const BASE = ['M4 9V8a3 3 0 0 1 3-3h8.5', 'M13.5 2.5 16 5l-2.5 2.5', 'M16 11v1a3 3 0 0 1-3 3H4.5', 'M7 17.5 4.5 15 7 12.5'];
const EXTRA: Record<LiteLoopMode, string[]> = {
  whole: [],
  segment: ['M8.8 8.8 10.4 7.6v4.8'],
  off: ['M3 3l14 14'],
};

function loopIcon(mode: LiteLoopMode) {
  return createIcon((props) => (
    <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {[...BASE, ...EXTRA[mode]].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  ));
}

export const LOOP_ICONS = {
  whole: loopIcon('whole'),
  segment: loopIcon('segment'),
  off: loopIcon('off'),
} satisfies Record<LiteLoopMode, unknown>;
