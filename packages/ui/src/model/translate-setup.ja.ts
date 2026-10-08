import type { TranslateSetupMessages } from './translate-setup.ts';

export const ja: TranslateSetupMessages = {
  sameAsSource: '原文と同じ言語',
  alreadyTranslated: 'この言語の翻訳はすでにあります',
  glossaryGone: '用語集ライブラリにありません · 今回は使用しません',
  reading: '読み取り中…',
  unreadable: '読み取れませんでした · 今回は使用しません',
  anyLanguage: 'すべての言語',
  wrongDirection: (source: string, target: string) => `方向：${source} → ${target} · 今回は使用しません`,
};
