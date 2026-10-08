import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const ko: ToolTargetsMessages = {
  unknownLanguage: '알 수 없는 언어',
  langCount: (label, count) => `${label} ×${count}`,
  joinLangs: (labels) => labels.join(', '),
  tagTranscript: (langs) => `전사본 · ${langs}`,
  tagTranslation: (langs) => `번역 · ${langs}`,
  tagDub: (langs) => `더빙 · ${langs}`,
  tagPending: '아직 내용을 읽는 중입니다. 시작할 때 전사본을 선택합니다',
  blockTranscribing: '지금 전사 중입니다. 끝나면 다시 전사할 수 있습니다',
  blockQueued: '이미 전사 대기 중입니다',
  blockTranscribingWait: '지금 전사 중입니다. 끝나면 선택할 수 있습니다',
  blockQueuedWait: '전사 대기 중입니다. 전사가 끝나면 선택할 수 있습니다',
  blockFailed: '마지막 전사에 실패했습니다. 먼저 다시 전사하세요',
  blockNoTranscript: '아직 전사본이 없습니다. 먼저 전사하세요',
  duplicateTranscript: (langs) =>
    `이 영상에는 이미 ${langs} 전사본이 있습니다. 기본값은 새 영상을 만드는 것이며 이 영상과 번역은 그대로 둡니다. '이 영상의 전사본 대체'를 고르면 현재 전사본을 바꾸고, 번역은 원문을 짝지어 이어 가며 원문이 바뀐 문장은 오래된 번역으로 표시합니다. 한 번에 실행 취소할 수 있습니다.`,
  duplicateTranslation: (lang) =>
    `이 영상에는 이미 ${lang} 번역이 있습니다. 이번에 하나 더 추가되고 기존 번역은 유지됩니다. 어느 것을 쓸지는 편집기에서 선택하세요.`,
  duplicateDub: (lang) => `이 영상에는 이미 ${lang} 더빙이 있습니다. 이번에 한 세트가 더 추가되고 기존 더빙은 유지됩니다.`,
  duplicateTitle: {
    transcribe: '이미 전사본이 있습니다',
    'translate-subtitles': '기존 번역은 유지됩니다',
    dub: '기존 더빙은 유지됩니다',
  },
  translationOption: (lang, nth) => `${lang} 번역${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang) => `${lang} 전사본에서 번역`,
  destNewVideo: '새 영상',
  destNewVideoNote: '같은 프로젝트에 같은 소재를 연결한 새 영상을 만듭니다. 이 영상과 번역은 그대로입니다',
  destReplace: '이 영상의 전사본 대체',
  destReplaceNote: '현재 전사본을 바꾸고 번역, 자막, 더빙을 한 번의 변경으로 이어 갑니다. 실행 취소할 수 있습니다',
  newVideoName: (name) => `${name} · 다시 전사`,
  impactTranslation: (lang, units) => `${lang} · ${units}문장`,
  impactDub: (lang, groups) => `${lang} · ${groups}세트 · 번역이 그대로인 문장의 더빙은 유지하고 어긋날 수 있다고 표시`,
  impactRule:
    "원문이 그대로인 문장은 번역과 검토 상태를 유지하고 정렬은 문장 단위로 바뀝니다. 원문이 바뀌었거나 짝지을 수 없는 문장은 오래된 번역으로 표시되며, 완료 후 '오래된 번역 새로 고침'으로 다시 번역합니다. 정확한 문장 수는 결과에 나옵니다.",
  impactUndo: '한 번의 변경이며 실행 취소할 수 있습니다',
};
