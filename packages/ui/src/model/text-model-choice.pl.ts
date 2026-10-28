import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const pl: TextModelChoiceMessages = {
  placeholder: 'Wybierz model tekstowy',
  providers: 'Dostawcy',
  agentReady: (provider) => `Agent · Korzysta z Twojej subskrypcji ${provider} · Wolniej niż API`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => (n === 1 ? 'Połączony · 1 model' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `Połączony · ${n} modele` : `Połączony · ${n} modeli`),
  notConnected: 'Niepołączony · Połącz w Ustawieniach',
  settings: 'Zarządzaj modelami tekstowymi…',
  settingsSub: 'Połącz dostawców API · Model domyślny',
};
