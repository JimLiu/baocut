import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const ko: ToolsGalleryMessages = {
  transcode: '이 컴퓨터에서 인코딩(ffmpeg) · 업로드 없음',
  linkReady: '다운로드 도구 준비됨',
  pipelineMissing: '이 버전의 Runtime에는 아직 이 도구의 파이프라인이 없어 지금은 사용할 수 없습니다',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => `로컬 모델 ${n}개`,
  cloudConnected: (n) => `온라인 공급자 ${n}개 연결됨`,
  noSpeech: '아직 사용할 수 있는 음성 합성 모델이 없습니다',
  noImage: '아직 사용할 수 있는 이미지 생성 모델이 없습니다',
  noText: '아직 사용할 수 있는 텍스트 모델이 없습니다',
};
