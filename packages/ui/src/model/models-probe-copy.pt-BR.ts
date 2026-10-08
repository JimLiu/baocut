import type { ModelsProbeMessages } from './models-probe-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ModelsProbeMessages = {
  speechText: 'Olá, este é um teste de síntese de fala do BaoCut.',
  noResult: 'A tarefa terminou, mas nenhum resultado foi retornado.',
  failed: 'A tarefa falhou.', cancelled: 'A tarefa foi cancelada.',
  interrupted: 'O Runtime reiniciou, então este teste não terminou.',
  unknownOutcome: 'O Runtime reiniciou antes de esta chamada responder, então o resultado é desconhecido.',
  audioFacts: (seconds, khz, type) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries, seconds, type) => `${pluralForm('pt-BR', entries, { one: `${entries} entrada`, other: `${entries} entradas` })} · ${seconds} s · ${type}`,
  packageFacts: (files, type) => `${pluralForm('pt-BR', files, { one: `${files} arquivo`, other: `${files} arquivos` })} · ${type}`,
  projectFacts: (clips, seconds, type) => `${pluralForm('pt-BR', clips, { one: `${clips} clipe`, other: `${clips} clipes` })} · ${seconds} s · ${type}`,
  chars: (count) => `${count} caracteres`, inputTokens: (count) => `${count} tokens de entrada`, outputTokens: (count) => `${count} tokens de saída`,
  hitLimit: 'Limite de saída atingido', filtered: 'Bloqueado pelo filtro de conteúdo do provedor',
  untested: 'Não testado', testing: 'Testando…', passed: 'Teste aprovado',
  passedIn: (seconds) => `Teste aprovado · ${seconds} s`,
};
