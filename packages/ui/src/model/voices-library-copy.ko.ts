import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const ko: VoicesLibraryMessages = {
  consentStatement: '본인의 목소리이거나 화자의 허락을 받았습니다',
  uploading: (label) => `${label}에 업로드 중…`,
  noConsent: '본인 목소리이거나 허락을 받았다고 표시하지 않아 제3자에게 업로드하지 않습니다. 먼저 “편집”에서 동의 문구를 체크하세요.',
  cannotClone: (label) => `이 Runtime은 ${label}에서 복제할 수 없습니다`,
  providerOff: (label, detail) => `${label}은(는) 지금 사용할 수 없습니다${detail ? `(${detail})` : ''}: 먼저 “클라우드 모델”에서 켜고 키를 설정하세요`,
  consentUnstated: '동의 미표시',
  cloned: (label) => `${label}에 복제됨`,
  cloneStale: (label) => `${label} 복제가 오래됨`,
  languageUnknown: '언어 미지정',
  recorded: '앱에서 녹음함',
  imported: '파일에서 가져옴',
  edited: (ago) => `${ago} 수정됨`,
  nameRequired: '목소리 이름을 입력하세요',
  nameTooLong: (max) => `이름은 최대 ${max}자까지 가능합니다`,
  transcriptTooLong: (max) => `전사본은 최대 ${max}자까지 가능합니다`,
  dontKnow: '잘 모름',
  deleteClones: (labels) => `${labels.join(', ')}에 있는 복제를 먼저 삭제합니다. 삭제에 실패하면 목소리는 유지됩니다.`,
  deleteBody: (clones) => `이 목소리를 사용하는 영상은 다음에 생성할 때 기본 목소리로 돌아갑니다. 이미 생성된 더빙에는 영향이 없습니다. ${clones}`.trim(),
  uploadNotice: (name, size, label) =>
    `복제를 만들기 위해 “${name}”의 참조 녹음${size ? `(${size})` : ''}을 ${label}에 업로드합니다. 이후 ${label}에서 이 목소리를 사용하면 해당 공급자의 목소리 ID를 직접 사용하며, 목소리를 삭제하면 이 복제가 먼저 삭제됩니다.`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}. ${remedy}`,
  remedyConsent: '동의 문구가 없는 목소리는 제3자에게 업로드하지 않습니다. 먼저 “편집”에서 동의 문구를 체크하세요.',
  remedyConfigure: '“클라우드 모델”에서 이 공급자를 켜고 키를 설정하세요.',
  remedyConflict: '이 목소리가 방금 다른 곳에서 변경되었습니다. 최신 버전이 아래에 표시되어 있으니 확인한 뒤 저장하세요.',
  remedyGrant: '참조 녹음을 공급자에게 보내려면 외부 전송 허가가 필요합니다. 설정에서 허가를 발급한 뒤 다시 시도하세요.',
};
