import type { NewFlowMessages } from './new-flow.ts';

export const ptBR: NewFlowMessages = {
  bilibili: 'Bilibili',
  directLink: 'Link direto',
  webPage: 'Página web',
  videoLink: (site: string) => `Link de vídeo de ${site}`,
  into: (name: string) => `Traduzir para ${name}`,
  translated: (language: string) => `Tradução concluída · As legendas em ${language} estão no vídeo`,
};
