import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const ru: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: 'Расшифровка файла недоступна',
  notCompleted: 'Расшифровка не завершена; видеофайл сохранён',
  resultMissing: 'Не удалось найти результат расшифровки',
  tooManySameName: (p: { name: string }) => `Слишком много файлов с одинаковым именем в папке результатов: ${p.name}`,
};
