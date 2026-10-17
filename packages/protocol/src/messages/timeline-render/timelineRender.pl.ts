import type { TimelineRenderMessages } from './timelineRender.ts';

export const pl: TimelineRenderMessages = {
  shapeUnknown: (p) => `Element ${p.element} używa kształtu ${p.shape}, który nie jest zarejestrowany; pominięto`,
  shapeInvisible: (p) => `Kształt ${p.shape} elementu ${p.element} nie ma ani wypełnienia, ani obrysu, więc nic nie jest rysowane`,
  stickerTemplateMissing: (p) => `Element ${p.element} to naklejka z szablonu bez templateId; pominięto`,
  stickerTemplateUnknown: (p) => `Element ${p.element} używa szablonu naklejki ${p.template}, który nie jest zarejestrowany; pominięto`,
  visualizerStyleUnknown: (p) => `Element ${p.element} używa stylu fali ${p.style}, który nie jest zarejestrowany; pominięto`,
  spectrumNotInjected: (p) => `Element ${p.element} nie ma ścieżki spektrum; rysowany jest symbol zastępczy`,
  spectrumEmpty: (p) => `Ścieżka spektrum elementu ${p.element} jest pusta; rysowany jest symbol zastępczy`,
  progressStyleUnknown: (p) => `Element ${p.element} używa stylu postępu ${p.style}, który nie jest zarejestrowany; pominięto`,
  confettiStyleUnknown: (p) => `Element ${p.element} używa stylu konfetti ${p.style}, który nie jest zarejestrowany; pominięto`,
  spectrumUnavailable: (p) => `Styl ${p.kind} ${p.style} elementu ${p.element} nie ma danych spektrum; rysowany jest symbol zastępczy`,
  textureNoSource: (p) => `Zewnętrzna tekstura elementu ${p.element} nie ma srcId`,
  textureSizeInvalid: (p) => `Zewnętrzna tekstura elementu ${p.element} ma nieprawidłowy rozmiar (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `Pole multimediów elementu ${p.element} ma nieprawidłowy rozmiar`,
  effectsOffGpu: (p) => `Efekty multimediów elementu ${p.element} nie mogą działać w scenie tekstur GPU (${p.detail}); są rysowane wspólnym stosem efektów CPU`,
  cornerRadiiOffGpu: (p) => `Osobne promienie narożników elementu ${p.element} nie są jeszcze obsługiwane w scenie tekstur GPU; rysowanie wspólnym stosem efektów CPU`,
  tileNodesOverLimit: (p) => `Kafelkowe multimedia elementu ${p.element} wymagają ${p.count} węzłów tekstur, ponad limit czasu rzeczywistego ${p.limit}; rysowanie na hoście`,
};
