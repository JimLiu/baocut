import type { NewFlowMessages } from './new-flow.ts';

export const de: NewFlowMessages = {
  bilibili: "Bilibili",
  directLink: "Direktlink",
  webPage: "Webseite",
  videoLink: (site: string) => `${site}-Videolink`,

  into: (name: string) => `Übersetzen nach ${name}`,
  translated: (language: string) => `Übersetzung abgeschlossen · ${language} Untertitel im Video`,
};
