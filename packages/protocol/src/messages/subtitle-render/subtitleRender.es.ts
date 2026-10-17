import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const es: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `No se puede resolver el ancla de inicio del elemento ${p.element}; se omitió`,
  sourceSkipped: (p) => `La vista previa omitió la fuente multimedia ${p.source} y sus elementos: ${p.detail}`,
  stickerAssetNoSource: (p) => `El sticker de recurso ${p.element} no tiene srcId; regístralo en las fuentes de la línea de tiempo (los stickers de plantilla usan source=template con un templateId)`,
  missingFont: (p) => `La fuente "${p.family}" no está en la biblioteca de fuentes; se usa ${p.fallback} en su lugar`,
  stickerRecolorFailed: (p) => `No se pudieron cambiar los colores de la fuente de sticker ${p.source}, así que se dibuja con sus colores originales: ${p.detail}`,
};
