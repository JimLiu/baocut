import type { GeneralSettingsModelMessages } from './general-settings.ts';
import { pluralForm } from '@baocut/protocol';

export const it: GeneralSettingsModelMessages = {
  lineShort: 'Breve', lineMedium: 'Media', lineLong: 'Lunga',
  lineLength: (cjk: number, other: number) => `Testo CJK: ${pluralForm('it', cjk, { one: `${cjk} carattere`, other: `${cjk} caratteri` })} per riga · Altro testo: ${pluralForm('it', other, { one: `${other} carattere`, other: `${other} caratteri` })} per riga`,
  endpointTooLong: (max: number) => pluralForm('it', max, { one: `Troppo lungo: fino a ${max} carattere`, other: `Troppo lungo: fino a ${max} caratteri` }),
  endpointNotUrl: 'Non è un indirizzo web: deve iniziare con http:// o https://',
  endpointScheme: 'Sono supportati solo indirizzi che iniziano con http:// o https://',
  endpointCredentials: 'L’indirizzo non può includere un nome utente o una password',
  endpointQuery: 'L’indirizzo non può includere parametri di query (la parte dopo ?)',
  endpointHash: 'L’indirizzo non può includere un frammento (la parte dopo #)',
  saveDir: {
    label: 'Posizione di salvataggio predefinita', desc: 'Qui vengono salvati i risultati degli strumenti, i video scaricati e i file consegnati dall’agente. La posizione predefinita è la tua cartella Download.', systemDefault: 'Cartella Download', isDefault: 'Predefinita', change: 'Cambia…', reset: 'Reimposta valore predefinito', pickTitle: 'Scegli posizione di salvataggio predefinita', changed: 'Posizione di salvataggio predefinita cambiata', resetDone: 'Reimpostato alla cartella Download',
    pickFailed: (message: string) => `Impossibile scegliere una cartella: ${message}`,
    webNote: 'Un browser non può scegliere una cartella su questo computer. Impostala nell’app desktop BaoCut.',
  },
  source: { system: 'Installato sul sistema', user: 'Posizione che hai scelto', managed: 'Scaricato da BaoCut', env: 'Impostato da una variabile d’ambiente' },
  notInstalled: 'Non installato',
  missingDesc: 'yt-dlp non è ancora installato. Quando l’agente importa da un link, ti chiederà prima di consentirne il download (mostrando origine, versione, dimensione e licenza).',
  consentRevoked: 'Consenso ritirato',
  revokedDesc: (facts: string) => `${facts}. Hai ritirato il consenso al suo utilizzo, quindi l’importazione da un link lo richiederà di nuovo.`,
  available: 'Disponibile', needsUpdate: 'Aggiornamento necessario', cannotRun: 'Impossibile eseguire',
  factsWhy: (facts: string, why: string) => `${facts}. ${why}`,
};
