import type { ToolsImageMessages } from './tools-image-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ToolsImageMessages = {
  emptyPrompt: 'Descreva a imagem primeiro',
  promptTooLong: (n, max) => `O prompt tem ${n} caracteres · este modelo aceita no máximo ${max}`,
  maxImages: (max) => pluralForm('pt-BR', max, { one: `Até ${max} imagem por vez`, other: `Até ${max} imagens por vez` }),
  seedInteger: 'A semente deve ser um número inteiro',
  pickModel: 'Escolha um modelo primeiro',
  downloadFirst: (label) => `Baixe ${label} primeiro`,
  connectFirst: (provider) => `Conecte ${provider} primeiro`,
  local: 'Neste computador',
  steps: (n) => pluralForm('pt-BR', n, { one: `${n} etapa`, other: `${n} etapas` }),
  deviceTime: 'O tempo depende do seu dispositivo',
  offline: 'Funciona off-line',
  images: (n) => pluralForm('pt-BR', n, { one: `${n} imagem`, other: `${n} imagens` }),
  aspects: (n) => pluralForm('pt-BR', n, { one: `${n} proporção`, other: `${n} proporções` }),
  providerSize: 'Tamanho definido pelo provedor',
  takesSeed: 'Aceita semente',
  localChip: 'Gerado neste computador · off-line',
  cloudChip: (provider) => `Online · ${provider} · cobrado pelo uso`,
  imageName: (n) => `Imagem ${n}`,
  seed: (seed) => `Semente ${seed}`,
  decoding: 'Decodificando',
  stepOf: (done, total) => `Etapa ${done}/${total}`,
};
