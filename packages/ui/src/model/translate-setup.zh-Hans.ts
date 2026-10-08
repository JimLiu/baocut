import type { TranslateSetupMessages } from './translate-setup.ts';

export const zhHans: TranslateSetupMessages = {
  sameAsSource: '和原文同一种语言',
  alreadyTranslated: '已经有这门语言的译文',
  glossaryGone: '已经不在术语表库里 · 这次不用',
  reading: '正在读取…',
  unreadable: '没读出来 · 这次不用',
  anyLanguage: '任意语言',
  wrongDirection: (source: string, target: string) => `方向是${source} → ${target} · 这次不用`,
};
