import type { TimelineRenderMessages } from './timelineRender.ts';

export const tr: TimelineRenderMessages = {
  shapeUnknown: (p) => `${p.element} öğesi kayıtlı olmayan ${p.shape} şeklini kullanıyor; atlandı`,
  shapeInvisible: (p) => `${p.element} öğesinin ${p.shape} şeklinin ne dolgusu ne de konturu var, bu yüzden hiçbir şey çizilmiyor`,
  stickerTemplateMissing: (p) => `${p.element} öğesi templateId olmayan bir şablon çıkartması; atlandı`,
  stickerTemplateUnknown: (p) => `${p.element} öğesi kayıtlı olmayan ${p.template} çıkartma şablonunu kullanıyor; atlandı`,
  visualizerStyleUnknown: (p) => `${p.element} öğesi kayıtlı olmayan ${p.style} dalga formu stilini kullanıyor; atlandı`,
  spectrumNotInjected: (p) => `${p.element} öğesinin spektrum izi yok; yer tutucu çiziliyor`,
  spectrumEmpty: (p) => `${p.element} öğesinin spektrum izi boş; yer tutucu çiziliyor`,
  progressStyleUnknown: (p) => `${p.element} öğesi kayıtlı olmayan ${p.style} ilerleme stilini kullanıyor; atlandı`,
  confettiStyleUnknown: (p) => `${p.element} öğesi kayıtlı olmayan ${p.style} konfeti stilini kullanıyor; atlandı`,
  spectrumUnavailable: (p) => `${p.element} öğesinin ${p.kind} stili ${p.style} için spektrum verisi yok; yer tutucu çiziliyor`,
  textureNoSource: (p) => `${p.element} öğesinin harici dokusunda srcId yok`,
  textureSizeInvalid: (p) => `${p.element} öğesinin harici dokusunun boyutu geçersiz (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `${p.element} öğesinin medya kutusunun boyutu geçersiz`,
  effectsOffGpu: (p) => `${p.element} öğesinin medya efektleri GPU doku sahnesinde çalışamıyor (${p.detail}); ortak CPU efekt yığınıyla çiziliyor`,
  cornerRadiiOffGpu: (p) => `${p.element} öğesinin köşe başına yuvarlamaları GPU doku sahnesinde henüz desteklenmiyor; ortak CPU efekt yığınıyla çiziliyor`,
  tileNodesOverLimit: (p) => `${p.element} öğesinin döşenmiş medyası ${p.count} doku düğümü gerektiriyor, gerçek zamanlı sınır olan ${p.limit} değerini aşıyor; ana makinede çiziliyor`,
};
