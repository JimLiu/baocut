import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

function secondsLabel(seconds: number): string {
  return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)}초` : `${Math.round(seconds)}초`;
}

export const koSeconds = secondsLabel;

export const koTranscript: TranscriptMessages = {
  title: '전사본',
  modes: '전사본 편집 모드',
  modeEdit: '텍스트 편집',
  modeCut: '미디어 잘라내기',
  hintEdit: '전사된 텍스트만 바꾸며, 영상과 오디오는 그대로입니다. 단어를 더블클릭해 편집하고, ⌫는 텍스트만 삭제합니다.',
  hintCut: '텍스트를 선택하고 ⌫를 누르면 영상, 오디오, 자막에서 함께 잘라냅니다. 잘라낸 단어는 취소선으로 남아 있어 복원할 수 있습니다.',

  emptyTitle: '아직 전사본이 없습니다',
  emptyNoMedia: '먼저 영상이나 오디오 파일을 추가하세요. 전사하면 말한 내용이 여기에 나타납니다.',
  emptyNotPlaced: '영상이나 오디오가 아직 타임라인에 없습니다. 타임라인에 배치하고 전사하면 전사본이 여기에 나타납니다.',
  emptyNotTranscribed: '타임라인의 소재를 아직 전사하지 않았습니다. 자막 패널에서 전사하면 전사본이 여기에 나타납니다.',
  gotoSubtitle: '자막 패널에서 전사',
  addMedia: '미디어 추가',
  loading: '전사본을 불러오는 중…',
  noWords: '이 전사본에는 표시할 단어가 없습니다.',
  notSpeech: '이 전사본의 형식을 인식할 수 없습니다.',

  stats: (count: number, cut: number) => (cut ? `단어 ${count}개 · ${cut}개 잘라냄` : `단어 ${count}개`),
  jump: '여기로 이동',
  cutWordTitle: '타임라인에서 잘라냄',
  partialWordTitle: '이 단어 안에 컷이 있어 일부만 타임라인에 남아 있습니다',

  // 选区条
  selected: (count: number, seconds: number | null) =>
    seconds === null ? `단어 ${count}개 선택됨` : `단어 ${count}개 선택됨 · ${secondsLabel(seconds)}`,
  cut: '잘라내기',
  restore: '복원',
  editWord: '단어 편집',
  deleteText: '텍스트 삭제',
  clear: '선택 해제 · Esc',
  aiFind: '컷 찾기',
  aiFindHint: '또는 AI가 먼저 군더더기 말과 쉼을 찾게 하세요',

  // 结果
  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `${secondsLabel(seconds)} 잘라냄 · 구간 ${ranges}개` : `${secondsLabel(seconds)} 잘라냄`,
  cutNothing: '선택한 단어가 더 이상 타임라인에 없어 잘라낼 것이 없습니다.',
  cutTooShort: '선택 범위가 한 프레임보다 짧아 잘라낼 수 없습니다.',
  restoreDone: (seconds: number) => `${secondsLabel(seconds)} 복원됨`,
  restoreNotRelaid: '일부 컷은 타임라인에 맞는 이음매가 없습니다. 컷 목록에서는 제거했지만 내용은 되돌리지 않았습니다.',
  restoreRefused: {
    untracked:
      '이 구간은 컷으로 제거된 것이 아니어서(예: 클립 가장자리를 끌어 트림한 경우) 복원할 컷이 없습니다. 타임라인에서 클립 가장자리를 끌어 되돌리세요.',
    partial: '이 구간은 일부만 컷으로 제거되어 범위를 바꿀 수 없습니다. 먼저 컷 밴드를 클릭해 그 부분을 복원하세요.',
  },
  textSaved: '텍스트 업데이트됨 · 영상과 오디오는 그대로',
  textDeleted: (count: number) => `단어 ${count}개의 텍스트를 삭제했습니다 · 영상과 오디오는 그대로`,
  stale: (count: number) => `자막 트랙 ${count}개가 이전 전사본으로 만들어져 업데이트되지 않았습니다.`,
  gotoCaptions: '자막 열기',
  undo: '실행 취소',

  // 时间线剪口
  seamLabel: (seconds: number) => `${secondsLabel(seconds)} 잘라냄 · 클릭해 복원`,
  cutLabel: '전사본에서 잘라내기',
  restoreLabel: '잘라낸 내용 복원',
  liveCopy: '지금까지 전사된 부분 복사',
  liveCopied: '지금까지 전사된 부분을 복사했습니다 · 전사가 계속 진행 중입니다',
  liveSpeaker: '인식 중',
  liveWaiting: '인식된 텍스트가 도착하는 대로 여기에 표시됩니다. 일부 서비스는 끝난 뒤 한꺼번에 반환합니다.',
  liveNote: '인식된 텍스트가 단락별로 표시됩니다. 전사가 끝나면 편집할 수 있습니다.',
  liveJump: '최신으로 이동',
  liveSaving: '전사본 저장 중',
};

export const koTranscriptTools: TranscriptToolsMessages = {
  // 查找替换
  findTip: '찾기 및 바꾸기 · ⌘F',
  findLabel: '찾기 및 바꾸기',
  findPlaceholder: '전사본에서 찾기',
  lockTranslation: '번역은 여기서 검색만 할 수 있고 편집할 수 없습니다. 전사본 패널은 원문만 편집합니다',
  lockLoading: '이 전사본의 새 버전을 아직 불러오는 중입니다. 다 불러온 뒤에 바꾸세요',
  replaceLabel: '전사본 텍스트 바꾸기',
  replaceDone: (count: number) => `일치 항목 ${count}개를 바꿨습니다 · 영상과 오디오는 그대로`,
  replaceNothing: '바꿀 일치 항목이 없습니다',

  // 复制
  copyMenu: '전사본 복사',
  copyAllHead: (lang: string) => `전체 복사 · ${lang}`,
  copyText: '텍스트 복사',
  copySettings: '복사 설정',
  copyWithSettings: '복사 설정대로',
  copyTextOnly: '텍스트만 복사',
  textOnly: '텍스트만',
  keepCut: '잘라낸 부분 포함',
  copyConfirm: '복사',
  copyTranslationOnly: '번역만 보는 중에는 패널 내용으로 복사합니다. 문서 앞 메타 정보는 쓰지 않고 잘라낸 부분은 빠집니다.',
  copyScopeHead: (scope: string) => `${scope} 복사`,
  copied: (scope: string, receipt: string) => `${scope} 복사됨 · ${receipt}`,
  copyFailed: '복사하지 못했습니다 · 브라우저가 클립보드 접근을 거부했습니다',
  copyEmpty: '복사할 내용이 없습니다',
  scopeAll: '전체',
  scopePara: '이 단락',
  scopeChapter: (title: string) => `“${title}”`,
  scopeSelection: '선택한 텍스트',
  copySelection: '복사',
  copySelectionTip: '선택한 텍스트 복사 · ⌘C',

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: '전사본 언어',
  langSource: '원문',
  langTranslation: '번역',
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: '원문 함께 표시',
  showBothNeedsTranslation: '먼저 번역을 선택하세요',
  showBothHint: '나란히 보기',
  noTranslation: '아직 번역이 없습니다',
  noTranslationHint: '자막 패널에서 “+ 번역하기…”로 번역하세요',
  translationNote: '번역은 단락 단위로만 재생을 따라갑니다. 단어 타이밍은 원문에만 있어서 단어 단위로 강조하면 지어낸 타이밍이 됩니다.',
  translationOnly: '번역만 보는 동안에는 편집하거나 잘라낼 수 없습니다. 편집하려면 원문이나 나란히 보기로 전환하세요.',
  noParagraphTranslation: '이 단락에는 번역이 없습니다',

  // 段落行（设计稿 `ParaRow`）
  paraMenu: '이 단락…',
  moveUp: '이전 챕터로 이동',
  moveDown: '다음 챕터로 이동',
  play: '단락 재생',
  moveHead: '챕터로 이동',
  moveTo: (title: string) => `“${title}” 챕터로 이동`,
  moveWith: (count: number) => (count > 1 ? `같은 쪽 인접 단락과 함께 단락 ${count}개가 모두 이동합니다` : '이 단락만 이동합니다'),
  noPrev: '이 단락 앞에는 챕터가 없습니다',
  noNext: '이 단락 뒤에는 챕터가 없습니다',
  moveBlocked: '옮기면 이 챕터가 비거나 인접 챕터의 시작점을 넘어갑니다',
  moveLabel: '단락을 인접 챕터로 이동',
  moved: (title: string, count: number) => (count > 1 ? `단락 ${count}개를 “${title}” 챕터로 옮겼습니다` : `“${title}” 챕터로 옮겼습니다`),
  cutPara: '이 단락 잘라내기',
  cutParaHint: '영상, 오디오, 자막을 함께 잘라내며 복원할 수 있습니다',

  // 章节头「这一章…」
  chapterMenu: '이 챕터…',
  renameChapter: '이름 변경…',
  cutChapter: '이 챕터 잘라내기',
  cutChapterHint: '영상, 오디오, 자막을 함께 잘라내며 뒤쪽 챕터가 앞으로 당겨집니다',
  cutChapterLabel: '챕터 잘라내기',
  cutChapterRefused: {
    empty: '이 챕터는 길이가 없습니다',
    whole: '이 챕터가 영상 전체라서 잘라내면 아무것도 남지 않습니다',
    'no-tracks': '타임라인에 전사한 소재를 쓰는 트랙이 없어 잘라낼 것이 없습니다',
  },
  cutChapterDone: (title: string, seconds: number) => `“${title}” 잘라냄 · ${secondsLabel(seconds)}`,
  removeMarker: '챕터 마커 삭제',
  removeMarkerHint: '마커만 삭제하며 내용은 그대로 둡니다',
  find: '찾기',
  badRegex: '잘못된 정규식',
  noResults: '결과 없음',
  previous: '이전',
  next: '다음',
  closeFind: '찾기 닫기',
  replaceWith: '바꿀 내용',
  matchCase: '대소문자 구분',
  wholeWordShort: '단어',
  wholeWord: '단어 단위로 일치',
  regex: '정규식 · 바꿀 텍스트는 그대로 삽입됩니다',
  replace: '바꾸기',
  replaceAll: '모두 바꾸기',
  regexError: (error: string) => `정규식 오류: ${error}`,
};
