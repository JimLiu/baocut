import type { ModelsTextGenerationMessages } from './text-generation.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: ModelsTextGenerationMessages = {
  noMessage: 'É necessária pelo menos uma mensagem não vazia de user ou assistant', badRole: 'O papel de uma mensagem deve ser system, user ou assistant',
  inputTooLong: (p) => `A entrada tem ${pluralForm('pt-BR', p.chars, { one: `${p.chars} caractere`, other: `${p.chars} caracteres` })}, muito além do contexto de ${pluralForm('pt-BR', p.contextTokens, { one: `${p.contextTokens} token`, other: `${p.contextTokens} tokens` })} do modelo ${p.modelId}`,
  maxOutput: (p) => `O modelo ${p.modelId} produz no máximo ${pluralForm('pt-BR', p.max, { one: `${p.max} token`, other: `${p.max} tokens` })} por chamada`,
  noTemperature: (p) => `O modelo ${p.modelId} não aceita temperature`, temperatureRange: 'temperature deve estar entre 0 e 2', noSeed: (p) => `O modelo ${p.modelId} não aceita seed`,
  noStructured: (p) => `O modelo ${p.modelId} não oferece suporte a saída estruturada`,
  effortIgnored: (p) => `O modelo ${p.modelId} não pode ajustar o esforço de raciocínio; ${p.requested} ignorado`,
  effortChanged: (p) => `O modelo ${p.modelId} não tem esforço de raciocínio ${p.requested}; usado ${p.applied}`, contentFiltered: (p) => `O filtro de conteúdo de ${p.provider} bloqueou esta saída`,
  truncatedJson: (p) => `A saída de ${p.provider} atingiu o limite (${pluralForm('pt-BR', p.max, { one: `${p.max} token`, other: `${p.max} tokens` })}) e foi cortada; a saída estruturada está incompleta`,
  truncatedProblem: (p) => `Saída cortada (maxOutputTokens ${p.max})`, notJson: (p) => `A saída de ${p.provider} não é JSON válido`, notJsonProblem: 'JSON inválido',
  schemaMismatch: (p) => `A saída de ${p.provider} não corresponde ao JSON Schema fornecido`,
  limitBeforeText: (p) => `${p.provider} atingiu o limite de saída antes de escrever texto`, emptyOutput: (p) => `${p.provider} retornou uma saída vazia`,
  limitBeforeTextProblem: (p) => `Ainda sem texto ao atingir o limite de saída de ${pluralForm('pt-BR', p.max, { one: `${p.max} token`, other: `${p.max} tokens` })}`, emptyProblem: 'A saída está vazia', cancelled: 'Chamada cancelada',
};
