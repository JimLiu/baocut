import type { TimelineRenderMessages } from './timelineRender.ts';

export const es: TimelineRenderMessages = {
  shapeUnknown: (p) => `El elemento ${p.element} usa la forma ${p.shape}, que no está registrada; se omitió`,
  shapeInvisible: (p) => `La forma ${p.shape} del elemento ${p.element} no tiene relleno ni trazo, así que no se dibuja nada`,
  stickerTemplateMissing: (p) => `El elemento ${p.element} es un sticker de plantilla sin templateId; se omitió`,
  stickerTemplateUnknown: (p) => `El elemento ${p.element} usa la plantilla de sticker ${p.template}, que no está registrada; se omitió`,
  visualizerStyleUnknown: (p) => `El elemento ${p.element} usa el estilo de onda ${p.style}, que no está registrado; se omitió`,
  spectrumNotInjected: (p) => `El elemento ${p.element} no tiene pista de espectro; se dibuja un marcador`,
  spectrumEmpty: (p) => `La pista de espectro del elemento ${p.element} está vacía; se dibuja un marcador`,
  progressStyleUnknown: (p) => `El elemento ${p.element} usa el estilo de progreso ${p.style}, que no está registrado; se omitió`,
  confettiStyleUnknown: (p) => `El elemento ${p.element} usa el estilo de confeti ${p.style}, que no está registrado; se omitió`,
  spectrumUnavailable: (p) => `El estilo ${p.kind} ${p.style} del elemento ${p.element} no tiene datos de espectro; se dibuja un marcador`,
  textureNoSource: (p) => `La textura externa del elemento ${p.element} no tiene srcId`,
  textureSizeInvalid: (p) => `La textura externa del elemento ${p.element} tiene un tamaño no válido (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `La caja multimedia del elemento ${p.element} tiene un tamaño no válido`,
  effectsOffGpu: (p) => `Los efectos multimedia del elemento ${p.element} no pueden ejecutarse en la escena de texturas de GPU (${p.detail}); se dibujan con la pila de efectos de CPU compartida`,
  cornerRadiiOffGpu: (p) => `Los radios por esquina del elemento ${p.element} aún no se admiten en la escena de texturas de GPU; se dibuja con la pila de efectos de CPU compartida`,
  tileNodesOverLimit: (p) => `El contenido en mosaico del elemento ${p.element} necesita ${p.count} nodos de textura, más que el límite en tiempo real de ${p.limit}; se dibuja en el host`,
};
