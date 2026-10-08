import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const zhHant: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: '無法使用檔案轉錄',
  notCompleted: '轉錄未完成，影片檔案已保留',
  resultMissing: '找不到轉錄結果',
  tooManySameName: (p: { name: string }) => `輸出資料夾中同名的檔案太多：${p.name}`,
};
