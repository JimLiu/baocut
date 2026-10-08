import { pluralForm } from '@baocut/protocol';
import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const ru: TranscribeSetupMessages = {
  notConnected: "Не подключено",
  unavailable: "Недоступно",
  autoDetect: "Определить автоматически",
  hintNoModel: "Ещё неизвестно, какая речевая модель будет использована. Выберите выше, чтобы узнать, принимает ли она подсказки распознавания.",
  hintUnsupported: (model: string, alt: string | null) => `${model} не принимает подсказки распознавания, поэтому глоссарии и запрос не используются на этом шаге и будут пропущены при расшифровке.${alt ? ` Для использования при расшифровке выберите ${alt}.` : ""}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => { const custom = b.custom ? pluralForm('ru', b.custom, { one: `Запрос: ${b.custom} символ`, few: `Запрос: ${b.custom} символа`, many: `Запрос: ${b.custom} символов`, other: `Запрос: ${b.custom} символа` }) : "без запроса"; const dropped = b.dropped ? ` · Не поместилось: ${b.dropped}; глоссарии в начале списка включаются первыми` : ''; return `Отправлено в ${model}: ${custom} + ${pluralForm('ru', b.terms, { one: `${b.terms} термин`, few: `${b.terms} термина`, many: `${b.terms} терминов`, other: `${b.terms} термина` })} · примерная длина в символах: ${b.chars} / ${max}${dropped}`; },
  glossaryGone: "Больше нет в библиотеке глоссариев · сейчас не используется",
  glossaryTranslation: "Глоссарий перевода; не используется для расшифровки · сейчас не используется",
  anyLanguage: "Любой язык",
  termCount: (count: number) => pluralForm('ru', count, { one: `${count} термин`, few: `${count} термина`, many: `${count} терминов`, other: `${count} термина` }),
  noDefaultModel: "Речевая модель по умолчанию ещё не задана",
  defaultModel: (label: string) => `${label} (по умолчанию)`,
  autoDetectLanguage: "Определять язык автоматически",
  glossaries: (count: number) => pluralForm('ru', count, { one: `${count} глоссарий`, few: `${count} глоссария`, many: `${count} глоссариев`, other: `${count} глоссария` }),
  hasPrompt: "С запросом",
  noDefaultFacts: "Речевая модель по умолчанию ещё не задана. Выберите модель или задайте по умолчанию на странице «Модели». Если начать без выбора, появится сообщение о том, чего не хватает.",
  modelUnusable: "Эту модель сейчас нельзя использовать",
  acceptsHint: "Принимает подсказки распознавания",
  noHint: "Без подсказок распознавания",
  followDefault: (facts: string) => `По умолчанию · ${facts}`,
};
