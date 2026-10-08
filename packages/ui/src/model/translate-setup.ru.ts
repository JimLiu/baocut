import type { TranslateSetupMessages } from './translate-setup.ts';

export const ru: TranslateSetupMessages = {
  sameAsSource: "Тот же язык, что у оригинала",
  alreadyTranslated: "Перевод на этот язык уже есть",
  glossaryGone: "Больше нет в библиотеке глоссариев · сейчас не используется",
  reading: "Чтение…",
  unreadable: "Не удалось прочитать · сейчас не используется",
  anyLanguage: "Любой язык",
  wrongDirection: (source: string, target: string) => `Направление: ${source} → ${target} · сейчас не используется`,
};
