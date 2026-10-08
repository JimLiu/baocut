import type { TranslateSetupMessages } from './translate-setup.ts';

export const ko: TranslateSetupMessages = {
  sameAsSource: '원문과 같은 언어',
  alreadyTranslated: '이 언어의 번역이 이미 있음',
  glossaryGone: '더 이상 용어집 라이브러리에 없음 · 이번에는 사용 안 함',
  reading: '읽는 중…',
  unreadable: '읽지 못함 · 이번에는 사용 안 함',
  anyLanguage: '모든 언어',
  wrongDirection: (source: string, target: string) => `방향: ${source} → ${target} · 이번에는 사용 안 함`,
};
