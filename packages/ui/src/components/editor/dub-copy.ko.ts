import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const koDub: DubMessages = {
  // 设置页
  title: '번역 더빙',
  back: '뒤로',
  web: '번역 더빙은 데스크톱 앱에서 사용할 수 있습니다',
  webBody: '브라우저의 BaoCut은 고정 워크플로(pipelines.*)를 제공하지 않아 여기서는 번역 더빙을 시작할 수 없습니다. 데스크톱 앱에서 이 영상을 여세요.',
  summary: (language: string, count: number | null, translate: boolean) =>
    `${translate ? `먼저 ${language} 번역을 만든 뒤` : `기존 ${language} 번역을 사용해`} ${count === null ? '문장별로' : `문장 ${count}개를 하나씩`} 음성을 합성하고, 각 문장을 원문 문장의 타이밍에 맞춰 하나의 더빙 그룹으로 타임라인에 씁니다`,
  language: '더빙 언어',
  languagePicker: '더빙 언어',
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? '이 언어의 번역이 아직 없음 · 먼저 번역' : '기존 번역 사용 · 새로 번역하지 않음'}${count === null ? '' : ` · 문장 ${count}개`}`,
  allTaken: '더빙할 수 있는 언어가 없습니다.',
  staleNote: (n: number) =>
    `이 번역에서 문장 ${n}개가 오래되었습니다(원문이 바뀌었거나 오래됨으로 표시됨). 이 문장들은 합성하지 않고 요약에 표시합니다. 빠짐없이 더빙하려면 먼저 자막 패널에서 다시 번역하세요.`,
  source: '원문',
  sourcePicker: '더빙할 전사본',
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · 문장 ${count}개`),
  voiceModel: '음성 모델',
  voiceModelPicker: '합성에 사용할 음성 모델',
  voiceModelsLoading: '음성 모델 불러오는 중…',
  manageVoiceModels: '음성 모델 관리…',
  ttsMissingTitle: '아직 사용할 수 있는 음성 모델이 없습니다',
  goTts: '모델 › 음성 합성 열기',
  voice: '기본 목소리',
  voicePicker: '목소리가 지정되지 않은 화자에게 사용',
  voiceDefault: '모델 기본값',
  voiceCustom: '목소리 ID',
  voiceCustomPlaceholder: '공급자 계정의 목소리 ID',
  voiceHint: '아래에서 목소리를 지정한 화자는 그 목소리를 사용하고, 나머지는 여기서 고른 목소리를 사용합니다.',
  voiceCustomEmpty: '먼저 목소리 ID를 입력하거나 다른 목소리를 선택하세요',
  speakers: '화자',
  speakersAside: (n: number) => `${n}명`,
  speakersNone: '이 전사본에는 화자 정보가 없어 모든 문장에 위의 기본 목소리를 사용합니다.',
  speakersNote: '지정 내용은 이 영상에 저장되며(실행 취소할 수 있는 편집) 다음에도 그대로 사용됩니다. 우선순위: 지정 → 기본 목소리 → 모델 기본값.',
  speakerLine: (count: number) => `문장 ${count}개`,
  speakerBinding: (name: string) => `${name}에게 지정된 목소리`,
  bindingNone: '없음',
  bindingOther: (label: string) => `${label}(다른 곳에서 지정)`,
  bindingIgnored: (provider: string) => `지정된 목소리가 다른 공급자의 것이어서 ${provider}에서는 사용하지 않습니다`,
  bindingReadOnly: '영상이 읽기 전용이어서 화자 목소리를 바꿀 수 없습니다.',
  bindingFailed: (message: string) => `화자 목소리를 바꾸지 못했습니다: ${message}`,
  bindingLoading: '화자 목소리 불러오는 중…',
  bindingReadFailed: (message: string) => `이 영상에 지정된 화자 목소리를 읽지 못했습니다: ${message}`,
  bindingSaved: (name: string) => `${name}에게 목소리를 지정했습니다`,
  bindingCleared: (name: string) => `${name}의 목소리 지정을 해제했습니다`,
  sourceVideo: '지정',
  sourceParams: '기본 목소리',
  sourceDefault: '모델 기본값',
  effective: (label: string, source: string | null) => (source ? `사용 중: ${label}(${source})` : `사용 중: ${label}`),
  speakerWarning: (reason: string) => `이 화자의 문장은 합성하지 않습니다: ${reason}`,
  manageVoices: '내 목소리 관리…',
  mix: '믹스',
  separate: '배경음 분리',
  separateHint: '더빙은 말소리만 바꾸고 음악과 주변 소리는 그대로 둡니다',
  separateMissing: '이 컴퓨터에 사용할 수 있는 분리 모델이 없습니다. 켜더라도 분리를 건너뛰고 원본 오디오 전체를 처리합니다.',
  installSeparate: '분리 모델 설치…',
  original: '원본 오디오',
  originalPicker: '더빙이 재생될 때 원본 오디오 처리 방식',
  originalLabel: { duck: '낮추기', mute: '음소거', keep: '유지' },
  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `원본 오디오는 그대로 두고 더빙 아래에서 함께 재생합니다${o.separated ? '. 유지할 때는 분리하지 않습니다' : ''}.`
      : `${o.separated ? '배경음은 별도 트랙으로 나뉘고 원본에는 말소리만 남으며, 이 말소리는' : '분리하지 않으면 원본 오디오 전체가'} ${o.original === 'mute' ? '음소거됩니다' : `−${o.duckDb} dB만큼 낮아집니다`}. 더빙 트랙 헤더에서 언제든 원본 오디오로 다시 전환할 수 있습니다.`,
  duckDb: '낮출 정도(dB)',
  duckLabel: '낮추기',
  duckUnit: 'dB',
  translate: '번역',
  textModel: '텍스트 모델',
  textModelPicker: '번역에 사용할 텍스트 모델',
  textModelsLoading: '텍스트 모델 불러오는 중…',
  manageTextModels: '텍스트 모델 관리…',
  textMissingTitle: '아직 사용할 수 있는 텍스트 모델이 없습니다',
  goLlm: '모델 › 텍스트 생성 열기',
  noStructured: '구조화된 출력 미지원 · 번역에 사용할 수 없음',
  style: '스타일 힌트',
  stylePlaceholder: '예: 구어체, 간결하게. 이름은 원문 그대로',
  styleHint: '선택 사항. 최대 500자.',
  cta: (language: string) => `${language} 더빙`,
  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const tracks = [`“더빙 · ${language}”`];
    if (stems.separated && stems.original !== 'keep') tracks.push('“배경음”');
    if (stems.separated && stems.original === 'duck') tracks.push('“보컬”');
    return `완료되면 타임라인의 ${tracks.join(', ')} 트랙에 쓰며, 클릭 한 번으로 실행 취소할 수 있습니다. 온라인 모델은 호출마다 요금이 부과됩니다.`;
  },
  noSpeechTitle: '아직 더빙할 전사본이 없습니다',
  noSpeech: '더빙은 전사본의 문장 단위로 진행됩니다. 먼저 자막 패널의 “자막 생성”으로 소재를 전사하세요.',
  busy: '이 영상은 이미 더빙이 진행 중입니다. 끝난 뒤 다음 더빙을 시작하세요.',
  readOnly: '영상이 읽기 전용이어서 더빙할 수 없습니다.',

  // 运行态
  submitting: '더빙 제출 중',
  queued: '대기 중',
  running: (language: string) => `더빙 중 · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `${step === 'translate' ? '번역' : '합성'}: 문장 ${done}${total ? ` / ${total}` : ''}개`,
  sentences: (running: number, failed: number) =>
    [running ? `문장 ${running}개 합성 중` : '', failed ? `문장 ${failed}개 실패` : ''].filter(Boolean).join(' · '),
  cancel: '더빙 취소',
  cancelled: '더빙 취소됨',
  cancelFailed: (message: string) => `더빙을 취소하지 못했습니다: ${message}`,
  liveNote: '완료되면 Runtime이 바로 타임라인에 쓰며 언제든 실행 취소할 수 있습니다. 이 페이지를 떠나도 됩니다.',
  foreign: '이 더빙은 여기서 시작하지 않았습니다. 끝나면 타임라인에서 확인하고, 실행 취소는 편집기의 실행 취소를 사용하세요.',

  // 授权
  grantTitle: (recipient: string) => `전사본을 ${recipient}에 보낼 허가가 아직 없습니다`,
  grantBody:
    '더빙은 합성할 번역(번역이 없는 부분은 원문)을 공급자에게 보냅니다. 이 영상으로 한정된 허가를 발급하면 계속 진행하며, 허가가 없으면 아무것도 보내지 않습니다.',
  grantAction: '허가 발급 후 시작',
  grantRetryAction: '허가 발급 후 다시 시도',
  grantDialogTitle: '데이터 공유 허가 발급',
  grantDialogIntro: '확인하면 BaoCut이 이 허가를 기록하고 더빙을 계속합니다:',
  grantConfirm: '발급 후 계속',
  grantCancel: '나중에',
  granting: '허가 발급 중…',
  grantFailed: (message: string) => `허가를 발급하지 못했습니다: ${message}`,
  grantStillRefused: '허가를 발급했지만 여전히 거부되었습니다',
  grantNext: '번역과 합성에 서로 다른 공급자를 쓰면 각각 허가가 필요합니다.',
  commands: '명령줄',

  // 问题
  notConfigured: '아직 더빙을 사용할 수 없습니다',
  submitFailed: '더빙을 시작하지 못했습니다',
  failed: '더빙 실패',
  interrupted: '더빙이 중단되었습니다',
  retry: '다시 시도',
  retryFailed: (message: string) => `다시 시도하지 못했습니다: ${message}`,
  retryCharges:
    '다시 시도하면 멈춘 단계부터 이어서 진행합니다. “번역” 단계에서 멈췄다면 그 단계 전체를 다시 실행하므로, 이미 번역한 배치도 모델을 다시 호출해 요금이 다시 부과될 수 있습니다.',
  retryPartial: '다시 시도하면 “문장 합성”부터 이어서 진행합니다: 합성된 문장은 재사용하고, 실패했거나 남은 문장만 합성합니다.',
  retryFree: '다시 시도하면 멈춘 단계부터 이어서 진행합니다. 앞서 끝난 단계는 모델을 다시 호출하지 않고 재사용합니다.',
  retryFrozen:
    '화자 목소리 지정은 시작할 때 고정되었습니다: 목소리를 고치면(다시 클론, 본인 진술 추가) 다시 시도에 반영되지만, 지정을 바꾸려면 새로 더빙해야 합니다.',
  failedUnits: (n: number) => `문장 ${n}개 합성 실패`,
  stoppedAt: (synthesized: number, remaining: number) => `문장 ${synthesized}개를 합성한 뒤 멈췄습니다. ${remaining}개 남음`,
  dismiss: '확인',

  // 收据
  doneTitle: (language: string) => `${language} 더빙 완료`,
  doneToast: (language: string, placed: number) => `${language} 더빙 완료 · 문장 ${placed}개를 타임라인에 배치`,
  placed: (placed: number, total: number) => `문장 ${placed} / ${total}개를 타임라인에 배치`,
  fitHead: '문장별 결과',
  speakersHead: '화자 목소리',
  speakerUnits: (n: number) => `문장 ${n}개`,
  speakerNone: '화자 없음',
  voiceFailedHead: '이 화자들의 문장은 합성되지 않았습니다',
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · 문장 ${n}개 · ${reason}`,
  voiceFailedFix:
    '이 더빙은 이미 끝나서 다시 시도할 수 없습니다: 이 더빙 그룹 실행 취소 → 목소리 수정(다시 클론, 본인 진술 추가) 또는 지정 변경 → 다시 더빙.',
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [`호출 ${calls}회`, retries ? `재전송 ${retries}회` : '', failures ? `실패 ${failures}회` : '', reused ? `문장 ${reused}개 재사용` : '']
      .filter(Boolean)
      .join(' · '),
  translationCreated: '이번에 새로 만든 번역은 영상에 저장되었습니다(더빙을 실행 취소해도 삭제되지 않음)',
  translationUsed: '기존 번역을 사용했습니다',
  glossaryUsed: (n: number) => `용어집 ${n}개 사용`,
  warnings: '경고',
  undo: '이 더빙 실행 취소',
  undoing: '실행 취소 중…',
  undone: '더빙을 실행 취소했습니다',
  undonePartial:
    '이 더빙의 클립, 음소거, 더킹을 실행 취소했습니다. 빈 더빙 트랙과 더빙 계획 문서는 영상에 남습니다(프로토콜에 트랙이나 문서를 삭제하는 작업이 없음).',
  undoLabel: (language: string) => `더빙 실행 취소(${language})`,
  undoFailed: '이 더빙을 실행 취소하지 못했습니다',
  undoNotOpen: '이 더빙을 실행 취소하려면 먼저 해당 영상을 여세요.',
  close: '닫기',
  again: '다시 더빙',
  providerFallback: '이 공급자',
  unknownLanguage: '알 수 없는 언어',
};

