import type { VideoBarMessages } from './video-bar-copy.ts';

export const ru: VideoBarMessages = {
  closeToSpace: "Закрыть видео · вернуться в Space",
  untitled: "Видео",
  rename: "Переименовать видео",
  details: "Сведения о видео",
  actions: "Действия с видео",
  showInSpace: "Показать в Space",
  revealVideoFolder: "Показать папку видео",
  close: "Закрыть видео",
  nameLabel: "Название",
  save: "Сохранить",
  openFailed: "Не удалось открыть",
  stale: "Не синхронизировано · пока нельзя редактировать",
  openingAria: "Открытие",
  opening: "Открытие…",
  savingAria: "Сохранение",
  saving: "Сохранение…",
  agentChanged: (label: string) => `Агент изменил видео: ${label}`,
  savedByAgent: (label: string) => `Сохранено · агент: ${label}`,
  saved: "Сохранено",
};
