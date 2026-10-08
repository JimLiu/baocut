import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const ko: JobsTranslateSubtitlesMessages = {
  label: '자막 파일 번역',
  description:
    'SRT나 WebVTT 자막 파일을 자막 단위로 다른 언어로 번역해 새 자막 파일을 씁니다. 자막 수와 타임코드는 그대로 유지되며, 결과를 이중 언어나 다른 형식으로 만들 수 있습니다. 영상은 건드리지 않습니다.',
  stepRead: '자막 읽기',
  stepTranslate: '번역',
  stepCheck: '확인',
  stepPublish: '게시',
  noStructuredOutput: (p: { model: string }) => `${p.model} 모델은 구조화된 출력을 지원하지 않아 번역에 사용할 수 없습니다`,
  artifactGone: (p: { artifactId: string }) => `${p.artifactId} 결과물이 더 이상 없습니다`,
  paramNotAbsolute: (p: { key: string }) => `${p.key} 매개변수는 절대 경로여야 합니다`,
  inputNotSubtitle: 'input 매개변수는 .srt 또는 .vtt 파일이어야 합니다',
  languageInvalid: (p: { key: string }) => `${p.key} 매개변수는 BCP 47 언어 태그여야 합니다`,
  bilingualInvalid: 'bilingual 매개변수는 true 또는 false여야 합니다',
  fileNotFound: (p: { file: string }) => `자막 파일 ${p.file}을(를) 찾지 못했습니다`,
  fileTooLarge: (p: { bytes: number; limit: number }) =>
    `자막 파일 크기가 ${p.bytes}바이트로 한도인 ${p.limit}바이트를 넘습니다`,
  noText: '자막 파일에 번역할 텍스트가 없습니다',
  allEmpty: '모든 자막이 비어 있습니다',
  markupStripped: (p: { count: number }) =>
    `자막 ${p.count}개에 있던 인라인 마크업(기울임꼴, 색, 위치 등)은 번역에서 유지되지 않았습니다`,
  cueNoTranslation: (p: { n: number }) => `${p.n}번째 자막에 번역이 없습니다`,
  rereadFailed: '쓴 자막을 다시 읽지 못했습니다',
  cueCountMismatch: (p: { written: number; original: number }) =>
    `자막 ${p.written}개를 썼지만 원본 파일에는 ${p.original}개가 있습니다`,
  timingChanged: (p: { n: number; from: string; to: string }) => `${p.n}번째 자막의 타임코드가 바뀌었습니다: ${p.from} → ${p.to}`,
  cannotMatch: '번역을 원본 파일과 일대일로 대응하는 자막으로 쓸 수 없습니다',
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `SRT로 변환했습니다: 자막 ${p.settings}개의 cue 설정과 NOTE, STYLE, REGION 블록 ${p.blocks}개는 맞지 않아 유지하지 않았습니다`,
};
