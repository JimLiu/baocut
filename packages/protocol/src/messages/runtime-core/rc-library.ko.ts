import type { RcLibraryMessages } from './rc-library.ts';

export const ko: RcLibraryMessages = {
  problemSeparator: '; ',
  referenceUndecodable: (p) => `참조 녹음을 디코딩할 수 없습니다: ${p.problems}`,
  clonesNotReady: '목소리 복제가 아직 준비되지 않았습니다',
  entryHasNoFile: '이 항목에는 파일이 없습니다',
  notCopyable: (p) =>
    `${p.library === 'glossaries' ? '용어집은' : p.library === 'voices' ? '목소리는' : '색상은'} 영상에 바로 복사할 수 없습니다. 용어집은 전사와 번역 때, 목소리는 음성 합성 때, 색상은 스타일을 편집할 때 선택합니다`,
  captionItemIdsStyleOnly: 'captionItemIds는 자막 스타일에만 적용됩니다',
  addFromLibraryLabel: (p) => `라이브러리에서 “${p.name}” 추가`,
  duplicateGlossaries: (p) => `glossaries.${p.step}에 같은 용어집이 두 번 이상 있습니다`,
  tooManyGlossaries: (p) => `단계마다 용어집을 최대 ${p.max}개까지 사용할 수 있습니다`,
  glossaryWrongStep: (p) =>
    `“${p.name}”은(는) ${p.transcription ? '전사' : '번역'}용 용어집이므로 ${p.transcribeStep ? '전사' : '번역'}에 사용할 수 없습니다`,
  selectionDocumentName: '사용 중인 라이브러리 항목',
  changeSelectionLabel: '사용 중인 라이브러리 항목 변경',
  adoptDefaultsLabel: '라이브러리 기본 항목 사용',
  noDocumentIdAfterWrite: '쓴 뒤 문서 ID를 받지 못했습니다',
  speakerBoundTwice: (p) => `화자 ${p.speakerId}이(가) 두 번 지정되었습니다`,
  noSuchDocument: (p) => `영상에 문서 ${p.documentId}이(가) 없습니다`,
  documentNotSpeech: (p) => `문서 ${p.documentId}의 유형은 ${p.kind}입니다. 화자는 전사본(speech)에만 있습니다`,
  speakerNotInTranscript: (p) => `전사본 ${p.documentId}에 화자 ${p.speakerId}이(가) 없습니다`,
  libraryVoiceNoProvider: '라이브러리 목소리는 더빙에 선택한 공급자의 복제로 바뀝니다. providerId를 전달하지 마세요',
  outputNotFound: '결과물이 없습니다',
  pathNotAbsolute: '파일 경로는 절대 경로여야 합니다',

  serviceClientNoLibraryVoice: '외부 서비스의 클라이언트는 라이브러리의 목소리를 사용할 수 없습니다',
  clonerNotConfigured: (p) => `${p.label} 공급자가 켜져 있지 않거나 키가 없어 목소리를 복제할 수 없습니다`,
  cloneExists: (p) => `목소리 “${p.name}”에는 이미 ${p.label}에 유효한 복제가 있습니다`,
  clonePurpose: (p) => `목소리 “${p.name}” 복제`,
  noClone: '이 목소리에는 이 공급자의 복제가 없습니다',
  remoteCloneNotDeleted: (p) => `${p.label}의 복제를 삭제하지 못해 기록을 유지했습니다: ${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId}에는 목소리 복제 API가 없습니다(현재는 ElevenLabs만 제공)`,
  cloneVersionGone: '복제할 목소리 버전이 더 이상 없습니다',
  oldCloneNotDeleted: (p) => `교체된 이전 복제(${p.voiceId})를 ${p.label}에서 삭제하지 못했습니다: ${p.reason}`,
};
