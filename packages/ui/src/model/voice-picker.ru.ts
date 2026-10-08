import type { VoicePickerMessages } from './voice-picker.ts';

export const ru: VoicePickerMessages = {
  clonedOn: (provider) => `Клонировано через ${provider} · синтез с этим клоном`,
  defaultVoice: "Голос по умолчанию",
  providerPreset: (provider, name) => `${provider} — ${name}`,
  loadingMine: "Загрузка моих голосов…",
  cloneNew: "Клонировать новый голос…",
  cloneNewHint: "Запишите голос или импортируйте файл в Настройки › Модели › Синтез речи › Мои голоса",
  myVoices: "Мои голоса",
  providerVoices: (provider) => `${provider} — голоса`,
  customVoice: "Введите ID голоса…",
  customVoiceHint: "ID голоса из вашего аккаунта поставщика",
  tempReference: "Использовать запись один раз…",
  tempReferenceHint: "API синтеза этой версии ещё не принимает разовую эталонную запись · сначала сохраните её в «Мои голоса» и клонируйте",
  other: "Другое",
  voiceDeleted: "Этот голос удалён · выберите другой или вернитесь к голосу по умолчанию",
  customLine: "Передаётся поставщику без изменений для проверки; можно также создать клон в «Мои голоса» и выбрать его",
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} — голос` : `${provider} — голос · ${voiceId}`),
  defaultLine: (provider, name) => `Если не выбрать, используется голос ${provider} по умолчанию (${name})`,
  noDefault: "У этой модели нет голоса по умолчанию; сначала выберите голос",
};
