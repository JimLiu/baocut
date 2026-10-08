import type { ProvidersAgentMessages } from './providers-agent.ts';

export const ru: ProvidersAgentMessages = {
  codexUpgradeHint: "Обновите Codex CLI (например, npm install -g @openai/codex@latest), затем проверьте снова",
  codexImageModel: "Генерация изображений Codex (модель выбирают Codex и ваш аккаунт)",
  codexImageNotes:
    "Генерация через аккаунт Codex, в который выполнен вход на этом компьютере: по одному PNG и одной задаче за раз, обычно за одну-две минуты. Размер и сид задать нельзя (запросы с ними отклоняются), размер в пикселях зависит от результата. Используется квота вашей подписки; остаток неизвестен. Включение означает согласие на отправку запросов в ваш аккаунт Codex.",
  imagesOnly: (p) => `${p.label} может только генерировать изображения`,
  onePngOnly: (p) => `${p.label} генерирует по одному PNG и не принимает размер или сид`,
  unavailable: (p) => `${p.label} недоступен: ${p.message}`,
  sessionNotStarted: (p) => `${p.label} — сессия не запущена: ${p.error}`,
  timedOut: (p) => `${p.label} не завершил за ${p.minutes} мин и был прерван`,
  exited: (p) => `${p.label} неожиданно завершился: ${p.message}`,
  notCompleted: (p) => `${p.label} не завершил эту генерацию: ${p.reason}`,
  turnInterrupted: "итерация прервана",
  noImage: (p) => `${p.label} не создал изображение`,
  noImageReply: (p) => `${p.label} не создал изображение: ${p.reply}`,
  unknownError: "Неизвестная ошибка",
  processExited: "Процесс завершился",
  turnNotStarted: (p) => `Итерация не началась: ${p.error}`,
};
