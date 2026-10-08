import type { JobsTranslateMessages } from './translate.ts';

export const ko: JobsTranslateMessages = {
  label: '번역',
  description:
    '영상 속 전사본을 문장별로 다른 언어로 번역해 결과를 새 번역본으로 씁니다. 텍스트 모델이 처리하며 Agent는 시작하지 않습니다.',
  stepFreezeSource: '원본 읽기',
  stepTranslate: '번역',
  stepAssemble: '번역본 조립',
  stepWrite: '영상에 쓰기',
  videoNotOpen: '영상이 열려 있지 않습니다',
  noStructuredOutput: (p: { model: string }) => `${p.model} 모델은 구조화된 출력을 지원하지 않아 번역에 사용할 수 없습니다`,
  workerMismatch: 'Speech Worker의 번역이 고정된 원본과 일치하지 않습니다',
  targetLanguageInvalid: 'targetLanguage 매개변수는 BCP 47 언어 태그여야 합니다',
  flagInvalid: (p: { key: string }) => `${p.key} 매개변수는 true 또는 false여야 합니다`,
  bilingualNeedsCaptions: 'bilingual 매개변수는 captions가 true일 때(자막 레이어 추가)만 지정할 수 있습니다',
  noDocument: (p: { documentId: string }) => `영상에 ${p.documentId} 문서가 없습니다`,
  notSpeech: (p: { documentId: string; kind: string }) =>
    `${p.documentId} 문서는 ${p.kind}입니다. 전사본(speech)만 번역할 수 있습니다`,
  noTranscript: '영상에 전사본이 없습니다. 번역하기 전에 전사하세요.',
  multipleTranscripts: '영상에 전사본이 둘 이상 있습니다. documentId로 번역할 전사본을 선택하세요.',
  videoClosed: '영상이 닫혔습니다',
  sourceGone: '원본 문서가 더 이상 영상에 없습니다',
  noSentences: '전사본에 번역할 문장이 없습니다',
  sameLanguage: (p: { source: string; target: string }) =>
    `전사본 언어(${p.source})가 대상 언어(${p.target})와 같아 번역할 필요가 없습니다`,
  workerMissing: 'Speech Worker(speech-worker)를 찾지 못했습니다. 먼저 npm run build:engine을 실행하세요.',
  documentName: (p: { language: string }) => `번역 ${p.language}`,
  videoClosedKept: '영상이 닫혔습니다. 번역본은 결과물에 보관되어 있습니다.',
  sourceChanged:
    '번역 중에 원본 문서가 바뀌어 영상에 아무것도 쓰지 않았습니다. 다시 시도하면 원본 문서의 현재 버전을 번역합니다.',
  transactionLabel: (p: { language: string }) => `${p.language}(으)로 번역`,
  noDocumentId: '번역본을 영상에 썼지만 문서 ID가 반환되지 않았습니다',
  rejected: '영상에 쓰는 트랜잭션이 거부되었습니다. 번역본은 결과물에 보관되어 있습니다.',
};
