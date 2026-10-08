import type { JobsParamsMessages } from './params.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsParamsMessages = {
  unknownParam: (p) => `Parâmetro desconhecido ${p.key}`,
  invalidParam: (p) => `Parâmetro ${p.key} ${p.problem}`,
  mustBeNonEmptyString: 'deve ser uma string não vazia',
  atMostChars: (p) => pluralForm('pt-BR', p.max, { one: `deve ter no máximo ${p.max} caractere`, other: `deve ter no máximo ${p.max} caracteres` }),
  mustBeIntegerBetween: (p) => `deve ser um inteiro de ${p.min} a ${p.max}`,
  mustBeOneOf: (p) => `deve ser um de ${p.values}`,
  mustBeArray: 'deve ser um array',
  atLeastItems: (p) => pluralForm('pt-BR', p.min, { one: `deve ter pelo menos ${p.min} item`, other: `deve ter pelo menos ${p.min} itens` }),
  atMostItems: (p) => pluralForm('pt-BR', p.max, { one: `deve ter no máximo ${p.max} item`, other: `deve ter no máximo ${p.max} itens` }),
  mustBeBoolean: 'deve ser true ou false',
  mustBeLanguageTag: 'deve ser uma tag de idioma BCP 47',
  mustBeAbsolutePath: 'deve ser um caminho absoluto',
  itemsMustBeAbsolutePaths: 'deve conter apenas caminhos absolutos',
  onlyOneOf: (p) => `não pode ser combinado com ${p.other}`,
  createExcludesVideoId: 'cria um novo vídeo e não pode ser combinado com videoId',
  targetShape: 'deve ser { videoId }, { entryId } ou { create }',
};
