import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const fr: TextModelChoiceMessages = {
  placeholder: 'Choisir un modèle de texte',
  providers: 'Fournisseurs',
  agentReady: (provider) => `Agent · Utilise votre abonnement ${provider} · Plus lent que l’API`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => (n === 1 ? 'Connecté · 1 modèle' : `Connecté · ${n} modèles`),
  notConnected: 'Non connecté · Connecter dans les Réglages',
  settings: 'Gérer les modèles de texte…',
  settingsSub: 'Connecter des fournisseurs d’API · Modèle par défaut',
};
