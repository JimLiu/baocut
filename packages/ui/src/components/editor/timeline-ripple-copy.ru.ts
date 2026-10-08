import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const ru: TimelineRippleMessages = {
  removeSpan: 'Удалить этот отрезок со всех дорожек',
  removeSpanHint: 'Всё, что дальше, сдвинется вперёд · общая длина сократится',
  removeSpanCaptions: 'Субтитры занимают всё видео · Выберите клип',
  labelRemoveSpan: 'Удалить отрезок со всех дорожек',
  closed: (deleted: string, seconds: number) => `${deleted} · Промежуток ${secondsLabel(seconds)} закрыт`,
  gapKept: (deleted: string) => `${deleted} · Промежуток остался: дальше есть заблокированная дорожка или клип`,
  removed: (seconds: number) => `Удалено ${secondsLabel(seconds)} со всех дорожек · Всё, что дальше, сдвинуто вперёд`,
  pickSpan: 'Сначала выберите клип на таймлайне, затем удалите его отрезок со всех дорожек',
  locked: 'После этого отрезка есть заблокированная дорожка или клип · Сначала разблокируйте',
};
