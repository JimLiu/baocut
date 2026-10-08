import type { NewFlowMessages } from './new-flow.ts';

export const pl: NewFlowMessages = {
  bilibili: "Bilibili",
  directLink: "Link bezpośredni",
  webPage: "Strona internetowa",
  videoLink: (site: string) => `${site} – link do wideo`,
  into: (name: string) => `Przetłumacz na ${name}`,
  translated: (language: string) => `Tłumaczenie gotowe · ${language} – napisy dodano do wideo`,
};
