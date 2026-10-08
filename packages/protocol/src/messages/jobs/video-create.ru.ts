import type { JobsVideoCreateMessages } from './video-create.ts';

export const ru: JobsVideoCreateMessages = {
  videoClosed: 'Видео закрыто, ничего не импортировано: откройте видео и повторите попытку',
  noAsset: 'Импорт не вернул материал',
  notCompleted: (p: { state: string }) => `Расшифровка не завершена (${p.state})`,
};