export const koTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `더빙 · ${language}`,
  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? '보컬' : '배경음'} · ${language}`,
  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? ' · 너무 빠름' : ''}`,
  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)}초`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? '음소거됨' : '',
      parts.manual ? '속도를 직접 변경함' : '',
      parts.editable ? '오른쪽 가장자리를 드래그해 길이 변경 · 마우스 오른쪽 클릭으로 더 보기' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  menuLabel: (title: string) => `“${title}” 더빙 메뉴`,
  selection: (n: number) => `문장 ${n}개 선택됨`,
  count: (n: number) => (n > 1 ? `이 문장 ${n}개` : '이 문장'),
  listen: '이 문장 재생',
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)}초${rate ? ` · ${rate}` : ''}`,
  mute: (allMuted: boolean, n: number) => `${n > 1 ? `이 문장 ${n}개` : '이 문장'} ${allMuted ? '음소거 해제' : '음소거'}`,
  muteHint: (allMuted: boolean) => (allMuted ? '이 문장들의 더빙을 되살립니다' : '이 문장들을 무음으로 처리 · 내보내기에도 적용'),
  remove: (n: number) => `${n > 1 ? `이 문장 ${n}개` : '이 문장'} 삭제`,
  removeHint: '더빙 트랙에서 제거 · 실행 취소 가능',
  removeGroup: '이 더빙 그룹 제거',
  removeGroupHint: (bed: boolean) => `${bed ? '배경음과 함께 제거' : '이 언어의 더빙을 모두 제거'} · 이 더빙으로 음소거된 원본 오디오가 복원됨`,
  labelMute: '더빙 음소거',
  labelUnmute: '더빙 음소거 해제',
  labelRemove: '더빙 삭제',
  labelRemoveGroup: (language: string) => `더빙 제거(${language})`,
  labelStretch: '더빙 속도 변경',
  muted: (n: number) => `더빙 문장 ${n}개를 음소거했습니다`,
  unmuted: (n: number) => `더빙 문장 ${n}개의 음소거를 해제했습니다`,
  removed: (n: number) => `더빙 문장 ${n}개를 삭제했습니다`,
  groupRemoved: (language: string) => `“더빙 · ${language}” 그룹을 제거했습니다 · 빈 더빙 트랙과 더빙 계획 문서는 영상에 남습니다`,
  planUnread: '더빙 계획을 읽지 못했습니다: 이 더빙으로 음소거된 원본 오디오를 복원하지 못했습니다. 원본 클립에서 음소거를 해제할 수 있습니다.',
};

