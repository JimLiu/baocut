import type { EngineHostMessages } from './engineHost.ts';

export const ko: EngineHostMessages = {
  runGenerationNotInteger: 'runGeneration은 10진 정수여야 합니다',
  secondsInvalid: (p) => `${p.field} 값은 0 이상의 유한한 초 값이어야 합니다`,
  secondsOverflow: (p) => `${p.field} 값이 범위를 벗어났습니다`,
  audioItemsKind: 'audioItems는 audio와 video 계획에만 쓸 수 있습니다',
  skipAssetsKind: 'skipAssets는 video 계획에만 쓸 수 있습니다',
  outputKind: 'output은 video 계획에만 쓸 수 있습니다',
  outputSize: '출력 너비와 높이는 양의 정수여야 합니다',
  tooManyRanges: (p) => `한 번에 최대 ${p.max}개 범위까지 가능합니다`,
  textPlanNoDocument: 'text 계획에는 문서가 하나 이상 필요합니다',
  textPlanTooManyDocuments: 'text 계획에는 문서를 최대 두 개까지 쓸 수 있습니다(주 문서와 이중 언어 병합의 다른 문서)',
  planKindUnknown: (p) => `알 수 없는 계획 종류 ${p.kind}`,
  unknownMethod: (p) => `알 수 없는 메서드: ${p.method}`,
  paramsInvalid: (p) => `잘못된 매개변수: ${p.error}`,
  fontFacesInvalid: (p) =>
    `face를 1~${p.max}개 지정하세요: 패밀리 이름은 비어 있지 않고 200자 이하, 굵기는 1~1000 사이여야 합니다`,
  cacheDirRelative: 'cacheDir은 절대 경로여야 합니다',
  fontPathRelative: 'path는 절대 경로여야 합니다',
  fontInvalid: (p) => `사용할 수 있는 글꼴 파일이 아닙니다: ${p.error}`,
  videoPathRelative: '영상 경로는 절대 경로여야 합니다',
  videoNotOpen: '영상이 열려 있지 않습니다',
  taskStopped: '이번 실행이 중지되어 변경 사항이 커밋되지 않았습니다',
  afterNotInteger: 'after는 10진 정수여야 합니다',
  enginePanic: '엔진이 요청을 처리하다 실패해 변경 사항이 커밋되지 않았습니다',
  pathRelative: '경로는 절대 경로여야 합니다',
};
