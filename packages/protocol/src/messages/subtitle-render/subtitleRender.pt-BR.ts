import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const ptBR: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `A âncora inicial do elemento ${p.element} não pode ser resolvida; ignorado`,
  sourceSkipped: (p) => `A prévia ignorou a fonte de mídia ${p.source} e seus elementos: ${p.detail}`,
  stickerAssetNoSource: (p) => `O adesivo de recurso ${p.element} não tem srcId; registre-o nas fontes da linha do tempo (adesivos de modelo usam source=template com um templateId)`,
  missingFont: (p) => `A fonte "${p.family}" não está na biblioteca de fontes; usando ${p.fallback} no lugar`,
  stickerRecolorFailed: (p) => `Não foi possível recolorir a fonte de adesivo ${p.source}, então ela é desenhada com as cores originais: ${p.detail}`,
};
