import type { ModelsModelServicesMessages } from './model-services.ts';

export const nl: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Deze aanbieder bestaat niet: ${p.provider}`,
  noConfigureNeeded: "Deze computer en knooppunten hoeven niet te worden ingesteld; alleen online aanbieders hebben een schakelaar en een sleutel",
  cannotRemove: "Alleen online dienstaanbieders kunnen worden verwijderd; deze computer, knooppunten en agentaanbieders niet",
  noAccounts: "Alleen online dienstaanbieders hebben accounts; deze computer, knooppunten en agentaanbieders niet",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} heeft geen functieparameters`,
  noRefresh: "Alleen online aanbieders hebben een modellenlijst die kan worden vernieuwd",
  clearWithModel: "Geef geen model op bij het wissen van de standaard",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} biedt deze functie niet aan: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} heeft geen model om te kiezen; geef modelId op`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} heeft dit model niet: ${p.model}`,
  providerNodeConflict: "provider en node verwijzen naar verschillende aanbieders",
  modelBundleMismatch: "model en bundleId komen niet overeen",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} kan niet transcriberen. Kies een andere dienst.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} kan niet worden gebruikt voor deze functie. Kies een andere dienst.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} kan niet worden gebruikt voor tekstgeneratie. Kies een andere dienst.`,
};
