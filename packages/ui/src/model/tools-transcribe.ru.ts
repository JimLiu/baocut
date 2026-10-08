import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const ru: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Не установлен",
  notConnected: "Не подключено",
  noCloud: "Пока нет онлайн-сервиса распознавания речи",
  cloudLine: (connected, provider) => `${connected ? "Подключено" : "Не подключено"} · ${provider} · расшифровка онлайн`,
  noLocal: "На этом компьютере пока нет модели распознавания речи",
  localReady: "Установлено · распознавание на этом компьютере",
  localMissing: "Модель ещё не установлена",
};
