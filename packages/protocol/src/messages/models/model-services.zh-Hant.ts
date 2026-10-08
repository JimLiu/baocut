import type { ModelsModelServicesMessages } from './model-services.ts';

export const zhHant: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `沒有這個供應商：${p.provider}`,
  noConfigureNeeded: '這台電腦與節點不需要設定；只有線上供應商才有開關與金鑰',
  cannotRemove: '只能移除線上供應商；這台電腦、節點與 Agent 供應商無法移除',
  noAccounts: '只有線上供應商有帳號；這台電腦、節點與 Agent 供應商沒有',
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} 沒有能力參數`,
  noRefresh: '只有線上供應商有可以重新整理的模型清單',
  clearWithModel: '清除預設值時不要指定模型',
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} 不提供這項能力：${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} 沒有可選擇的模型，請指定 modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} 沒有這個模型：${p.model}`,
  providerNodeConflict: 'provider 與 node 指向不同的供應商',
  modelBundleMismatch: 'model 與 bundleId 不一致',
  cannotTranscribe: (p: { provider: string }) => `${p.provider} 無法轉錄。請換一個服務。`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} 無法用於這項能力。請換一個服務。`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} 無法用於文字生成。請換一個服務。`,
};
