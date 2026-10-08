import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const zhHans: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: '文件转录不可用',
  notCompleted: '转录未完成，视频文件已保留',
  resultMissing: '找不到转录结果',
  tooManySameName: (p: { name: string }) => `输出目录里同名的文件太多：${p.name}`,
};
