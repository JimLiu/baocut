import type { JobsMediaProbeMessages } from './media-probe.ts';

export const ko: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `알 수 없는 미디어 형식 ${p.mediaType}`,
  unreadable: '결과물 파일을 읽지 못했습니다',
  headerMismatch: (p: { sniffed: string; mediaType: string }) =>
    `파일 헤더는 ${p.sniffed}이지만 선언된 형식은 ${p.mediaType}입니다`,
  unrecognizedFormat: '알 수 없는 형식',
  notJson: 'ffprobe 출력이 JSON이 아닙니다',
  noAudioStream: '오디오 스트림 없음',
  noImage: '이미지 없음',
  noFrames: '프레임을 하나도 디코딩하지 못했습니다',
  durationNotPositive: '길이가 양수가 아닙니다',
  sampleRateNotPositive: '샘플 레이트가 양수가 아닙니다',
  channelsNotPositive: '채널 수가 양수가 아닙니다',
  sizeNotPositive: '너비나 높이가 양수가 아닙니다',
  cannotRun: (p: { reason: string }) => `ffprobe를 실행하지 못했습니다: ${p.reason}`,
  killedBy: (p: { signal: string }) => `${p.signal} 시그널로 종료됨`,
  exitCode: (p: { code: string }) => `종료 코드 ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe 디코딩 실패(${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe 디코딩 실패(${p.reason}): ${p.output}`,
  noProbe: 'ffprobe를 사용할 수 없어 결과물을 검사할 수 없습니다',
};
