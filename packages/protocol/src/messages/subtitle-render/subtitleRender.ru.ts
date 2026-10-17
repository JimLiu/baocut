import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const ru: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `Не удаётся определить начальный якорь элемента ${p.element}; пропущен`,
  sourceSkipped: (p) => `Предпросмотр пропустил медиаисточник ${p.source} и его элементы: ${p.detail}`,
  stickerAssetNoSource: (p) => `У стикера-ресурса ${p.element} нет srcId; зарегистрируйте его в источниках таймлайна (стикеры из шаблонов используют source=template и templateId)`,
  missingFont: (p) => `Шрифта «${p.family}» нет в библиотеке шрифтов; вместо него используется ${p.fallback}`,
  stickerRecolorFailed: (p) => `Не удалось перекрасить источник стикера ${p.source}, поэтому он рисуется в исходных цветах: ${p.detail}`,
};
