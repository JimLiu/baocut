import type { ModelsModelServicesMessages } from './model-services.ts';

export const ptBR: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Não existe este provedor: ${p.provider}`,
  noConfigureNeeded: "Este computador e os nós não precisam de configuração; somente provedores online têm chave e opção de ativação",
  cannotRemove: "Só é possível remover provedores de serviço online; este computador, nós e provedores de agentes não podem ser removidos",
  noAccounts: "Só provedores de serviço online têm contas; este computador, nós e provedores de agentes não têm",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} não tem parâmetros de capacidade`,
  noRefresh: "Só provedores online têm uma lista de modelos que pode ser atualizada",
  clearWithModel: "Não forneça um modelo ao limpar o padrão",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} não oferece esta capacidade: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} não tem modelo para escolher; especifique modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} não tem este modelo: ${p.model}`,
  providerNodeConflict: "provider e node apontam para provedores diferentes",
  modelBundleMismatch: "model e bundleId não correspondem",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} não pode transcrever. Mude para outro serviço.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} não pode ser usado nesta capacidade. Mude para outro serviço.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} não pode ser usado para gerar texto. Mude para outro serviço.`,
};
