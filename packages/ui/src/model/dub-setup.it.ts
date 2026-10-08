import type { DubSetupMessages } from './dub-setup.ts';

export const it: DubSetupMessages = {
  useExisting: (name: string) => `Usa traduzione esistente · ${name}`,
  translateFirst: (language: string) => `${language} · Traduci prima`, sameAsSource: 'Stessa lingua dell’originale',
  missingLibraryVoice: (id: string) => `Voce della libreria (${id}, non più nella libreria)`,
  voiceRemoved: 'Questa voce non è più nella libreria', noConsent: 'Senza dichiarazione di consenso del parlante non verrà caricata sul provider',
  notCloned: (provider: string) => `Non ancora clonata con ${provider}`,
  cloneExpired: (provider: string) => `Il clone con ${provider} è scaduto; clonalo di nuovo`,
  modelDefaultNamed: (voice: string) => `Predefinito del modello · ${voice}`, modelDefault: 'Predefinito del modello',
  noDefaultVoice: 'Questo modello non ha una voce predefinita', needsVoice: 'Questo modello richiede una voce specificata', presetVoice: 'Voce preset',
  myVoiceProblem: (problem: string) => `Le mie voci · ${problem}`, myVoice: 'Le mie voci', customVoice: 'Inserisci ID voce…', customVoiceDesc: 'Una voce del tuo account del provider',
  purpose: (language: string, videoName: string | null) => `Doppiaggio: doppia ${videoName ? `«${videoName}»` : 'questo video'} in ${language}`,
  kindList: (kinds: readonly string[]) => kinds.join(', '),
  transcriptNote: ' (la traduzione da sintetizzare; traducendo prima, anche il testo originale)',
  factWhat: 'Dati inviati', factTo: 'Inviati a', factScope: 'Ambito', factPurpose: 'Scopo', factBudget: 'Budget', factRevoke: 'Revoca',
  scopeVideoNamed: (name: string) => `Solo il video «${name}»`, scopeThisVideo: 'Solo questo video',
  budget: 'Conteggiato per chiamata, costo sconosciuto, chiamate illimitate; il provider addebita normalmente l’utilizzo',
  revoke: 'Revoca in qualsiasi momento in Impostazioni › Privacy e permessi › Autorizzazioni alla condivisione dei dati; i dati già inviati non possono essere recuperati',
};
