import type { TimelineRenderMessages } from './timelineRender.ts';

export const nl: TimelineRenderMessages = {
  shapeUnknown: (p) => `Element ${p.element} gebruikt vorm ${p.shape}, die niet geregistreerd is; overgeslagen`,
  shapeInvisible: (p) => `Vorm ${p.shape} van element ${p.element} heeft geen vulling en geen lijn, dus er wordt niets getekend`,
  stickerTemplateMissing: (p) => `Element ${p.element} is een sjabloonsticker zonder templateId; overgeslagen`,
  stickerTemplateUnknown: (p) => `Element ${p.element} gebruikt stickersjabloon ${p.template}, dat niet geregistreerd is; overgeslagen`,
  visualizerStyleUnknown: (p) => `Element ${p.element} gebruikt golfvormstijl ${p.style}, die niet geregistreerd is; overgeslagen`,
  spectrumNotInjected: (p) => `Element ${p.element} heeft geen spectrumspoor; er wordt een tijdelijke aanduiding getekend`,
  spectrumEmpty: (p) => `Het spectrumspoor van element ${p.element} is leeg; er wordt een tijdelijke aanduiding getekend`,
  progressStyleUnknown: (p) => `Element ${p.element} gebruikt voortgangsstijl ${p.style}, die niet geregistreerd is; overgeslagen`,
  confettiStyleUnknown: (p) => `Element ${p.element} gebruikt confettistijl ${p.style}, die niet geregistreerd is; overgeslagen`,
  spectrumUnavailable: (p) => `De ${p.kind}-stijl ${p.style} van element ${p.element} heeft geen spectrumgegevens; er wordt een tijdelijke aanduiding getekend`,
  textureNoSource: (p) => `De externe textuur van element ${p.element} heeft geen srcId`,
  textureSizeInvalid: (p) => `De externe textuur van element ${p.element} heeft een ongeldige grootte (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `Het mediavak van element ${p.element} heeft een ongeldige grootte`,
  effectsOffGpu: (p) => `De media-effecten van element ${p.element} kunnen niet in de GPU-textuurscène draaien (${p.detail}); ze worden getekend met de gedeelde CPU-effectstapel`,
  cornerRadiiOffGpu: (p) => `Afronding per hoek van element ${p.element} wordt nog niet ondersteund in de GPU-textuurscène; er wordt getekend met de gedeelde CPU-effectstapel`,
  tileNodesOverLimit: (p) => `De betegelde media van element ${p.element} hebben ${p.count} textuurknooppunten nodig, meer dan de realtimelimiet van ${p.limit}; er wordt op de host getekend`,
};
