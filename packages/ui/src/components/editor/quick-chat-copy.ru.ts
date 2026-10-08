import type { QuickChatMessages } from './quick-chat-copy.ts';

export const ru: QuickChatMessages = {
  label: "Сессия этого видео",
  open: "Открыть сессию этого видео",
  fresh: "Новая сессия",
  expand: "Развернуть сессию слева",
  minimize: "Свернуть",
  about: (name: string) => `О видео «${name}»`,
  placeholder: "Что вы хотите сделать с этим видео? Введите / для инструментов",
  hint: "Агент работает с ним прямо здесь",
  failed: (message: string) => `Не удалось отправить: ${message}`,
  untitled: "Видео",
  send: "Отправить",
};
