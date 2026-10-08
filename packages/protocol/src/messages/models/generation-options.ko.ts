import type { ModelsGenerationOptionsMessages } from './generation-options.ts';

export const ko: ModelsGenerationOptionsMessages = {
  notLocalOnly: (p: { modelId: string; key: string }) => `${p.modelId} 모델은 ${p.key} 옵션을 받지 않습니다(로컬 모델만 받음)`,
  textEmpty: '텍스트는 비워 둘 수 없습니다',
  textTooLong: (p: { length: number; modelId: string; limit: number }) =>
    `텍스트가 ${p.length}자로 ${p.modelId} 모델의 호출당 한도인 ${p.limit}자를 넘습니다. 나누어 제출하세요.`,
  noDefaultVoice: (p: { modelId: string }) => `${p.modelId} 모델에는 기본 목소리가 없습니다. voice를 지정하세요`,
  noSuchVoice: (p: { modelId: string; voice: string }) => `${p.modelId} 모델에는 ${p.voice} 목소리가 없습니다`,
  badLanguageTag: (p: { tag: string }) => `올바른 BCP 47 언어 태그가 아닙니다: ${p.tag}`,
  languageUnsupported: (p: { modelId: string; language: string }) => `${p.modelId} 모델은 ${p.language} 언어를 지원하지 않습니다`,
  formatUnsupported: (p: { modelId: string; format: string }) => `${p.modelId} 모델은 ${p.format} 형식으로 출력하지 않습니다`,
  noInstructions: (p: { modelId: string }) => `${p.modelId} 모델은 어조 지시(instructions)를 받지 않습니다`,
  noSpeed: (p: { modelId: string }) => `${p.modelId} 모델은 말하기 속도(speed)를 받지 않습니다`,
  speedRange: (p: { min: number; max: number }) => `말하기 속도는 ${p.min}~${p.max} 사이여야 합니다`,
  knobUnsupported: (p: { modelId: string; key: string }) => `${p.modelId} 모델은 ${p.key} 옵션을 받지 않습니다`,
  knobRange: (p: { key: string; min: number; max: number }) => `${p.key} 값은 ${p.min}~${p.max} 사이여야 합니다`,
  promptEmpty: '프롬프트는 비워 둘 수 없습니다',
  promptTooLong: (p: { length: number; modelId: string; limit: number }) =>
    `프롬프트가 ${p.length}자로 ${p.modelId} 모델의 한도인 ${p.limit}자를 넘습니다`,
  aspectUnsupported: (p: { modelId: string; ratio: string }) => `${p.modelId} 모델은 ${p.ratio} 화면비를 지원하지 않습니다`,
  sizeUnsupported: (p: { modelId: string; size: string }) => `${p.modelId} 모델은 ${p.size} 크기를 지원하지 않습니다`,
  maxCount: (p: { modelId: string; max: number }) => `${p.modelId} 모델은 한 번에 이미지를 최대 ${p.max}개까지 생성합니다`,
  noSteps: (p: { modelId: string }) => `${p.modelId} 모델은 steps를 받지 않습니다(로컬 모델만 받음)`,
  stepsRange: (p: { min: number; max: number }) => `steps는 ${p.min}~${p.max} 사이의 정수여야 합니다`,
  noSeed: (p: { modelId: string }) => `${p.modelId} 모델은 seed를 받지 않습니다`,
};
