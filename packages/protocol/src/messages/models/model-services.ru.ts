import type { ModelsModelServicesMessages } from './model-services.ts';

export const ru: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Нет такого поставщика: ${p.provider}`,
  noConfigureNeeded: "Этот компьютер и узлы не требуют настройки; переключатель и ключ есть только у онлайн-поставщиков",
  cannotRemove: "Удалять можно только онлайн-поставщиков сервисов; этот компьютер, узлы и поставщики агентов не удаляются",
  noAccounts: "Аккаунты есть только у онлайн-поставщиков сервисов; у этого компьютера, узлов и поставщиков агентов их нет",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} не имеет параметров возможностей`,
  noRefresh: "Обновляемый список моделей есть только у онлайн-поставщиков",
  clearWithModel: "Не указывайте модель при сбросе значения по умолчанию",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} не предоставляет эту возможность: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} не имеет модели для выбора; укажите modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} не имеет такой модели: ${p.model}`,
  providerNodeConflict: "provider и node указывают на разных поставщиков",
  modelBundleMismatch: "model и bundleId не совпадают",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} не поддерживает расшифровку. Выберите другой сервис.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} нельзя использовать для этой возможности. Выберите другой сервис.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} нельзя использовать для генерации текста. Выберите другой сервис.`,
};
