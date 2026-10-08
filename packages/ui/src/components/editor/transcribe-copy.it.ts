import type { TranscribeSetupMessages } from './transcribe-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: TranscribeSetupMessages = {
  title: 'Impostazioni di trascrizione', language: 'Lingua', model: 'Modello vocale',
  manageModels: 'Gestisci modelli vocali', modelsLoading: 'Caricamento dei modelli vocali…', downloadThenSelect: (name: string, pct: number | null) => `Download di ${name} in corso${pct === null ? '' : ` · ${pct}%`} · verrà selezionato al termine`, noDefault: 'Nessun modello vocale predefinito ancora impostato',
  hint: 'Suggerimenti per il riconoscimento', glossary: 'Glossario', manageGlossary: 'Gestisci glossari', glossaryLoading: 'Caricamento dei glossari…',
  glossaryEmpty: 'Nessun glossario di trascrizione ancora presente. Creane uno in Impostazioni › Glossario per registrare la grafia corretta di nomi e termini.',
  glossaryFailed: (message: string) => `Impossibile leggere i glossari attivati per questo video: ${message}`,
  glossaryNote: 'Seleziona un glossario per attivarlo per questo video; ogni trascrizione futura lo userà. Puoi annullare.',
  glossaryReadOnly: 'Questo video non può essere modificato al momento, quindi i suoi glossari attivati non possono essere cambiati.',
  glossaryLimit: (n: number) => pluralForm('it', n, { one: `Un video può avere al massimo ${n} glossario attivato`, other: `Un video può avere al massimo ${n} glossari attivati` }),
  glossaryOn: (name: string) => `Attivato per questo video: «${name}»`, glossaryOff: (name: string) => `Disattivato: «${name}»`,
  glossaryWriteFailed: (message: string) => `Impossibile modificare i glossari attivati: ${message}`,
  undo: 'Annulla', prompt: 'Prompt personalizzato',
  promptPlaceholder: 'Facoltativo. Ad esempio: Un podcast in inglese sull’ottimizzazione dell’inferenza dei LLM, condotto da Lin Che con l’ospite Zhou Yuan.',
  how: 'Il prompt e i glossari attivati (grafie corrette) vengono forniti insieme al modello vocale per aiutarlo a riconoscere nomi e termini. Se superano il limite, i termini finali vengono scartati.',
  reuse: 'I materiali già trascritti riutilizzano la trascrizione esistente; queste impostazioni si applicano solo ai materiali ancora da trascrivere.',
};