export const koDubRegen: DubRegenMessages = {
  // ---- 行头 ⋯ ----
  headMenu: (label: string) => `“${label}” 트랙`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      `문장 ${c.total}개`,
      c.failed ? `${c.failed}개 합성 안 됨` : '',
      c.fast ? `${c.fast}개 너무 빠름` : '',
      c.muted ? `${c.muted}개 음소거됨` : '',
      c.queued ? `${c.queued}개 다시 생성 중` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  listenDub: '더빙 듣기',
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `이 그룹의 더빙${o.bed ? ' + 배경음' : ''} · ${o.duck ? '원본 낮춤' : '원본 음소거'}${o.others ? ' · 다른 언어 끔' : ''}`,
  listenDubKeep: '이 더빙 그룹은 원본 오디오를 유지했고 어느 부분인지 기록하지 않았습니다. “둘 다 듣기”를 사용하세요',
  listenOriginal: '원본 듣기',
  listenOriginalHint: (others: boolean) => `영상의 원본 오디오를 되살림 · ${others ? '모든 더빙 그룹' : '이 더빙 그룹'} 음소거`,
  listenBoth: '둘 다 듣기',
  listenBothHint: (bed: boolean) => `비교용${bed ? ' · 이 그룹의 배경음 끔' : ''}`,
  sourceLabel: { dub: '더빙 듣기', original: '원본 듣기', both: '둘 다 듣기' },
  sourceDone: { dub: (language: string) => `“더빙 · ${language}” 듣는 중`, original: '원본 듣는 중 · 더빙 음소거됨', both: '원본과 더빙을 함께 재생 중' },
  regenSome: (n: number) => (n ? `문장 ${n}개 다시 생성…` : '다시 생성…'),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed}개 합성 안 됨` : '', fast ? `${fast}개 너무 빠름` : ''].filter(Boolean).join(' · ')} · 먼저 번역을 수정할 수 있습니다`
      : '합성되지 않았거나 너무 빠른 문장이 없습니다',
  redub: '다시 더빙…',
  redubHint: '번역 더빙 열기: 언어나 목소리를 바꿔 그룹 전체를 다시 만듭니다',
  readOnly: '영상이 읽기 전용입니다',

  // ---- 块菜单 ----
  regenBlocks: (n: number) => `${n > 1 ? `이 문장 ${n}개` : '이 문장'} 다시 생성`,
  regenBlocksHint: '같은 번역과 목소리로 다시 합성 · 새 시드 · 이전 테이크는 유지',
  retext: '번역 수정 후 다시 더빙…',
  retextHint: '먼저 길이를 확인하고 번역을 수정한 뒤 이 문장들만 다시 더빙합니다',
  inQueue: '다시 생성 중인 문장이 있습니다',

  // ---- 块 ----
  queued: '다시 생성 중…',
  queuedTip: (text: string) => `${text} · 다시 생성 중`,
  version: (k: number, seed: number | null) => (seed === null ? `테이크 ${k}` : `테이크 ${k} · 시드 ${seed}`),

  // ---- 提交与收尾 ----
  submitted: (n: number) => `더빙 문장 ${n}개 다시 생성을 시작했습니다`,
  submitFailed: (message: string) => `다시 생성을 시작하지 못했습니다: ${message}`,
  grantRefused: (recipient: string) =>
    `다시 생성하면 번역을 ${recipient}에 보내는데, 아직 허가가 없습니다. 설정에서 허가를 발급하거나 번역 더빙에서 처음부터 다시 시작하세요`,
  busy: '이 그룹을 제출하는 중입니다. 잠시 기다리세요',
  done: (replaced: number, total: number) =>
    replaced === total ? `더빙 문장 ${replaced}개를 다시 생성했습니다` : `더빙 문장 ${replaced}/${total}개를 다시 생성했습니다`,
  doneNone: '새 테이크로 바뀐 문장이 없습니다',
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `문장 ${n}개가 들어가지 않아 이전 테이크를 유지했습니다`
      : status === 'stale'
        ? `문장 ${n}개는 번역이 오래되어 합성하지 않았습니다`
        : status === 'voice-unavailable'
          ? `문장 ${n}개는 목소리를 사용할 수 없어 합성하지 않았습니다`
          : `문장 ${n}개가 타임라인에 없습니다`,
  failed: (message: string) => `다시 생성을 끝내지 못했습니다: ${message}`,
  cancelled: '다시 생성 취소됨',
  undo: '실행 취소',
  undoMissing: '이번 다시 생성이 기록한 편집을 찾지 못했습니다. 편집기의 실행 취소를 사용하세요',
  labelRetext: '번역 수정(다시 더빙)',

  // ---- 改译文并重配 ----
  fitTitle: (n: number) => `번역 수정 후 문장 ${n}개 다시 더빙`,
  fitIntro:
    '음성으로 읽힐 번역 문장을 수정합니다(수정한 문장은 검토됨으로 표시). 이 번역으로 만든 자막은 다시 나누지 않습니다. 각 문장은 새 시드로 다시 합성되며 이전 테이크는 유지됩니다.',
  fitDub: (seconds: number, rate: string) => `더빙 ${seconds.toFixed(1)}초${rate ? ` · ${rate}` : ''}`,
  fitVoice: '합성 안 됨: 목소리를 사용할 수 없음',
  fitOverlong: (seconds: number | null) => (seconds === null ? '배치 안 됨: 너무 김' : `배치 안 됨: ${seconds.toFixed(1)}초 초과`),
  fitLoading: '번역 불러오는 중…',
  fitUnreadable: (message: string) => `이 더빙의 번역을 읽지 못했습니다(${message}). 원래 번역으로만 다시 더빙합니다`,
  fitMissing: '번역에 이 문장이 없습니다. 계획에 있는 원고로 다시 더빙합니다',
  fitText: (index: number) => `문장 ${index}의 번역`,
  fitCancel: '취소',
  fitSubmit: (n: number, changed: number) => (changed ? `${changed}개 수정 후 문장 ${n}개 다시 더빙` : `문장 ${n}개 다시 더빙`),
  fitBusy: '제출 중…',

  // ---- 属性页的版本 ----
  takesTitle: '테이크',
  takesAside: (n: number) => `테이크 ${n}개`,
  takeCurrent: '현재',
  takeUse: '이 테이크로 전환',
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `시드 ${seed}` : '',
      seconds !== null ? `${seconds.toFixed(1)}초` : '배치 안 됨',
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  takeUnavailable: '이 테이크는 타임라인에 없거나 소재를 찾을 수 없습니다',
  takesNote: '다시 생성할 때마다 테이크가 하나씩 기록됩니다. 이전 테이크로 되돌리는 것은 실행 취소할 수 있는 편집이며 다시 합성하지 않습니다.',
  takeName: (k: number) => `테이크 ${k}`,
  labelSwitchTake: (k: number) => `더빙 테이크 ${k}(으)로 전환`,
  switched: (k: number) => `테이크 ${k}(으)로 전환했습니다`,
  regenThis: '이 문장 다시 생성',
  unreadableFormat: '인식할 수 없는 형식',
  unreadableNoTranslation: '계획에 번역이 없습니다',
};
