import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const ja: TimelineRippleMessages = {
  removeSpan: 'すべてのトラックからこの区間を削除',
  removeSpanHint: '後ろの内容が前に詰まり、全体が短くなります',
  removeSpanCaptions: '字幕は動画全体にわたります · クリップを選択してください',
  labelRemoveSpan: 'すべてのトラックから区間を削除',
  closed: (deleted: string, seconds: number) => `${deleted} · 空いた ${secondsLabel(seconds)} を詰めました`,
  gapKept: (deleted: string) => `${deleted} · 後ろにロックされたトラックかクリップがあるため、隙間は詰めていません`,
  removed: (seconds: number) => `すべてのトラックから ${secondsLabel(seconds)} を削除しました · 後ろの内容を前に詰めました`,
  pickSpan: '先にタイムラインでクリップを選択してから、すべてのトラックから削除してください',
  locked: 'この区間の後ろにロックされたトラックかクリップがあります · 先にロックを解除してください',
};
