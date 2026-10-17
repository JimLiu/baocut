import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const it: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `L’ancora iniziale dell’elemento ${p.element} non può essere risolta; saltato`,
  sourceSkipped: (p) => `L’anteprima ha saltato la sorgente multimediale ${p.source} e i suoi elementi: ${p.detail}`,
  stickerAssetNoSource: (p) => `Lo sticker risorsa ${p.element} non ha srcId; registralo nelle sorgenti della timeline (gli sticker modello usano source=template con un templateId)`,
  missingFont: (p) => `Il font "${p.family}" non è nella libreria dei font; viene usato ${p.fallback} al suo posto`,
  stickerRecolorFailed: (p) => `Non è stato possibile ricolorare la sorgente sticker ${p.source}, quindi viene disegnata con i colori originali: ${p.detail}`,
};
