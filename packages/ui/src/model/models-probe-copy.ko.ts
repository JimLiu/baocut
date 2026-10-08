import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const ko: ModelsProbeMessages = {
  speechText: '안녕하세요. BaoCut 음성 합성 테스트입니다.',
  noResult: '작업은 끝났지만 결과를 받지 못했습니다.',
  failed: '작업이 실패했습니다.',
  cancelled: '작업이 취소되었습니다.',
  interrupted: 'Runtime이 다시 시작되어 이번 테스트를 마치지 못했습니다.',
  unknownOutcome: 'Runtime이 다시 시작되기 전에 이 호출의 응답을 받지 못해 결과를 알 수 없습니다.',
  audioFacts: (seconds, khz, type) => `${seconds}초 · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds}초 · ${type}`,
  textFacts: (entries, seconds, type) => `항목 ${entries}개 · ${seconds}초 · ${type}`,
  packageFacts: (files, type) => `파일 ${files}개 · ${type}`,
  projectFacts: (clips, seconds, type) => `클립 ${clips}개 · ${seconds}초 · ${type}`,
  chars: (count) => `${count}자`,
  inputTokens: (count) => `입력 토큰 ${count}개`,
  outputTokens: (count) => `출력 토큰 ${count}개`,
  hitLimit: '출력 한도에 도달함',
  filtered: '공급자의 콘텐츠 필터에 차단됨',
  untested: '테스트 안 함',
  testing: '테스트 중…',
  passed: '테스트 통과',
  passedIn: (seconds) => `테스트 통과 · ${seconds}초`,
};
