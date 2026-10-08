import type { ToolsGalleryMessages } from './tools-gallery.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ToolsGalleryMessages = {
  transcode: 'Codificado neste computador com ffmpeg · nada enviado',
  linkReady: 'Ferramenta de download pronta',
  pipelineMissing: 'Esta versão do Runtime ainda não tem fluxo para esta ferramenta, então ela não pode ser usada agora',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => pluralForm('pt-BR', n, { one: `${n} modelo local`, other: `${n} modelos locais` }),
  cloudConnected: (n) => pluralForm('pt-BR', n, { one: `${n} provedor online conectado`, other: `${n} provedores online conectados` }),
  noSpeech: 'Ainda não há modelo de síntese de fala disponível',
  noImage: 'Ainda não há modelo de geração de imagens disponível',
  noText: 'Ainda não há modelo de texto disponível',
};
