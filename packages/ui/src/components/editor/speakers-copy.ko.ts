import type { SpeakersMessages } from './speakers-copy.ts';

export const ko: SpeakersMessages = {
  title: '화자 식별',
  back: '뒤로',
  background: '백그라운드에서 실행 중',

  // 设置
  cardTitle: '누가 말하는지 구분',
  cardBody: '성문으로 화자를 다시 식별하고 자막과 전사본에 이름을 붙입니다. 결과를 먼저 검토하며, 적용하기 전에는 아무것도 바뀌지 않습니다.',
  who: '사용',
  local: '기기 내 성문 모델',
  localSub: '이 컴퓨터 밖으로 나가지 않음',
  agent: 'Agent에게 맡기기',
  agentSub: '이 영상의 세션에서 실행',
  scope: '범위',
  scopeAll: '영상 전체',
  scopeLocal: (scope: string) => `기기 내 식별은 영상 전체를 대상으로 합니다. “${scope}” 범위만 식별하려면 Agent에게 맡기세요.`,
  packHint: (size: string | null) =>
    `기기 내 성문 모델${size ? `(약 ${size})` : ''}은 처음 실행할 때 다운로드되며, 그 뒤로는 오프라인에서도 작동합니다.`,
  packDownloading: (pct: number | null) =>
    `기기 내 성문 모델을 다운로드하는 중${pct === null ? '…' : ` · ${pct}%`}. 다운로드가 끝나면 식별을 시작합니다.`,
  packUnlisted: '이 컴퓨터에서 쓸 수 있는 기기 내 성문 모델이 없습니다. Agent만 이 작업을 할 수 있습니다.',
  noSpeech: '이 영상은 아직 전사하지 않았습니다. 먼저 자막 패널에서 전사한 뒤 화자를 식별하세요.',
  manySpeech: '영상에 전사본이 여러 개 있어 첫 번째 전사본을 사용합니다',
  start: '시작',
  startHint: '끝나면 검토 페이지가 열립니다. 적용 전에 확인하는 도구는 이것뿐입니다.',
  readOnly: '영상이 읽기 전용이라 화자를 식별할 수 없습니다.',
  web: '브라우저에서는 화자를 식별할 수 없습니다',
  webBody: '화자 식별은 이 컴퓨터의 기기 내 성문 모델을 사용합니다. BaoCut 데스크톱 앱을 사용하세요.',

  // 运行
  submitting: '제출 중…',
  queued: '대기 중…',
  running: '화자를 식별하는 중…',
  activity: (stage: string) => `기기 내 성문 모델 · ${stage}`,
  runNote: '계속 편집해도 됩니다 · 식별은 백그라운드에서 실행되며, 끝나면 검토 페이지가 열립니다. 전사본을 바로 바꾸지는 않습니다.',
  cancel: '취소',
  cancelled: '화자 식별을 취소했습니다',
  cancelFailed: (message: string) => `취소하지 못했습니다: ${message}`,

  // 确认
  found: (n: number) => `화자 ${n}명을 찾았습니다. 샘플을 들어 보고 누가 누구인지 확인한 뒤, 이름을 클릭해 바꾸고 적용하세요.`,
  same: '화자 경계가 현재 라벨과 같습니다. 적용하면 이름만 바뀝니다.',
  newSpeaker: '새 화자',
  rename: '이름 변경',
  renameLabel: (name: string) => `“${name}” 이름 변경`,
  sentences: (n: number) => `${n}문장`,
  clipOff: '이 문장은 잘라내서 타임라인에 없습니다',
  splitTitle: (n: number) => `번역 ${n}개를 다시 나눕니다. 다시 번역할 필요는 없습니다`,
  splitBody: '화자 경계를 바꾸면 자막 줄이 나뉘는 방식만 달라지고, 번역된 텍스트는 그대로입니다.',
  skipped: (n: number) =>
    `이전 형식의 번역 ${n}개는 다시 나누지 않습니다. 적용한 뒤에는 문장이 맞지 않아 오래된 번역으로 표시됩니다.`,
  apply: '적용',
  applyHint: '적용한 뒤에도 언제든 실행 취소할 수 있습니다.',
  discard: '이 결과 폐기',

  // 收据
  engine: '기기 내 성문 모델',
  undoneReceipt: '실행 취소됨 · 화자 라벨을 복원했습니다',
  undo: '실행 취소',
  redo: '다시 실행',
  again: '다시 식별',
  done: '완료',
  splitDone: (n: number) => `번역 ${n}개를 새 화자 경계에 맞춰 다시 나눴습니다. 다시 번역하지는 않았습니다.`,
  undoneTitle: '실행 취소됨',
  undoneBody: '“다시 식별”로 처음부터 다시 시작할 수 있습니다. 식별 설정은 그대로 유지됩니다.',
  captionsStale: (n: number) => `자막 트랙 ${n}개가 이전 전사본으로 만들어져 업데이트되지 않았습니다.`,
  gotoCaptions: '자막 열기',
  noUndo: '실행 취소할 것이 없습니다. 결과가 현재 라벨과 같습니다.',
  undoFailed: '실행 취소하지 못했습니다',
  redoFailed: '다시 실행하지 못했습니다',

  // 问题
  failed: '화자 식별 실패',
  interrupted: '화자 식별이 중단되었습니다',
  submitFailed: '화자 식별을 시작하지 못했습니다',
  applyFailed: '결과를 적용하지 못했습니다',
  applyStale: '식별 후에 전사본이나 번역이 바뀌었습니다. 다시 식별한 뒤 적용하세요.',
  badResult: '결과를 읽을 수 없습니다. 다시 식별하세요.',
  retry: '다시 시도',
  decide: '백그라운드 작업에서 처리',
  dismiss: '확인',
  chapterScope: (n: number, label: string) => `챕터 ${n} · ${label}`,
  manySpeechNamed: (name: string) => `영상에 전사본이 여러 개 있어 첫 번째 전사본 “${name}”을(를) 사용합니다`,
};
