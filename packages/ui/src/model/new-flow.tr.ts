import type { NewFlowMessages } from './new-flow.ts';

export const tr: NewFlowMessages = {
bilibili: 'Bilibili', directLink: 'Doğrudan bağlantı', webPage: 'Web sayfası', videoLink: (site) => `${site} video bağlantısı`, into: (name) => `${name} diline çevir`, translated: (language) => `Çeviri tamamlandı · ${language} altyazıları videoda`,
};
