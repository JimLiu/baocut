import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const fr: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `L’ancre de début de l’élément ${p.element} ne peut pas être résolue ; ignoré`,
  sourceSkipped: (p) => `L’aperçu a ignoré la source média ${p.source} et ses éléments : ${p.detail}`,
  stickerAssetNoSource: (p) => `Le sticker de ressource ${p.element} n’a pas de srcId ; enregistrez-le dans les sources de la timeline (les stickers de modèle utilisent source=template avec un templateId)`,
  missingFont: (p) => `La police « ${p.family} » n’est pas dans la bibliothèque de polices ; ${p.fallback} est utilisée à la place`,
  stickerRecolorFailed: (p) => `Les couleurs de la source de sticker ${p.source} n’ont pas pu être modifiées : elle est dessinée avec ses couleurs d’origine : ${p.detail}`,
};
