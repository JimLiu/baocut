import type { JobsTranslationBatchesMessages } from './translation-batches.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: 'Cada item do parâmetro glossary precisa de source e target não vazios',
  glossaryNoteInvalid: 'note no parâmetro glossary deve ser uma string',
  glossariesItemInvalid: 'Cada item do parâmetro glossaries precisa de um id de glossário',
  glossariesUnknownFields: (p) => `Itens do parâmetro glossaries têm campos desconhecidos: ${p.fields}`,
  glossariesVersionInvalid: 'version no parâmetro glossaries deve ser um inteiro positivo',
  cannotFreezeGlossaries: 'Este Runtime não pode congelar o conteúdo dos glossários',
  artifactGone: (p) => `O resultado ${p.artifactId} não existe mais`,
  batchFailedSentences: (p) => `A tradução das frases ${p.first}–${p.last} ainda não corresponde ao formato esperado após ${pluralForm('pt-BR', p.retries, { one: `${p.retries} tentativa`, other: `${p.retries} tentativas` })}`,
  batchFailedCues: (p) => `A tradução das legendas ${p.first}–${p.last} ainda não corresponde ao formato esperado após ${pluralForm('pt-BR', p.retries, { one: `${p.retries} tentativa`, other: `${p.retries} tentativas` })}`,
  outputNoTranslations: 'A saída não tem translations',
  outputCountMismatch: (p) => `A saída tem ${pluralForm('pt-BR', p.output, { one: `${p.output} item`, other: `${p.output} itens` })}; a entrada tem ${pluralForm('pt-BR', p.input, { one: `${p.input} frase`, other: `${p.input} frases` })}`,
  outputIncompleteItem: 'A saída tem itens sem id ou tradução',
  outputDuplicateId: (p) => `${p.id} aparece duas vezes na saída`,
  outputMissingIds: (p) => `A saída não tem ${p.ids}`,
};
