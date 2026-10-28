import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const it: TextModelChoiceMessages = {
  placeholder: 'Scegli un modello di testo',
  providers: 'Provider',
  agentReady: (provider) => `Agente · Usa il tuo abbonamento ${provider} · Più lento dell’API`,
  agentNote: (note) => `Agente · ${note}`,
  connected: (n) => (n === 1 ? 'Collegato · 1 modello' : `Collegato · ${n} modelli`),
  notConnected: 'Non collegato · Collega nelle Impostazioni',
  settings: 'Gestisci i modelli di testo…',
  settingsSub: 'Collega provider API · Modello predefinito',
};
