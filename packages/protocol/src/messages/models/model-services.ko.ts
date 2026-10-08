import type { ModelsModelServicesMessages } from './model-services.ts';

export const ko: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `해당 공급자가 없습니다: ${p.provider}`,
  noConfigureNeeded: '이 컴퓨터와 노드는 설정할 필요가 없습니다. 스위치와 키는 온라인 공급자에만 있습니다',
  cannotRemove: '온라인 서비스 공급자만 삭제할 수 있습니다. 이 컴퓨터, 노드, Agent 공급자는 삭제할 수 없습니다',
  noAccounts: '온라인 서비스 공급자에만 계정이 있습니다. 이 컴퓨터, 노드, Agent 공급자에는 계정이 없습니다',
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} 기능에는 기능 매개변수가 없습니다`,
  noRefresh: '모델 목록을 새로 고칠 수 있는 것은 온라인 공급자뿐입니다',
  clearWithModel: '기본값을 지울 때는 model을 지정하지 마세요',
  capabilityNotOffered: (p: { provider: string; capability: string }) =>
    `${p.provider}은(는) 이 기능을 제공하지 않습니다: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider}에 선택할 모델이 없습니다. modelId를 지정하세요`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider}에 해당 모델이 없습니다: ${p.model}`,
  providerNodeConflict: 'provider와 node가 서로 다른 공급자를 가리킵니다',
  modelBundleMismatch: 'model과 bundleId가 일치하지 않습니다',
  cannotTranscribe: (p: { provider: string }) => `${p.provider}은(는) 전사할 수 없습니다. 다른 서비스로 바꾸세요.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider}은(는) 이 기능에 사용할 수 없습니다. 다른 서비스로 바꾸세요.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider}은(는) 텍스트 생성에 사용할 수 없습니다. 다른 서비스로 바꾸세요.`,
};
