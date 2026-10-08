import type { ModelsModelServicesMessages } from './model-services.ts';

export const zhHans: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `没有这个 Provider：${p.provider}`,
  noConfigureNeeded: '本机与节点不需要配置；在线 Provider 才有开关与密钥',
  cannotRemove: '只能移除在线服务商；本机、节点与智能体 Provider 不能移除',
  noAccounts: '只有在线服务商有账号；本机、节点与智能体 Provider 没有',
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} 没有能力参数`,
  noRefresh: '只有在线 Provider 有可以刷新的模型列表',
  clearWithModel: '清除默认值时不能给模型',
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} 不提供这种能力：${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} 没有可选的模型，请指定 modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} 没有这个模型：${p.model}`,
  providerNodeConflict: 'provider 与 node 指向不同的 Provider',
  modelBundleMismatch: 'model 与 bundleId 不一致',
  cannotTranscribe: (p: { provider: string }) => `${p.provider} 不能转写：换一个服务。`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} 不能用于这种能力：换一个服务。`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} 不能用于文本生成：换一个服务。`,
};
