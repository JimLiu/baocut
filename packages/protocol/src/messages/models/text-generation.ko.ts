import type { ModelsTextGenerationMessages } from './text-generation.ts';

export const ko: ModelsTextGenerationMessages = {
  noMessage: '비어 있지 않은 user 또는 assistant 메시지가 하나 이상 필요합니다',
  badRole: '메시지 역할은 system, user, assistant 중 하나여야 합니다',
  inputTooLong: (p: { chars: number; modelId: string; contextTokens: number }) =>
    `입력이 ${p.chars}자로 ${p.modelId} 모델의 컨텍스트(${p.contextTokens} 토큰)를 크게 넘습니다`,
  maxOutput: (p: { modelId: string; max: number }) => `${p.modelId} 모델은 호출당 최대 ${p.max} 토큰까지 출력합니다`,
  noTemperature: (p: { modelId: string }) => `${p.modelId} 모델은 temperature를 받지 않습니다`,
  temperatureRange: 'temperature는 0~2 사이여야 합니다',
  noSeed: (p: { modelId: string }) => `${p.modelId} 모델은 seed를 받지 않습니다`,
  noStructured: (p: { modelId: string }) => `${p.modelId} 모델은 구조화된 출력을 지원하지 않습니다`,
  effortIgnored: (p: { modelId: string; requested: string }) =>
    `${p.modelId} 모델은 추론 강도를 조정할 수 없어 ${p.requested} 설정을 무시했습니다`,
  effortChanged: (p: { modelId: string; requested: string; applied: string }) =>
    `${p.modelId} 모델에는 ${p.requested} 추론 강도가 없어 대신 ${p.applied} 강도를 사용했습니다`,
  contentFiltered: (p: { provider: string }) => `${p.provider}의 콘텐츠 필터가 이 출력을 차단했습니다`,
  truncatedJson: (p: { provider: string; max: number }) =>
    `${p.provider}의 출력이 한도(${p.max} 토큰)에 도달해 잘렸습니다. 구조화된 출력이 완전하지 않습니다`,
  truncatedProblem: (p: { max: number }) => `출력이 잘렸습니다(maxOutputTokens ${p.max})`,
  notJson: (p: { provider: string }) => `${p.provider}의 출력이 올바른 JSON이 아닙니다`,
  notJsonProblem: '올바른 JSON이 아닙니다',
  schemaMismatch: (p: { provider: string }) => `${p.provider}의 출력이 지정한 JSON Schema와 맞지 않습니다`,
  limitBeforeText: (p: { provider: string }) => `${p.provider}이(가) 텍스트를 쓰기 전에 출력 한도에 도달했습니다`,
  emptyOutput: (p: { provider: string }) => `${p.provider}이(가) 빈 출력을 반환했습니다`,
  limitBeforeTextProblem: (p: { max: number }) => `출력 한도(${p.max} 토큰)를 다 쓸 때까지 텍스트가 없었습니다`,
  emptyProblem: '출력이 비어 있습니다',
  cancelled: '호출이 취소되었습니다',
};
