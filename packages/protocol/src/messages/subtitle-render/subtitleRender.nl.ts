import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const nl: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `Het beginanker van element ${p.element} kan niet worden bepaald; overgeslagen`,
  sourceSkipped: (p) => `De voorvertoning heeft mediabron ${p.source} en de elementen ervan overgeslagen: ${p.detail}`,
  stickerAssetNoSource: (p) => `Assetsticker ${p.element} heeft geen srcId; registreer hem in de bronnen van de tijdlijn (sjabloonstickers gebruiken source=template met een templateId)`,
  missingFont: (p) => `Lettertype "${p.family}" staat niet in de lettertypebibliotheek; ${p.fallback} wordt gebruikt`,
  stickerRecolorFailed: (p) => `Stickerbron ${p.source} kon niet worden herkleurd en wordt in de oorspronkelijke kleuren getekend: ${p.detail}`,
};
