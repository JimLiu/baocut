import type { LibraryGlossaryMessages } from './library-glossary.ts';
import { pluralForm } from '@baocut/protocol';

const chars = (n: number) => pluralForm('pt-BR', n, { one: `${n} caractere`, other: `${n} caracteres` });
const terms = (n: number) => pluralForm('pt-BR', n, { one: `${n} termo`, other: `${n} termos` });

export const ptBR: LibraryGlossaryMessages = {
  kinds: { transcription: { label: 'Glossário de transcrição', a: 'Grafia correta', b: 'Frequentemente ouvido como' }, translation: { label: 'Glossário de tradução', a: 'Origem', b: 'Tradução' } },
  anyLanguage: 'Qualquer idioma', spoken: (language: string) => `Fala em ${language}`, newTranscription: 'Novo glossário de transcrição', fieldCanonical: 'Grafia correta', fieldSource: 'Origem', fieldTarget: 'Tradução',
  fieldEmpty: (label: string) => `É necessário preencher ${label}`,
  fieldTooLong: (label: string, max: number) => `${label} não pode ter mais que ${chars(max)}`,
  fieldNewline: (label: string) => `${label} não pode conter quebras de linha`,
  duplicate: (term: string) => `“${term}” já está no glossário`,
  misheardSame: 'Uma grafia ouvida incorretamente não pode ser igual à grafia correta',
  misheardTooMany: (max: number) => pluralForm('pt-BR', max, { one: `Até ${max} grafia ouvida incorretamente`, other: `Até ${max} grafias ouvidas incorretamente` }),
  misheardTooLong: (max: number) => `Cada grafia não pode ter mais que ${chars(max)}`,
  noteTooLong: (max: number) => `A observação não pode ter mais que ${chars(max)}`,
  nameEmpty: 'O nome do glossário não pode ficar vazio', nameTooLong: (max: number) => `O nome do glossário não pode ter mais que ${chars(max)}`,
  skipPunctuation: 'Só pontuação', skipTooLong: (max: number) => `Mais que ${chars(max)}`, skipMerged: 'Mesmo termo de uma linha anterior; mesclado', skipNoTarget: 'Sem tradução', skipKeptFirst: 'Mesmo termo de uma linha anterior; mantido o primeiro',
  allExist: 'Estes termos já estão no glossário',
  added: (n: number) => pluralForm('pt-BR', n, { one: `${n} termo adicionado`, other: `${n} termos adicionados` }),
  merged: (n: number) => `${terms(n)} já no glossário`,
  overflow: (n: number, limit: number) => `${pluralForm('pt-BR', n, { one: `${n} termo não adicionado`, other: `${n} termos não adicionados` })}: um glossário aceita até ${terms(limit)}`,
  fileName: 'Glossário', misheardSeparator: ', ',
};
