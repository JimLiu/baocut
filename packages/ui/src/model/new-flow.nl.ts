import type { NewFlowMessages } from './new-flow.ts';
export const nl: NewFlowMessages = { bilibili: 'Bilibili', directLink: 'Directe link', webPage: 'Webpagina', videoLink: (site) => `${site}-videolink`, into: (name) => `Vertalen naar ${name}`, translated: (language) => `Vertaling klaar · ${language}-ondertitels staan op de video` };
