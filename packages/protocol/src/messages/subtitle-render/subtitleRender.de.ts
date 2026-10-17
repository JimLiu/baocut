import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const de: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `Der Startanker von Element ${p.element} kann nicht aufgelöst werden; übersprungen`,
  sourceSkipped: (p) => `Die Vorschau hat die Medienquelle ${p.source} und ihre Elemente übersprungen: ${p.detail}`,
  stickerAssetNoSource: (p) => `Der Asset-Sticker ${p.element} hat keine srcId; registriere ihn in den Quellen der Zeitleiste (Vorlagen-Sticker verwenden source=template mit einer templateId)`,
  missingFont: (p) => `Die Schrift „${p.family}“ ist nicht in der Schriftbibliothek; stattdessen wird ${p.fallback} verwendet`,
  stickerRecolorFailed: (p) => `Die Sticker-Quelle ${p.source} konnte nicht umgefärbt werden und wird in ihren Originalfarben gezeichnet: ${p.detail}`,
};
