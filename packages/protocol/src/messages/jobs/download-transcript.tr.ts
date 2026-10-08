import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const tr: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: 'Dosya yazıya dökmeü kullanılamıyor',
  notCompleted: 'Yazıya dökme tamamlanmadı; video dosyası korundu',
  resultMissing: 'Yazıya dökme sonucu bulunamıyor',
  tooManySameName: (p: { name: string }) => `Çıktı klasöründe aynı adlı çok fazla dosya var: ${p.name}`,
};
