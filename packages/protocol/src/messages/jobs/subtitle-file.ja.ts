import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const ja: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `字幕ファイルは ${p.bytes} バイトで、上限の ${p.limit} バイトを超えています`,
  tooManyCues: (p: { limit: number }) => `字幕が ${p.limit} 件を超えています`,
  invalidAt: (p: { line: number; problem: string }) => `字幕ファイルの ${p.line} 行目：${p.problem}`,
  nul: 'ファイルに NUL 文字が含まれており、テキストの字幕ではないようです',
  vttHeader: 'WebVTT ファイルは WEBVTT で始まる必要があります',
  vttHeaderBlank: 'WEBVTT ヘッダの後に空行を 1 行入れてから字幕を書いてください',
  empty: 'ファイルに字幕がありません',
  noTiming: 'このブロックにはテキストがありますが、タイミング行がありません',
  tooManyIdLines: 'タイミング行の前に置けるのは、番号または識別子の行 1 行だけです',
  srtIndex: (p: { id: string }) => `SRT の番号行は数字である必要があります：${p.id}`,
  badTiming: (p: { timing: string }) => `タイミング行の形式が正しくありません：${p.timing}`,
  endBeforeStart: '終了時刻が開始時刻より前です',
  timingInText: '字幕のテキストにタイミング行があります（2 つの字幕の間に空行がない可能性があります）',
  cueTooLong: (p: { max: number }) => `${p.max} 文字を超える字幕テキストがあります`,
  minuteSecondRange: '分または秒が 59 を超えています',
};
