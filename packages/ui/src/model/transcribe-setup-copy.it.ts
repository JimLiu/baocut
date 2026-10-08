import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: TranscribeSetupMessages = {
  notConnected: 'Non connesso', unavailable: 'Non disponibile', autoDetect: 'Rileva automaticamente',
  hintNoModel: 'Non è ancora noto quale modello vocale verrà usato. Scegline uno sopra per vedere se accetta suggerimenti di riconoscimento.',
  hintUnsupported: (model: string, alt: string | null) => `${model} non accetta suggerimenti di riconoscimento, quindi glossari e prompt non possono essere usati in questo passaggio e verranno saltati durante la trascrizione.${alt ? ` Per usarli durante la trascrizione, passa a ${alt}.` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? pluralForm('it', b.custom, { one: `prompt di ${b.custom} carattere`, other: `prompt di ${b.custom} caratteri` }) : 'nessun prompt';
    const dropped = b.dropped ? ` · altri ${b.dropped} non rientrano; i glossari elencati prima entrano prima` : '';
    return `Inviato a ${model}: ${custom} + ${pluralForm('it', b.terms, { one: `${b.terms} termine`, other: `${b.terms} termini` })} · circa ${b.chars} / ${max} caratteri${dropped}`;
  },
  glossaryGone: 'Non è più nella libreria dei glossari · non usato questa volta',
  glossaryTranslation: 'Glossario di traduzione; non usato per la trascrizione · non usato questa volta', anyLanguage: 'Qualsiasi lingua',
  termCount: (count: number) => pluralForm('it', count, { one: `${count} termine`, other: `${count} termini` }),
  noDefaultModel: 'Nessun modello vocale predefinito ancora impostato', defaultModel: (label: string) => `${label} (predefinito)`, autoDetectLanguage: 'Rileva automaticamente la lingua',
  glossaries: (count: number) => pluralForm('it', count, { one: `${count} glossario`, other: `${count} glossari` }),
  hasPrompt: 'Con prompt',
  noDefaultFacts: 'Nessun modello vocale predefinito ancora impostato. Scegline uno o imposta un predefinito nella pagina Modelli. Se inizi senza scegliere, ti verrà indicato cosa manca.',
  modelUnusable: 'Questo modello non può essere usato al momento', acceptsHint: 'Accetta suggerimenti di riconoscimento', noHint: 'Nessun suggerimento di riconoscimento',
  followDefault: (facts: string) => `Usa il predefinito · ${facts}`,
};
