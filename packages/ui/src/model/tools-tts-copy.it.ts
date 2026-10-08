import type { ToolsTtsMessages } from './tools-tts-copy.ts';
import { pluralForm } from '@baocut/protocol';

const characters = (n: number) => pluralForm('it', n, { one: `${n} carattere`, other: `${n} caratteri` });

export const it: ToolsTtsMessages = {
  emptyText: 'Scrivi prima il testo da leggere',
  vibes: {
    radio: { name: 'Radio notturna', style: 'Come una radio notturna: un po’ più lenta, voce bassa' }, launch: { name: 'Lancio di prodotto', style: 'Un lancio di prodotto: più caloroso ed energico, enfatizzando i punti principali' }, bedtime: { name: 'Fiaba della buonanotte', style: 'Una fiaba delicata della buonanotte: ritmo più lento, tono gentile' }, news: { name: 'Notiziario', style: 'Un notiziario: dizione chiara, ritmo regolare' }, teach: { name: 'Lezione', style: 'Spiega come in una lezione: tono colloquiale, pause nei punti principali' }, vlog: { name: 'Narrazione vivace', style: 'Leggera e vivace, un po’ più veloce, con un sorriso nella voce' },
  },
  statsEmpty: (max: number) => `0 / ${characters(max)}`, stats: (n: number, max: number, segments: number, seconds: string) => `${n} / ${characters(max)} · ${pluralForm('it', segments, { one: `${segments} segmento`, other: `${segments} segmenti` })} · circa ${seconds} s`,
  defaultVoiceOption: (name: string) => `Predefinita · ${name}`, customVoiceOption: 'Inserisci un ID voce…',
  presetOnly: (model: string) => `${model} accetta solo voci preset, quindi non puoi usare Le mie voci`, cannotClone: (provider: string) => `${provider} non può clonare · usa le sue voci preset`,
  noConsent: 'Non indicata come la tua voce o usata con permesso, quindi non verrà caricata su terze parti · aggiungi la dichiarazione in «Le mie voci»',
  cloneStale: (provider: string) => `Il clone su ${provider} non è aggiornato (la registrazione di riferimento è cambiata) · caricalo di nuovo in «Le mie voci»`,
  notCloned: (provider: string) => `Non ancora clonata su ${provider} · caricala una volta in «Le mie voci»`,
  customVoice: 'Voce personalizzata', deletedVoice: 'Voce eliminata', myVoices: 'Le mie voci', defaultVoice: 'Voce predefinita',
  cannotSpeak: (model: string, language: string) => `${model} non può leggere ${language}`, voiceDeleted: 'La voce selezionata è stata eliminata; scegline un’altra',
  tooLong: (model: string, max: number) => `${model} accetta al massimo ${characters(max)} alla volta; accorcia prima il testo`,
  enterVoiceId: 'Inserisci prima un ID voce', pickVoice: 'Scegli prima una voce', noVoices: 'Questo modello non ha voci disponibili', seedInteger: 'Il seme deve essere un numero intero', noModel: 'Nessun modello di sintesi vocale ancora disponibile', connectFirst: (provider: string) => `Connetti prima ${provider}`,
  readsMaterial: (model: string, voice: string, name: string) => `${model} · ${voice} · legge il testo di «${name}»`, estimate: (seconds: string, chars: number) => ` · circa ${seconds} s · circa ${characters(chars)}`,
  chars: (n: number) => characters(n), speech: 'Voce', presetVoices: (n: number) => pluralForm('it', n, { one: `${n} voce preset`, other: `${n} voci preset` }), customVoiceId: 'ID voce personalizzato', takesStyle: 'Accetta indicazioni di stile',
  speedRange: (min: number, max: number) => `Velocità ${min}–${max}×`, maxChars: (max: number) => `Fino a ${characters(max)} alla volta`, headerChip: (provider: string) => `Online · ${provider} · addebito in base all’utilizzo`,
};
