import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const ko: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) =>
    `자막 파일 크기가 ${p.bytes}바이트로 한도인 ${p.limit}바이트를 넘습니다`,
  tooManyCues: (p: { limit: number }) => `자막이 ${p.limit}개를 넘습니다`,
  invalidAt: (p: { line: number; problem: string }) => `자막 파일 ${p.line}번째 줄: ${p.problem}`,
  nul: '파일에 NUL 문자가 있어 텍스트 자막으로 보이지 않습니다',
  vttHeader: 'WebVTT 파일은 WEBVTT로 시작해야 합니다',
  vttHeaderBlank: 'WEBVTT 헤더 뒤에 빈 줄을 하나 둔 다음 자막을 시작하세요',
  empty: '파일에 자막이 없습니다',
  noTiming: '이 블록에 텍스트는 있지만 타이밍 줄이 없습니다',
  tooManyIdLines: '타이밍 줄 앞에는 번호나 식별자 줄이 하나만 올 수 있습니다',
  srtIndex: (p: { id: string }) => `SRT 번호 줄은 숫자여야 합니다: ${p.id}`,
  badTiming: (p: { timing: string }) => `타이밍 줄 형식이 잘못되었습니다: ${p.timing}`,
  endBeforeStart: '종료 시간이 시작 시간보다 앞입니다',
  timingInText: '자막 텍스트에 타이밍 줄이 있습니다(두 자막 사이에 빈 줄이 빠졌을 수 있음)',
  cueTooLong: (p: { max: number }) => `${p.max}자를 넘는 자막 텍스트가 있습니다`,
  minuteSecondRange: '분이나 초가 59를 넘습니다',
};
