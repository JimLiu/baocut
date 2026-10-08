import type { TranslateSetupMessages } from './translate-setup.ts';

export const zhHant: TranslateSetupMessages = {
  sameAsSource: '與原文是同一種語言',
  alreadyTranslated: '已經有這個語言的譯文',
  glossaryGone: '已不在術語表資料庫中 · 這次不使用',
  reading: '正在讀取…',
  unreadable: '無法讀取 · 這次不使用',
  anyLanguage: '不限語言',
  wrongDirection: (source: string, target: string) => `方向為${source} → ${target} · 這次不使用`,
};
