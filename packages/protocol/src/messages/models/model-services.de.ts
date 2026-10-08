import type { ModelsModelServicesMessages } from './model-services.ts';

export const de: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Kein solcher Anbieter: ${p.provider}`,
  noConfigureNeeded: "Dieser Computer und Knoten benötigen keine Einrichtung; nur Online-Anbieter haben einen Schalter und einen Schlüssel",
  cannotRemove: "Nur Online-Dienstanbieter können entfernt werden; dieser Computer, Knoten und Agentenanbieter nicht",
  noAccounts: "Nur Online-Dienstanbieter haben Konten; dieser Computer, Knoten und Agentenanbieter nicht",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} hat keine Funktionsparameter`,
  noRefresh: "Nur Online-Anbieter haben eine aktualisierbare Modellliste",
  clearWithModel: "Beim Zurücksetzen des Standards kein Modell angeben",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} bietet diese Funktion nicht an: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} hat kein auswählbares Modell; modelId angeben`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} hat kein solches Modell: ${p.model}`,
  providerNodeConflict: "provider und node verweisen auf verschiedene Anbieter",
  modelBundleMismatch: "model und bundleId stimmen nicht überein",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} kann nicht transkribieren. Anderen Dienst wählen.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} kann für diese Funktion nicht verwendet werden. Anderen Dienst wählen.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} kann nicht für Texterzeugung verwendet werden. Anderen Dienst wählen.`,
};
