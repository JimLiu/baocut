import type { ModelsModelServicesMessages } from './model-services.ts';

export const pl: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Brak takiego dostawcy: ${p.provider}`,
  noConfigureNeeded: "Ten komputer i węzły nie wymagają konfiguracji; tylko dostawcy online mają przełącznik i klucz",
  cannotRemove: "Można usuwać tylko dostawców usług online; nie można usuwać tego komputera, węzłów ani dostawców agentów",
  noAccounts: "Tylko dostawcy usług online mają konta; ten komputer, węzły i dostawcy agentów ich nie mają",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} nie ma parametrów możliwości`,
  noRefresh: "Tylko dostawcy online mają odświeżaną listę modeli",
  clearWithModel: "Nie podawaj modelu przy czyszczeniu domyślnego",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} nie udostępnia tej możliwości: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} nie ma modelu do wyboru; podaj modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} nie ma takiego modelu: ${p.model}`,
  providerNodeConflict: "provider i node wskazują różnych dostawców",
  modelBundleMismatch: "model i bundleId nie są zgodne",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} nie obsługuje transkrypcji. Wybierz inną usługę.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} nie można użyć do tej możliwości. Wybierz inną usługę.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} nie można użyć do generowania tekstu. Wybierz inną usługę.`,
};
