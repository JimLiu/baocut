import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const tr: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `${p.element} öğesinin başlangıç çapası çözümlenemiyor; atlandı`,
  sourceSkipped: (p) => `Önizleme ${p.source} medya kaynağını ve öğelerini atladı: ${p.detail}`,
  stickerAssetNoSource: (p) => `${p.element} varlık çıkartmasında srcId yok; onu zaman çizelgesi kaynaklarına kaydedin (şablon çıkartmaları templateId ile source=template kullanır)`,
  missingFont: (p) => `"${p.family}" yazı tipi yazı tipi kitaplığında yok; yerine ${p.fallback} kullanılıyor`,
  stickerRecolorFailed: (p) => `${p.source} çıkartma kaynağı yeniden renklendirilemedi, bu yüzden özgün renkleriyle çiziliyor: ${p.detail}`,
};
