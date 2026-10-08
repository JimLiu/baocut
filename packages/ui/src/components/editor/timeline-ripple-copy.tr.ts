import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const tr: TimelineRippleMessages = {
  removeSpan: 'Bu bölümü tüm izlerden sil',
  removeSpanHint: 'Sonraki içerik öne kayar · toplam süre kısalır',
  removeSpanCaptions: 'Altyazılar tüm videoyu kaplar · Bir klip seçin',
  labelRemoveSpan: 'Bölümü tüm izlerden sil',
  closed: (deleted: string, seconds: number) => `${deleted} · ${secondsLabel(seconds)} boşluk kapatıldı`,
  gapKept: (deleted: string) => `${deleted} · Boşluk kaldı: sonrasında kilitli bir iz veya klip var`,
  removed: (seconds: number) => `Tüm izlerden ${secondsLabel(seconds)} silindi · Sonraki içerik öne kaydı`,
  pickSpan: 'Önce zaman çizelgesinde bir klip seçin, sonra bölümünü tüm izlerden silin',
  locked: 'Bu bölümden sonra kilitli bir iz veya klip var · Önce kilidini açın',
};
