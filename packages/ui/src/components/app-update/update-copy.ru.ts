import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: 'начать установку',
  check: 'проверить обновления',
  download: 'начать скачивание',
  cancel: 'отменить скачивание',
  retry: 'повторить попытку',
  downloadPage: 'открыть страницу скачивания',
};

export const ru: UpdateMessages = {
  failed: (step, message) => `Не удалось ${STEP[step]}: ${message}`,
  progress: 'Ход скачивания',
  notes: 'Что нового в этой версии',
  close: 'Закрыть',
};
