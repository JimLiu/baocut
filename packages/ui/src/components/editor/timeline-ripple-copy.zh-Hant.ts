import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const zhHant: TimelineRippleMessages = {
  removeSpan: '從所有軌道刪除這一段',
  removeSpanHint: '後面的內容前移 · 總長變短',
  removeSpanCaptions: '字幕鋪滿整部影片 · 請選取一個片段',
  labelRemoveSpan: '從所有軌道刪除一段',
  closed: (deleted: string, seconds: number) => `${deleted} · 空出的 ${secondsLabel(seconds)}已合攏`,
  gapKept: (deleted: string) => `${deleted} · 後面有鎖定的軌道或片段，空隙沒有合攏`,
  removed: (seconds: number) => `已從所有軌道刪除 ${secondsLabel(seconds)} · 後面的內容已前移`,
  pickSpan: '請先在時間軸上選取一個片段，再從所有軌道刪除',
  locked: '這一段後面有鎖定的軌道或片段 · 請先解除鎖定再刪除',
};
