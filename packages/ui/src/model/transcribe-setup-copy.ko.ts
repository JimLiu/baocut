import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const ko: TranscribeSetupMessages = {
  notConnected: '연결 안 됨',
  unavailable: '사용할 수 없음',
  autoDetect: '자동 감지',
  hintNoModel: '어떤 음성 모델을 쓸지 아직 알 수 없습니다. 위에서 하나를 선택하면 인식 힌트를 받는지 확인할 수 있습니다.',
  hintUnsupported: (model: string, alt: string | null) =>
    `${model} 모델은 인식 힌트를 받지 않으므로 이 단계에서는 용어집과 프롬프트를 사용할 수 없으며 전사할 때 건너뜁니다.${alt ? ` 전사할 때 사용하려면 ${alt} 모델로 바꾸세요.` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `프롬프트 ${b.custom}자` : '프롬프트 없음';
    const dropped = b.dropped ? ` · ${b.dropped}개는 들어가지 않음, 먼저 나열된 용어집이 먼저 들어감` : '';
    return `${model} 모델에 전송: ${custom} + 용어 ${b.terms}개 · 약 ${b.chars} / ${max}자${dropped}`;
  },
  glossaryGone: '더 이상 용어집 라이브러리에 없음 · 이번에는 사용 안 함',
  glossaryTranslation: '번역용 용어집이라 전사에는 사용하지 않음 · 이번에는 사용 안 함',
  anyLanguage: '모든 언어',
  termCount: (count: number) => `용어 ${count}개`,
  noDefaultModel: '아직 기본 음성 모델이 없습니다',
  defaultModel: (label: string) => `${label}(기본값)`,
  autoDetectLanguage: '언어 자동 감지',
  glossaries: (count: number) => `용어집 ${count}개`,
  hasPrompt: '프롬프트 포함',
  noDefaultFacts: '아직 기본 음성 모델이 없습니다. 하나를 선택하거나 모델 페이지에서 기본값을 설정하세요. 선택하지 않고 시작하면 무엇이 빠졌는지 알려 드립니다.',
  modelUnusable: '이 모델은 지금 사용할 수 없습니다',
  acceptsHint: '인식 힌트 지원',
  noHint: '인식 힌트 미지원',
  followDefault: (facts: string) => `기본값 사용 · ${facts}`,
};
