import type { TimelineRenderMessages } from './timelineRender.ts';

export const ko: TimelineRenderMessages = {
  shapeUnknown: (p) => `요소 ${p.element}의 도형 "${p.shape}"이(가) 등록되어 있지 않아 건너뛰었습니다`,
  shapeInvisible: (p) => `요소 ${p.element}의 도형 "${p.shape}"에 채우기도 윤곽선도 없어 아무것도 그려지지 않습니다`,
  stickerTemplateMissing: (p) => `요소 ${p.element}은(는) 템플릿 스티커지만 templateId가 없어 건너뛰었습니다`,
  stickerTemplateUnknown: (p) => `요소 ${p.element}의 스티커 템플릿 "${p.template}"이(가) 등록되어 있지 않아 건너뛰었습니다`,
  visualizerStyleUnknown: (p) => `요소 ${p.element}의 파형 스타일 "${p.style}"이(가) 등록되어 있지 않아 건너뛰었습니다`,
  spectrumNotInjected: (p) => `요소 ${p.element}에 스펙트럼 트랙이 없어 자리 표시자를 그립니다`,
  spectrumEmpty: (p) => `요소 ${p.element}의 스펙트럼 트랙이 비어 있어 자리 표시자를 그립니다`,
  progressStyleUnknown: (p) => `요소 ${p.element}의 진행률 스타일 "${p.style}"이(가) 등록되어 있지 않아 건너뛰었습니다`,
  confettiStyleUnknown: (p) => `요소 ${p.element}의 색종이 스타일 "${p.style}"이(가) 등록되어 있지 않아 건너뛰었습니다`,
  spectrumUnavailable: (p) => `요소 ${p.element}의 ${p.kind} 스타일 "${p.style}"에 스펙트럼 데이터가 없어 자리 표시자를 그립니다`,
  textureNoSource: (p) => `요소 ${p.element}의 외부 텍스처에 srcId가 없습니다`,
  textureSizeInvalid: (p) => `요소 ${p.element}의 외부 텍스처 크기가 올바르지 않습니다(${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `요소 ${p.element}의 미디어 상자 크기가 올바르지 않습니다`,
  effectsOffGpu: (p) => `요소 ${p.element}의 미디어 효과를 GPU 텍스처 장면에서 실행할 수 없어(${p.detail}) 공유 CPU 효과 스택으로 그립니다`,
  cornerRadiiOffGpu: (p) => `요소 ${p.element}의 모서리별 둥글기는 아직 GPU 텍스처 장면에서 지원되지 않아 공유 CPU 효과 스택으로 그립니다`,
  tileNodesOverLimit: (p) => `요소 ${p.element}의 타일 미디어에 텍스처 노드 ${p.count}개가 필요해 실시간 한도 ${p.limit}을(를) 넘으므로 호스트에서 그립니다`,
};
