import type { NewFlowMessages } from './new-flow.ts';
export const es: NewFlowMessages = {
 bilibili: 'Bilibili', directLink: 'Enlace directo', webPage: 'Página web', videoLink: (site) => `Enlace de vídeo de ${site}`,
 into: (name) => `Traducir a ${name}`, translated: (language) => `Traducción completada · el vídeo tiene subtítulos en ${language}`,
};
