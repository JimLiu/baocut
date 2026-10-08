import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const zhHans: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `字幕文件 ${p.bytes} 字节，超过上限 ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `字幕超过 ${p.limit} 条`,
  invalidAt: (p: { line: number; problem: string }) => `字幕文件第 ${p.line} 行：${p.problem}`,
  nul: '文件里有 NUL 字符，不像文本字幕',
  vttHeader: 'WebVTT 文件应以 WEBVTT 开头',
  vttHeaderBlank: 'WEBVTT 头部之后要空一行再写字幕',
  empty: '文件里没有字幕',
  noTiming: '这一块有文本却没有时间行',
  tooManyIdLines: '时间行之前只能有一行序号或标识',
  srtIndex: (p: { id: string }) => `SRT 的序号行应为数字：${p.id}`,
  badTiming: (p: { timing: string }) => `时间行写法不对：${p.timing}`,
  endBeforeStart: '结束时间早于开始时间',
  timingInText: '字幕文本里出现了时间行（两条之间可能少了空行）',
  cueTooLong: (p: { max: number }) => `一条字幕的文本超过 ${p.max} 字`,
  minuteSecondRange: '分或秒超过 59',
};
