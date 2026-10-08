import type { ToolsTextMessages } from './tools-text.ts';

export const ko: ToolsTextMessages = {
  emptyInput: '먼저 생성할 내용을 입력하세요',
  tooLong: (max) => `한 번에 최대 ${max}자`,
  sample: '도시 산책 영상에 쓸 30초 분량의 내레이션 원고를 써 주세요. 자연스러운 어조로 거리, 카페, 해 질 녘의 풍경을 담아 주세요.',
  counter: (n, max) => `${n} / ${max}자`,
  connectTextModel: '먼저 텍스트 모델을 연결하세요',
  connectFirst: (provider) => `먼저 ${provider}에 연결하세요`,
  effortFixed: '추론 강도 · 이 모델은 조정할 수 없음',
  effort: (label) => `추론 강도 · ${label}(기본값은 모델 페이지에서 설정)`,
  auto: '자동',
  headerChip: (provider) => `온라인 · ${provider} · 토큰 과금`,
  fileStem: '생성된 텍스트',
  chars: (n) => `${n}자`,
  outputTokens: (n) => `출력 토큰 ${n}개`,
  truncated: '출력 한도에 도달해 나머지가 잘렸습니다',
};
