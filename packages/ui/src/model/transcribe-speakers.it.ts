import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const it: TranscribeSpeakersMessages = {
  packFallback: 'Diarizzazione dei parlanti',
  builtinNote: (model: string) => `${model} distingue i parlanti autonomamente durante la trascrizione`,
  builtinSummary: 'Identifica parlanti · integrato nel modello',
  noneNote: (model: string) => `${model} non distingue i parlanti. Se necessario, passa a un modello locale o a un servizio con questa funzione integrata`,
  missingNote: (pack: string, size: string | null) => `Scarica prima «${pack}»${size ? ` (${size})` : ''} per distinguere i parlanti`,
  missingSummary: 'Identifica parlanti · scarica prima il modello',
  onNote: 'Dopo la trascrizione, «Diarizzazione dei parlanti» identifica il parlante di ogni frase e i sottotitoli e le trascrizioni includono i nomi',
  summaryOn: 'Identifica parlanti',
  offNote: 'I parlanti non vengono distinti; i sottotitoli e le trascrizioni non includono i nomi',
  summaryOff: 'Non identificare i parlanti',
  downloading: (pack: string, pct: number | null) => `Download di «${pack}»${pct === null ? '…' : ` · ${pct}%`}`,
};
