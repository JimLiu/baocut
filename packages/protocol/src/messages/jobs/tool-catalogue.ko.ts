import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const ko: JobsToolCatalogueMessages = {
  transcribeLabel: '전사',
  transcribeDescription:
    '로컬 미디어 파일이나 Space의 영상을 전사합니다. 영상이면 새 전사본을 쓰고 자막 레이어를 만들며, 파일만 있으면 TXT와 SRT를 저장 위치에 쓰거나 새 영상을 만들 수 있습니다.',
  translateSubtitlesLabel: '자막 번역',
  translateSubtitlesDescription:
    '영상의 전사본을 문장별로 다른 언어로 번역해 새 번역으로 영상에 씁니다. SRT / VTT 자막 파일(로컬 파일 또는 Space의 자막 항목)을 새 자막 파일로 번역할 수도 있습니다.',
  dubLabel: '번역 더빙',
  dubDescription:
    '전사본을 바탕으로 대상 언어의 음성을 문장별로 합성하고(번역본이 없으면 먼저 번역), 타이밍을 맞춰 새 더빙 그룹으로 영상에 씁니다.',
  synthesizeSpeechLabel: '음성 생성',
  synthesizeSpeechDescription:
    '텍스트로 음성을 합성합니다. 결과는 오디오 결과물입니다. Space의 문서나 자막 항목(타임코드 없는 자막)을 읽을 수도 있습니다.',
  generateTextLabel: '텍스트 생성',
  generateTextDescription:
    '프롬프트로 텍스트를 생성합니다(JSON Schema를 따르게 할 수도 있음). 결과는 텍스트 결과물입니다. Space의 문서나 자막 항목을 자료로 첨부할 수 있습니다.',
  generateImageLabel: '이미지 생성',
  generateImageDescription: '설명으로 이미지를 생성합니다. 결과는 이미지 결과물입니다.',
  linkImportLabel: '영상 다운로드',
  linkImportDescription:
    'yt-dlp로 영상을 이 컴퓨터에 다운로드합니다. 브라우저 쿠키를 사용할 수 있으며, 다운로드한 영상을 전사해 전사본과 자막을 만들 수 있습니다.',
  compressVideoLabel: '영상 압축',
  compressVideoDescription:
    '영상 파일을 하나씩 압축합니다: 파일에서 파일로 처리하며 영상은 만들지 않고, 결과물이 기존 파일을 덮어쓰지 않습니다.',
  mergeVideoLabel: '영상 합치기',
  mergeVideoDescription:
    '여러 영상 파일을 순서대로 하나로 합칩니다: 파일에서 파일로 처리하며 영상은 만들지 않고, 결과물이 기존 파일을 덮어쓰지 않습니다.',
  extractAudioLabel: '오디오 추출',
  extractAudioDescription:
    '영상이나 오디오 파일에서 오디오 트랙을 꺼냅니다. 일반적인 컨테이너에 맞는 코덱은 그대로 복사하고, 나머지는 AAC로 다시 인코딩합니다. 파일에서 파일로 처리하며 영상은 만들지 않고, 결과물이 기존 파일을 덮어쓰지 않습니다.',
};
