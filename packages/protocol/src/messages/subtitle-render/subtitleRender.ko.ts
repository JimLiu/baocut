import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const ko: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `요소 ${p.element}의 시작 앵커를 확인할 수 없어 건너뛰었습니다`,
  sourceSkipped: (p) => `미리보기에서 미디어 소스 ${p.source}와(과) 해당 요소를 건너뛰었습니다: ${p.detail}`,
  stickerAssetNoSource: (p) => `소재 스티커 ${p.element}에 srcId가 없습니다. 타임라인 소스에 등록하세요(템플릿 스티커는 source=template과 templateId를 사용합니다)`,
  missingFont: (p) => `글꼴 "${p.family}"이(가) 글꼴 라이브러리에 없어 ${p.fallback}(으)로 대신합니다`,
  stickerRecolorFailed: (p) => `스티커 소스 ${p.source}의 색을 바꿀 수 없어 원래 색으로 그립니다: ${p.detail}`,
};
