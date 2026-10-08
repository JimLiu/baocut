import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const vi: TimelineRippleMessages = {
  removeSpan: 'Xóa đoạn này khỏi mọi rãnh',
  removeSpanHint: 'Nội dung phía sau dồn lên · tổng thời lượng ngắn lại',
  removeSpanCaptions: 'Phụ đề trải dài cả video · Hãy chọn một clip',
  labelRemoveSpan: 'Xóa đoạn khỏi mọi rãnh',
  closed: (deleted: string, seconds: number) => `${deleted} · Đã khép khoảng trống ${secondsLabel(seconds)}`,
  gapKept: (deleted: string) => `${deleted} · Giữ khoảng trống: phía sau có rãnh hoặc clip bị khóa`,
  removed: (seconds: number) => `Đã xóa ${secondsLabel(seconds)} khỏi mọi rãnh · Nội dung phía sau đã dồn lên`,
  pickSpan: 'Hãy chọn một clip trên dòng thời gian trước, rồi xóa đoạn của nó khỏi mọi rãnh',
  locked: 'Phía sau đoạn này có rãnh hoặc clip bị khóa · Hãy mở khóa trước',
};
