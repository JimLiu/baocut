import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const nl: TextModelChoiceMessages = {
  placeholder: 'Kies een tekstmodel',
  providers: 'Aanbieders',
  agentReady: (provider) => `Agent · Gebruikt je ${provider}-abonnement · Trager dan de API`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => (n === 1 ? 'Verbonden · 1 model' : `Verbonden · ${n} modellen`),
  notConnected: 'Niet verbonden · Verbind in Instellingen',
  settings: 'Tekstmodellen beheren…',
  settingsSub: 'API-aanbieders verbinden · Standaardmodel',
};
