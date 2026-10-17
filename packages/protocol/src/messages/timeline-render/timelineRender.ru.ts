import type { TimelineRenderMessages } from './timelineRender.ts';

export const ru: TimelineRenderMessages = {
  shapeUnknown: (p) => `Элемент ${p.element} использует фигуру ${p.shape}, которая не зарегистрирована; пропущен`,
  shapeInvisible: (p) => `У фигуры ${p.shape} элемента ${p.element} нет ни заливки, ни обводки, поэтому ничего не рисуется`,
  stickerTemplateMissing: (p) => `Элемент ${p.element} — стикер из шаблона без templateId; пропущен`,
  stickerTemplateUnknown: (p) => `Элемент ${p.element} использует шаблон стикера ${p.template}, который не зарегистрирован; пропущен`,
  visualizerStyleUnknown: (p) => `Элемент ${p.element} использует стиль волны ${p.style}, который не зарегистрирован; пропущен`,
  spectrumNotInjected: (p) => `У элемента ${p.element} нет дорожки спектра; рисуется заглушка`,
  spectrumEmpty: (p) => `Дорожка спектра элемента ${p.element} пуста; рисуется заглушка`,
  progressStyleUnknown: (p) => `Элемент ${p.element} использует стиль прогресса ${p.style}, который не зарегистрирован; пропущен`,
  confettiStyleUnknown: (p) => `Элемент ${p.element} использует стиль конфетти ${p.style}, который не зарегистрирован; пропущен`,
  spectrumUnavailable: (p) => `У стиля ${p.kind} ${p.style} элемента ${p.element} нет данных спектра; рисуется заглушка`,
  textureNoSource: (p) => `У внешней текстуры элемента ${p.element} нет srcId`,
  textureSizeInvalid: (p) => `У внешней текстуры элемента ${p.element} недопустимый размер (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `У медиаблока элемента ${p.element} недопустимый размер`,
  effectsOffGpu: (p) => `Медиаэффекты элемента ${p.element} не могут работать в сцене GPU-текстур (${p.detail}); они рисуются общим стеком эффектов на CPU`,
  cornerRadiiOffGpu: (p) => `Отдельные радиусы углов элемента ${p.element} пока не поддерживаются в сцене GPU-текстур; рисуется общим стеком эффектов на CPU`,
  tileNodesOverLimit: (p) => `Мозаичному медиа элемента ${p.element} нужно ${p.count} узлов текстур — больше лимита реального времени ${p.limit}; рисуется на хосте`,
};
