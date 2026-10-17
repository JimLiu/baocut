import type { TimelineRenderMessages } from './timelineRender.ts';

export const de: TimelineRenderMessages = {
  shapeUnknown: (p) => `Element ${p.element} verwendet die Form ${p.shape}, die nicht registriert ist; übersprungen`,
  shapeInvisible: (p) => `Die Form ${p.shape} von Element ${p.element} hat weder Füllung noch Kontur, daher wird nichts gezeichnet`,
  stickerTemplateMissing: (p) => `Element ${p.element} ist ein Vorlagen-Sticker ohne templateId; übersprungen`,
  stickerTemplateUnknown: (p) => `Element ${p.element} verwendet die Sticker-Vorlage ${p.template}, die nicht registriert ist; übersprungen`,
  visualizerStyleUnknown: (p) => `Element ${p.element} verwendet den Wellenform-Stil ${p.style}, der nicht registriert ist; übersprungen`,
  spectrumNotInjected: (p) => `Element ${p.element} hat keine Spektrumspur; es wird ein Platzhalter gezeichnet`,
  spectrumEmpty: (p) => `Die Spektrumspur von Element ${p.element} ist leer; es wird ein Platzhalter gezeichnet`,
  progressStyleUnknown: (p) => `Element ${p.element} verwendet den Fortschrittsstil ${p.style}, der nicht registriert ist; übersprungen`,
  confettiStyleUnknown: (p) => `Element ${p.element} verwendet den Konfetti-Stil ${p.style}, der nicht registriert ist; übersprungen`,
  spectrumUnavailable: (p) => `Der ${p.kind}-Stil ${p.style} von Element ${p.element} hat keine Spektrumdaten; es wird ein Platzhalter gezeichnet`,
  textureNoSource: (p) => `Die externe Textur von Element ${p.element} hat keine srcId`,
  textureSizeInvalid: (p) => `Die externe Textur von Element ${p.element} hat eine ungültige Größe (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `Die Medienbox von Element ${p.element} hat eine ungültige Größe`,
  effectsOffGpu: (p) => `Die Medieneffekte von Element ${p.element} können nicht in der GPU-Texturszene laufen (${p.detail}); sie werden mit dem gemeinsamen CPU-Effektstapel gezeichnet`,
  cornerRadiiOffGpu: (p) => `Eckradien pro Ecke von Element ${p.element} werden in der GPU-Texturszene noch nicht unterstützt; es wird mit dem gemeinsamen CPU-Effektstapel gezeichnet`,
  tileNodesOverLimit: (p) => `Die gekachelten Medien von Element ${p.element} benötigen ${p.count} Texturknoten, mehr als das Echtzeitlimit von ${p.limit}; es wird auf dem Host gezeichnet`,
};
