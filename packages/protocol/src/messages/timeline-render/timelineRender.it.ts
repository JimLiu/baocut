import type { TimelineRenderMessages } from './timelineRender.ts';

export const it: TimelineRenderMessages = {
  shapeUnknown: (p) => `L’elemento ${p.element} usa la forma ${p.shape}, che non è registrata; saltato`,
  shapeInvisible: (p) => `La forma ${p.shape} dell’elemento ${p.element} non ha né riempimento né contorno, quindi non viene disegnato nulla`,
  stickerTemplateMissing: (p) => `L’elemento ${p.element} è uno sticker modello senza templateId; saltato`,
  stickerTemplateUnknown: (p) => `L’elemento ${p.element} usa il modello di sticker ${p.template}, che non è registrato; saltato`,
  visualizerStyleUnknown: (p) => `L’elemento ${p.element} usa lo stile di forma d’onda ${p.style}, che non è registrato; saltato`,
  spectrumNotInjected: (p) => `L’elemento ${p.element} non ha una traccia di spettro; viene disegnato un segnaposto`,
  spectrumEmpty: (p) => `La traccia di spettro dell’elemento ${p.element} è vuota; viene disegnato un segnaposto`,
  progressStyleUnknown: (p) => `L’elemento ${p.element} usa lo stile di avanzamento ${p.style}, che non è registrato; saltato`,
  confettiStyleUnknown: (p) => `L’elemento ${p.element} usa lo stile di coriandoli ${p.style}, che non è registrato; saltato`,
  spectrumUnavailable: (p) => `Lo stile ${p.kind} ${p.style} dell’elemento ${p.element} non ha dati di spettro; viene disegnato un segnaposto`,
  textureNoSource: (p) => `La texture esterna dell’elemento ${p.element} non ha srcId`,
  textureSizeInvalid: (p) => `La texture esterna dell’elemento ${p.element} ha una dimensione non valida (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `Il riquadro multimediale dell’elemento ${p.element} ha una dimensione non valida`,
  effectsOffGpu: (p) => `Gli effetti multimediali dell’elemento ${p.element} non possono essere eseguiti nella scena di texture GPU (${p.detail}); vengono disegnati con lo stack di effetti CPU condiviso`,
  cornerRadiiOffGpu: (p) => `I raggi per angolo dell’elemento ${p.element} non sono ancora supportati nella scena di texture GPU; disegno con lo stack di effetti CPU condiviso`,
  tileNodesOverLimit: (p) => `I contenuti a mosaico dell’elemento ${p.element} richiedono ${p.count} nodi di texture, oltre il limite in tempo reale di ${p.limit}; disegno sull’host`,
};
