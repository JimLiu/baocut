import type { TranscriptTextMessages } from './transcript-text.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${pluralForm('pt-BR', paragraphs, { one: `${paragraphs} parágrafo`, other: `${paragraphs} parágrafos` })} · ${amount}`,
  characters: (n: number) => pluralForm('pt-BR', n, { one: `${n} caractere`, other: `${n} caracteres` }),
  words: (n: number) => pluralForm('pt-BR', n, { one: `${n} palavra`, other: `${n} palavras` }),
};
