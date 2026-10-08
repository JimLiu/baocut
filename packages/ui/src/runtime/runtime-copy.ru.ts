import type { RuntimeMessages } from './runtime-copy.ts';

export const ru: RuntimeMessages = {
  missingContext: "Отсутствует RuntimeContext",
  mediaStatus: (status) => `Медиасервис вернул ${status}`,
  noRootSequence: "У нового видео нет основной последовательности",
  edit: {
    importAssets: "Импортировать материалы",
    setBackground: "Задать фон",
    addWaveform: "Добавить звуковую волну",
  },
  waveformName: "Звуковая волна",
  noDuration: "У видео ещё нет длительности, поэтому звуковая волна не добавлена",
  noOpenVideo: "Ни одно видео не открыто",
  notCaughtUp: "Видео ещё не синхронизировано, сейчас его нельзя изменить",
};
