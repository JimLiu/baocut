import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const zhHans: TimelineRippleMessages = {
  removeSpan: '从所有轨道删除这一段',
  removeSpanHint: '后面的内容前移 · 总长变短',
  removeSpanCaptions: '字幕铺满整部视频 · 请选中一个片段',
  labelRemoveSpan: '从所有轨道删除一段',
  closed: (deleted: string, seconds: number) => `${deleted} · 空出的 ${secondsLabel(seconds)}已合拢`,
  gapKept: (deleted: string) => `${deleted} · 后面有锁住的轨道或片段，空隙没有合拢`,
  removed: (seconds: number) => `已从所有轨道删除 ${secondsLabel(seconds)} · 后面的内容已前移`,
  pickSpan: '先在时间线上选中一个片段，再从所有轨道删除',
  locked: '这一段后面有锁住的轨道或片段 · 先解锁再删除',
};
