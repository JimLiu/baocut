import type { ModelsModelServicesMessages } from './model-services.ts';

export const fr: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Fournisseur inconnu : ${p.provider}`,
  noConfigureNeeded: "Cet ordinateur et les nœuds ne nécessitent aucun réglage ; seuls les fournisseurs en ligne ont un interrupteur et une clé",
  cannotRemove: "Seuls les fournisseurs en ligne peuvent être retirés ; pas cet ordinateur, les nœuds ou les fournisseurs Agent",
  noAccounts: "Seuls les fournisseurs en ligne ont des comptes ; pas cet ordinateur, les nœuds ou les fournisseurs Agent",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} n’a aucun paramètre de capacité`,
  noRefresh: "Seuls les fournisseurs en ligne ont une liste de modèles actualisable",
  clearWithModel: "N’indiquez pas de modèle pour effacer la valeur par défaut",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} ne propose pas cette capacité : ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} n’a aucun modèle à choisir ; indiquez modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} n’a pas ce modèle : ${p.model}`,
  providerNodeConflict: "provider et node désignent des fournisseurs différents",
  modelBundleMismatch: "model et bundleId ne correspondent pas",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} ne peut pas transcrire. Choisissez un autre service.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} ne peut pas servir à cette capacité. Choisissez un autre service.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} ne peut pas servir à la génération de texte. Choisissez un autre service.`,
};
