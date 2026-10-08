import { pluralForm } from '@baocut/protocol';
import type { ServicesApiMessages } from './services-api-copy.ts';

export const ru: ServicesApiMessages = {
  capabilities: {
    transcribe: "Расшифровать",
    synthesizeSpeech: "Синтез речи",
    generateImage: "Создание изображений",
    generateText: "Сгенерировать текст",
  },
  endpoints: {
    models: "Список моделей",
    model: "Получить модель",
    info: "Сведения о сервисе и версия интерфейса",
    transcriptions: "Распознать аудио",
    speech: "Синтез речи",
    images: "Создание изображений",
    chat: "Сгенерировать текст (чат)",
  },
  routing: {
    online: { label: "Онлайн-сервисы", desc: "Пересылать запросы подключённым облачным сервисам (возможна оплата; данные покидают этот компьютер)" },
    nodes: { label: "Узлы локальной сети", desc: "Пересылать запросы другим сопряжённым компьютерам" },
    agent: { label: "Агенты", desc: "Пересылать запросы средам агентов, вошедших на этом компьютере (например, Codex)" },
  },
  modelsAvailable: (n) => pluralForm('ru', n, { one: `Доступна ${n} модель`, few: `Доступны ${n} модели`, many: `Доступно ${n} моделей`, other: `Доступно ${n} модели` }),
  notRouted: "Модели доступны, но маршрутизация категории отключена; запросы пока получают 503",
  noModels: "Доступных моделей пока нет; запросы пока получают 503",
  defaultModel: "Модель по умолчанию",
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: "Поставщик не найден; запросы получают 404",
  aliasNotRouted: "Маршрутизация категории отключена; запросы получают 404",
  aliasProviderUnavailable: "Этот поставщик сейчас недоступен",
  aliasModelUnavailable: "Эта модель сейчас недоступна",
  targetNotRouted: "Маршрутизация отключена",
  targetUnavailable: "Сейчас недоступно",
  aliasNameEmpty: "Введите имя, например whisper-1",
  aliasNameSlash: "Имена не могут содержать «/»: <provider>/<model> — каноническая форма, псевдонимы не должны с ней совпадать",
  aliasNameChars: "Только буквы, цифры и . _ : -, начиная с буквы или цифры",
  aliasNameTaken: (name) => `«${name}» уже есть; для смены цели сначала удалите эту строку`,
};
