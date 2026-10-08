import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const ja: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: 'ファイルの文字起こしは使用できません',
  notCompleted: '文字起こしが完了しませんでした。動画ファイルは残してあります',
  resultMissing: '文字起こしの結果が見つかりません',
  tooManySameName: (p: { name: string }) => `保存先フォルダに同じ名前のファイルが多すぎます：${p.name}`,
};
