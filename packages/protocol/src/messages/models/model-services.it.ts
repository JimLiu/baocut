import type { ModelsModelServicesMessages } from './model-services.ts';

export const it: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `Nessun provider corrispondente: ${p.provider}`,
  noConfigureNeeded: "Questo computer e i nodi non richiedono configurazione; solo i provider online hanno un interruttore e una chiave",
  cannotRemove: "Si possono rimuovere solo provider di servizi online; questo computer, i nodi e i provider degli agenti non possono essere rimossi",
  noAccounts: "Solo i provider di servizi online hanno account; questo computer, i nodi e i provider degli agenti no",
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} non ha parametri di capacità`,
  noRefresh: "Solo i provider online hanno un elenco di modelli aggiornabile",
  clearWithModel: "Non indicare un modello quando cancelli il predefinito",
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} non offre questa capacità: ${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} non ha un modello selezionabile; specifica modelId`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} non ha questo modello: ${p.model}`,
  providerNodeConflict: "provider e node indicano provider diversi",
  modelBundleMismatch: "model e bundleId non corrispondono",
  cannotTranscribe: (p: { provider: string }) => `${p.provider} non può trascrivere. Passa a un altro servizio.`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} non può essere usato per questa capacità. Passa a un altro servizio.`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} non può essere usato per la generazione di testo. Passa a un altro servizio.`,
};
