import type { TranslateSetupMessages } from './translate-setup.ts';

export const tr: TranslateSetupMessages = {
  sameAsSource: 'Özgün metinle aynı dil',
  alreadyTranslated: 'Bu dilde çeviri zaten var',
  glossaryGone: 'Artık sözlük kitaplığında yok · bu sefer kullanılmaz',
  reading: 'Okunuyor…',
  unreadable: 'Okunamadı · bu sefer kullanılmaz',
  anyLanguage: 'Herhangi bir dil',
  wrongDirection: (source: string, target: string) => `Yön ${source} → ${target} · bu sefer kullanılmaz`,
};
