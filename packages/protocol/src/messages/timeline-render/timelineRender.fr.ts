import type { TimelineRenderMessages } from './timelineRender.ts';

export const fr: TimelineRenderMessages = {
  shapeUnknown: (p) => `L’élément ${p.element} utilise la forme ${p.shape}, qui n’est pas enregistrée ; ignoré`,
  shapeInvisible: (p) => `La forme ${p.shape} de l’élément ${p.element} n’a ni remplissage ni contour : rien n’est dessiné`,
  stickerTemplateMissing: (p) => `L’élément ${p.element} est un sticker de modèle sans templateId ; ignoré`,
  stickerTemplateUnknown: (p) => `L’élément ${p.element} utilise le modèle de sticker ${p.template}, qui n’est pas enregistré ; ignoré`,
  visualizerStyleUnknown: (p) => `L’élément ${p.element} utilise le style de forme d’onde ${p.style}, qui n’est pas enregistré ; ignoré`,
  spectrumNotInjected: (p) => `L’élément ${p.element} n’a pas de piste de spectre ; un espace réservé est dessiné`,
  spectrumEmpty: (p) => `La piste de spectre de l’élément ${p.element} est vide ; un espace réservé est dessiné`,
  progressStyleUnknown: (p) => `L’élément ${p.element} utilise le style de progression ${p.style}, qui n’est pas enregistré ; ignoré`,
  confettiStyleUnknown: (p) => `L’élément ${p.element} utilise le style de confettis ${p.style}, qui n’est pas enregistré ; ignoré`,
  spectrumUnavailable: (p) => `Le style ${p.kind} ${p.style} de l’élément ${p.element} n’a pas de données de spectre ; un espace réservé est dessiné`,
  textureNoSource: (p) => `La texture externe de l’élément ${p.element} n’a pas de srcId`,
  textureSizeInvalid: (p) => `La texture externe de l’élément ${p.element} a une taille non valide (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `La boîte média de l’élément ${p.element} a une taille non valide`,
  effectsOffGpu: (p) => `Les effets média de l’élément ${p.element} ne peuvent pas s’exécuter dans la scène de textures GPU (${p.detail}) ; ils sont dessinés avec la pile d’effets CPU partagée`,
  cornerRadiiOffGpu: (p) => `Les rayons d’angle individuels de l’élément ${p.element} ne sont pas encore pris en charge dans la scène de textures GPU ; dessin avec la pile d’effets CPU partagée`,
  tileNodesOverLimit: (p) => `Le média en mosaïque de l’élément ${p.element} nécessite ${p.count} nœuds de texture, au-delà de la limite temps réel de ${p.limit} ; dessin par l’hôte`,
};
