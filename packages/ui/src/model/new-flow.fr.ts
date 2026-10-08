import type { NewFlowMessages } from './new-flow.ts';

export const fr: NewFlowMessages = {
  bilibili: "Bilibili",
  directLink: "Lien direct",
  webPage: "Page web",
  videoLink: (site: string) => `${site} : lien vidéo`,

  into: (name: string) => `Traduire en ${name}`,
  translated: (language: string) => `Traduction terminée · ${language} sous-titres affichés sur la vidéo`,
};
