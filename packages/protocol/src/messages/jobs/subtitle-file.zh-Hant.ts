import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const zhHant: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `字幕檔案大小為 ${p.bytes} 位元組，超過上限 ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `字幕超過 ${p.limit} 條`,
  invalidAt: (p: { line: number; problem: string }) => `字幕檔案第 ${p.line} 行：${p.problem}`,
  nul: '檔案中含有 NUL 字元，看起來不像文字字幕',
  vttHeader: 'WebVTT 檔案必須以 WEBVTT 開頭',
  vttHeaderBlank: 'WEBVTT 標頭之後要先空一行再寫字幕',
  empty: '檔案中沒有字幕',
  noTiming: '這個區塊有文字，但沒有時間行',
  tooManyIdLines: '時間行之前只能有一行序號或識別碼',
  srtIndex: (p: { id: string }) => `SRT 的序號行必須是數字：${p.id}`,
  badTiming: (p: { timing: string }) => `時間行格式錯誤：${p.timing}`,
  endBeforeStart: '結束時間早於開始時間',
  timingInText: '字幕文字中出現了時間行（兩條字幕之間可能少了空行）',
  cueTooLong: (p: { max: number }) => `有一條字幕的文字超過 ${p.max} 字`,
  minuteSecondRange: '分或秒超過 59',
};
