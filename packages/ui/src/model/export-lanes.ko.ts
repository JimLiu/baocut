import type { ExportLanesMessages } from './export-lanes.ts';

export const ko: ExportLanesMessages = {
  hidden: '타임라인에서 숨김',
  otherSolo: '다른 트랙이 솔로로 설정됨',
  muted: '타임라인에서 음소거됨',
  otherSoloAudio: '다른 트랙이 솔로로 설정됨',
  subtitles: '자막',
  names: (names: readonly string[]) => names.join(', '),
  sound: (reason: string) => `소리: ${reason}`,
  clips: (n: number) => `클립 ${n}개`,
  sounds: (n: number) => `오디오 클립 ${n}개`,
};
