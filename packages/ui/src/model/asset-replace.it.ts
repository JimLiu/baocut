import type { AssetReplaceMessages } from './asset-replace.ts';
import { pluralForm } from '@baocut/protocol';

export const it: AssetReplaceMessages = {
  cantReplaceKind: 'Questo tipo di materiale non può ancora essere sostituito.',
  sameKind: (kind) => `Puoi sostituirlo solo con un materiale dello stesso tipo: qui serve ${{ video: 'un materiale video', image: 'un’immagine', audio: 'un materiale audio' }[kind]}.`,
  sameAsset: 'È il materiale attuale. Scegline un altro.',
  unused: 'Questo materiale non è usato nella timeline, quindi non c’è nulla da sostituire.',
  tooShort: 'Il nuovo materiale è troppo breve per riempire un singolo fotogramma.',
  allLocked: 'Ogni clip che lo usa è bloccata (o è un sostituto prerenderizzato di una composizione). Sbloccale prima.',
  durationUnknown: 'La durata del materiale è sconosciuta, quindi per ora le clip mantengono la durata attuale.',
  longEnoughMany: 'Il nuovo materiale è abbastanza lungo. Nessuna di queste clip cambia durata e la timeline rimane invariata.',
  longEnoughOne: 'Il nuovo materiale è abbastanza lungo. La clip mantiene la durata e la timeline rimane invariata.',
  shortenMany: (n: number, seconds: string) => `${pluralForm('it', n, { one: `${n} clip si accorcia`, other: `${n} clip si accorciano` })}, ${seconds} s in totale`,
  shortenOne: (seconds: string) => `La clip si accorcia di ${seconds} s`,
  moved: (head: string, n: number) => `${head}, e ${pluralForm('it', n, { one: `la prossima ${n} clip sulla traccia si sposta prima`, other: `le prossime ${n} clip sulla traccia si spostano prima` })}.`,
  trackShorter: (head: string) => `${head}, e la traccia si accorcia.`,
  transitions: (n: number) => n === 1 ? 'La transizione di queste clip verrà rimossa.' : pluralForm('it', n, { other: `Le ${n} transizioni di queste clip verranno rimosse.` }),
  captions: (n: number) => pluralForm('it', n, { one: `${n} sottotitolo è temporizzato in base a queste clip e dovrà essere riallineato dopo la sostituzione.`, other: `${n} sottotitoli sono temporizzati in base a queste clip e dovranno essere riallineati dopo la sostituzione.` }),
  ducking: (n: number) => pluralForm('it', n, { one: `${n} regola di attenuazione punta a queste clip e non corrisponderà dopo la sostituzione.`, other: `${n} regole di attenuazione puntano a queste clip e non corrisponderanno dopo la sostituzione.` }),
};
