import type { ModelsModelSelectionMessages } from './model-selection.ts';

export const ko: ModelsModelSelectionMessages = {
  capTranscribe: '전사',
  capSynthesizeSpeech: '음성 합성',
  capGenerateImage: '이미지 생성',
  capGenerateText: '텍스트 생성',
  capSeparateAudio: '음성 분리',
  noSuchProvider: (p: { provider: string }) => `해당 공급자가 없습니다: ${p.provider}`,
  noProviderForModel: (p: { model: string }) => `이 모델을 제공하는 공급자가 없습니다: ${p.model}`,
  ambiguousModel: (p: { model: string }) => `여러 공급자에 ${p.model} 모델이 있습니다. provider도 지정하세요`,
  languageUnsupported: (p: { modelId: string; language: string }) => `${p.modelId} 모델은 ${p.language} 언어를 지원하지 않습니다`,
  providerNoModel: (p: { provider: string; modelId: string }) => `${p.provider}에 해당 모델이 없습니다: ${p.modelId}`,
  defaultModelGone: (p: { modelId: string; provider: string }) =>
    `기본 모델(${p.modelId})이 더 이상 ${p.provider}의 모델 목록에 없습니다`,
  missingCredential: (p: { name: string }) => `${p.name}에 아직 API 키가 없습니다. 설정에서 키를 입력하세요.`,
  localNotInstalled: (p: { model: string }) =>
    `로컬 모델 번들(${p.model})이 설치되어 있지 않습니다. 설치하거나 다른 서비스를 사용하세요.`,
  nodeNotPaired: (p: { name: string }) => `${p.name} 노드가 페어링되어 있지 않습니다. 다시 페어링하거나 다른 서비스를 사용하세요.`,
  nodeNotConnected: (p: { name: string }) =>
    `${p.name} 노드에 연결할 수 없습니다. 노드가 켜져 있고 같은 네트워크에 있는지 확인하고, 필요하면 다시 페어링하세요.`,
  localDisabled: (p: { model: string }) => `로컬 모델 번들(${p.model})이 오류가 반복되어 꺼졌습니다. 설정에서 다시 켜세요.`,
  providerDisabled: (p: { name: string }) => `${p.name}이(가) 꺼져 있습니다. 설정에서 다시 켜세요.`,
  providerNotConfigured: (p: { name: string }) => `${p.name}이(가) 아직 설정되지 않았습니다. 설정에서 켜고 키를 입력하세요.`,
  agentNotInstalled: (p: { name: string }) => `${p.name}이(가) 설치되어 있지 않습니다`,
  agentNotInstalledWith: (p: { name: string; detail: string }) => `${p.name}이(가) 설치되어 있지 않습니다: ${p.detail}`,
  agentSignedOut: (p: { name: string }) => `${p.name}에 로그인되어 있지 않습니다`,
  agentSignedOutWith: (p: { name: string; detail: string }) => `${p.name}에 로그인되어 있지 않습니다: ${p.detail}`,
  agentOutdated: (p: { name: string }) => `${p.name}의 버전이 너무 오래되었습니다`,
  agentOutdatedWith: (p: { name: string; detail: string }) => `${p.name}의 버전이 너무 오래되었습니다: ${p.detail}`,
  agentUnavailable: (p: { name: string }) => `${p.name}은(는) 지금 사용할 수 없습니다`,
  agentUnavailableWith: (p: { name: string; detail: string }) => `${p.name}은(는) 지금 사용할 수 없습니다: ${p.detail}`,
  agentNotEnabled: (p: { name: string }) =>
    `${p.name}이(가) 아직 켜져 있지 않습니다. 켜면 프롬프트(와 참조 이미지)를 해당 계정으로 보내고 사용자 본인의 구독 할당량을 사용하는 데 동의하게 됩니다.`,
  defaultNodeUnpaired: (p: { node: string; capability: string }) =>
    `기본 노드(${p.node})가 더 이상 페어링되어 있지 않습니다. 다시 페어링하거나 ${p.capability}의 기본값을 바꾸세요.`,
  defaultProviderRemoved: (p: { provider: string; capability: string }) =>
    `기본 공급자(${p.provider})가 삭제되었습니다. 다시 설정하거나 ${p.capability}의 기본값을 바꾸세요.`,
  setUsableAsDefault: (p: { provider: string; capability: string }) =>
    `${p.provider}을(를) 사용할 수 있습니다. ${p.capability}의 기본값으로 설정하기만 하면 됩니다.`,
  noModelInstallSeparator: (p: { capability: string }) =>
    `${p.capability}에 사용할 수 있는 모델이 아직 없습니다. 로컬 분리 모델 번들을 설치하세요.`,
  noModelInstallLocal: (p: { capability: string }) =>
    `${p.capability}에 사용할 수 있는 모델이 아직 없습니다. 로컬 모델 번들을 설치하거나, 온라인 서비스를 설정하고 기본값으로 지정하세요.`,
  noModelConfigure: (p: { capability: string }) =>
    `${p.capability}에 사용할 수 있는 모델이 아직 없습니다. 설정에서 서비스를 설정하고 기본값으로 지정하세요.`,
  cannotUseFor: (p: { provider: string; capability: string }) =>
    `${p.provider}은(는) ${p.capability}에 사용할 수 없습니다. 다른 서비스나 모델로 바꾸거나 기본값을 변경하세요.`,
};
