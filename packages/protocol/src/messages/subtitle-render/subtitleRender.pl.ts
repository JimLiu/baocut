import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const pl: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `Nie można ustalić kotwicy początku elementu ${p.element}; pominięto`,
  sourceSkipped: (p) => `Podgląd pominął źródło multimediów ${p.source} i jego elementy: ${p.detail}`,
  stickerAssetNoSource: (p) => `Naklejka z zasobu ${p.element} nie ma srcId; zarejestruj ją w źródłach osi czasu (naklejki z szablonu używają source=template z templateId)`,
  missingFont: (p) => `Czcionki „${p.family}” nie ma w bibliotece czcionek; zamiast niej używana jest ${p.fallback}`,
  stickerRecolorFailed: (p) => `Nie udało się zmienić kolorów źródła naklejki ${p.source}, więc jest rysowane w oryginalnych kolorach: ${p.detail}`,
};
