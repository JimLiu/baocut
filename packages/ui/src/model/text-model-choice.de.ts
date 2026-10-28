import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const de: TextModelChoiceMessages = {
  placeholder: 'Textmodell wählen',
  providers: 'Anbieter',
  agentReady: (provider) => `Agent · Nutzt dein ${provider}-Abonnement · Langsamer als die API`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => (n === 1 ? 'Verbunden · 1 Modell' : `Verbunden · ${n} Modelle`),
  notConnected: 'Nicht verbunden · In den Einstellungen verbinden',
  settings: 'Textmodelle verwalten…',
  settingsSub: 'API-Anbieter verbinden · Standardmodell',
};
