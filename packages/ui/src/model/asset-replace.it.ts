import type { AssetReplaceMessages } from './asset-replace.ts';
import { pluralForm } from '@baocut/protocol';

export const it: AssetReplaceMessages = {
  cantReplaceKind: 'Questo tipo di materiale non può ancora essere sostituito.',
  sameKind: (kind) => `Puoi sostituirlo solo con un materiale dello stesso tipo: qui serve ${{ video: 'un materiale video', image: 'un’immagine', audio: 'un materiale audio' }[kind]}.`,
  sameAsset: 'È il materiale attuale. Scegline un altro.',
  unused: 'Questo materiale non è usato nella timeline, quindi non c’è nulla da sostituire.',
  tooShort: 'Il nuovo materiale è troppo breve per riempire un singolo fotogramma.',
  allLocked: 'Ogni clip che lo usa è bloccata (o è un sostituto prerenderizzato di una composizione). Sbloccale prima.',
  clipLocked: 'Questa clip è bloccata. Sbloccala prima.',
  durationUnknown: 'La durata del materiale è sconosciuta, quindi per ora le clip mantengono la durata attuale.',
  longEnoughMany: 'Il nuovo materiale è abbastanza lungo. Nessuna di queste clip cambia durata e la timeline rimane invariata.',
  longEnoughOne: 'Il nuovo materiale è abbastanza lungo. La clip mantiene la durata e la timeline rimane invariata.',
  shortenMany: (n: number, seconds: string) => `${pluralForm('it', n, { one: `${n} clip si accorcia`, other: `${n} clip si accorciano` })}, ${seconds} s in totale`,
  shortenOne: (seconds: string) => `La clip si accorcia di ${seconds} s`,
  moved: (head: string, n: number) => `${head}, e ${pluralForm('it', n, { one: `la prossima ${n} clip sulla traccia si sposta prima`, other: `le prossime ${n} clip sulla traccia si spostano prima` })}.`,
  trackShorter: (head: string) => `${head}, e la traccia si accorcia.`,
};
