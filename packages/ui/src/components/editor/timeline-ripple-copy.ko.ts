import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const ko: TimelineRippleMessages = {
  removeSpan: '모든 트랙에서 이 구간 삭제',
  removeSpanHint: '뒤의 내용이 앞으로 당겨지고 전체 길이가 줄어듭니다',
  removeSpanCaptions: '자막은 영상 전체에 걸쳐 있습니다 · 클립을 선택하세요',
  labelRemoveSpan: '모든 트랙에서 구간 삭제',
  closed: (deleted: string, seconds: number) => `${deleted} · 비어 있던 ${secondsLabel(seconds)}을(를) 메웠습니다`,
  gapKept: (deleted: string) => `${deleted} · 뒤에 잠긴 트랙이나 클립이 있어 빈 곳을 메우지 않았습니다`,
  removed: (seconds: number) => `모든 트랙에서 ${secondsLabel(seconds)}을(를) 삭제했습니다 · 뒤의 내용을 앞으로 당겼습니다`,
  pickSpan: '먼저 타임라인에서 클립을 선택한 뒤 모든 트랙에서 삭제하세요',
  locked: '이 구간 뒤에 잠긴 트랙이나 클립이 있습니다 · 먼저 잠금을 해제하세요',
};
