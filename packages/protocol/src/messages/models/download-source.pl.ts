import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const pl: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} musi być bazowym URL zaczynającym się od http(s)://, bez danych uwierzytelniających, parametrów zapytania ani fragmentu`,
};
