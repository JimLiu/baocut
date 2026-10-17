import type { TimelineRenderMessages } from './timelineRender.ts';

export const ptBR: TimelineRenderMessages = {
  shapeUnknown: (p) => `O elemento ${p.element} usa a forma ${p.shape}, que não está registrada; ignorado`,
  shapeInvisible: (p) => `A forma ${p.shape} do elemento ${p.element} não tem preenchimento nem contorno, então nada é desenhado`,
  stickerTemplateMissing: (p) => `O elemento ${p.element} é um adesivo de modelo sem templateId; ignorado`,
  stickerTemplateUnknown: (p) => `O elemento ${p.element} usa o modelo de adesivo ${p.template}, que não está registrado; ignorado`,
  visualizerStyleUnknown: (p) => `O elemento ${p.element} usa o estilo de onda ${p.style}, que não está registrado; ignorado`,
  spectrumNotInjected: (p) => `O elemento ${p.element} não tem faixa de espectro; desenhando um marcador`,
  spectrumEmpty: (p) => `A faixa de espectro do elemento ${p.element} está vazia; desenhando um marcador`,
  progressStyleUnknown: (p) => `O elemento ${p.element} usa o estilo de progresso ${p.style}, que não está registrado; ignorado`,
  confettiStyleUnknown: (p) => `O elemento ${p.element} usa o estilo de confete ${p.style}, que não está registrado; ignorado`,
  spectrumUnavailable: (p) => `O estilo ${p.kind} ${p.style} do elemento ${p.element} não tem dados de espectro; desenhando um marcador`,
  textureNoSource: (p) => `A textura externa do elemento ${p.element} não tem srcId`,
  textureSizeInvalid: (p) => `A textura externa do elemento ${p.element} tem um tamanho inválido (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `A caixa de mídia do elemento ${p.element} tem um tamanho inválido`,
  effectsOffGpu: (p) => `Os efeitos de mídia do elemento ${p.element} não podem rodar na cena de texturas da GPU (${p.detail}); eles são desenhados com a pilha de efeitos de CPU compartilhada`,
  cornerRadiiOffGpu: (p) => `Raios por canto do elemento ${p.element} ainda não são suportados na cena de texturas da GPU; desenhando com a pilha de efeitos de CPU compartilhada`,
  tileNodesOverLimit: (p) => `A mídia em mosaico do elemento ${p.element} precisa de ${p.count} nós de textura, acima do limite em tempo real de ${p.limit}; desenhando no host`,
};
