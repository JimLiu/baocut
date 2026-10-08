import type { NewFlowMessages } from './new-flow.ts';

export const it: NewFlowMessages = {
  bilibili: 'Bilibili',
  directLink: 'Link diretto',
  webPage: 'Pagina web',
  videoLink: (site: string) => `Link video di ${site}`,
  into: (name: string) => `Traduci in ${name}`,
  translated: (language: string) => `Traduzione completata · I sottotitoli in ${language} sono sul video`,
};
