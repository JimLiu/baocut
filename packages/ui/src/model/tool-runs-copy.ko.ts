import type { ToolRunsMessages } from './tool-runs-copy.ts';

export const ko: ToolRunsMessages = {
  diarizeStep: '화자 식별',

  phaseDone: '완료',
  phaseQueued: '대기 중',
  phaseCancelled: '취소됨',
  phaseUnfinished: '완료되지 않음',
  phasePreparing: '준비 중',
  stepAt: (cur, total) => `${total}단계 중 ${cur}단계`,
  cancelledAt: (step, at) => `“${step}”에서 취소됨 · ${at}`,
  stoppedAt: (step, at) => `“${step}”에서 중지됨 · ${at}`,
  runningAt: (step, at) => `${step} · ${at}`,
  stepDone: '완료',
  stepStopped: '여기서 중지됨',
  stepRunning: '진행 중',
  stepWaiting: '대기',

  costEstimate: (amount, currency) => `약 ${amount} ${currency}`,
  costSubscription: (recipient) => `${recipient} 구독에 포함`,
  costFree: '무료',
  costMetered: (recipient) => `${recipient} 요금으로 과금되며 여기서는 금액을 추정할 수 없습니다`,
  grantWhat: (kinds, purpose) => `${kinds.join(', ')}(${purpose})`,
  grantLoop: '이미 승인했지만 Runtime이 계속 거부합니다. 설정 › 개인 정보 보호 및 권한에서 이 허가 항목을 확인하거나 다른 모델로 바꾸세요.',

  noStructuredOutput: '이 모델은 구조화된 출력을 지원하지 않아 번역할 수 없습니다',

  captionsCreated: (p) =>
    `${p.language ? `${p.language} 자막 레이어` : '편집 가능한 자막 레이어'}를 만들었습니다${p.bilingual ? ' · 이중 언어로 표시' : ''}${
      p.disabled ? '(이 소재에는 이미 자막이 표시되고 있어 새 레이어는 꺼진 상태로 시작합니다)' : ''
    }`,
  captionsExistingTranslation: '이 번역에는 이미 자막 레이어가 있어 새로 만들지 않았습니다',
  captionsExistingTranscript: '이 전사본에는 이미 자막 레이어가 있어 새로 만들지 않았습니다',
  captionsNotOnTimeline: '타임라인에 이 소재를 사용하는 클립이 없어 자막 레이어를 만들지 않았습니다',
  captionsEmpty: '표시할 자막이 없어 자막 레이어를 만들지 않았습니다',
  originalAudio: { duck: '원본 오디오 줄임', mute: '원본 오디오 음소거', keep: '원본 오디오 유지' },

  thisVideo: '이 영상',
  newVideo: '새 영상',
  fallbackVideo: '영상',
  media: '미디어',
  savedFiles: (names) => `전사본과 자막을 저장했습니다: ${names.join(', ')}`,
  transcriptLanguage: (language, model) => `전사본 언어: ${language}${model ? `(${model})` : ''}`,
  createdVideoLinked: (video, project) =>
    `${project ? `“${project}”에 ` : ''}“${video}” 영상을 만들었습니다. 소재는 원래 위치에 두고 링크만 연결합니다`,
  wroteTranscript: (video) => `“${video}”에 전사본을 추가했습니다`,
  speakersFound: (n) => `화자 ${n}명을 찾았습니다. 자막과 전사본에 이름이 표시됩니다`,
  wroteTranslation: (video, language, source) =>
    `“${video}”에 ${language} 번역을 추가했습니다${source ? `(${source} 전사본에서 번역)` : ''}. 원문은 바뀌지 않았습니다`,
  unitCount: (n) => `${n}문장`,
  subtitleFileWritten: (file, dir) => `번역된 자막 파일 ${file}을(를) ${dir}에 저장했습니다. 자막 개수와 타임코드는 그대로입니다`,
  bilingualLayout: '이중 언어: 원문은 위, 번역은 아래',
  markupStripped: (n) => `원문 자막 ${n}개에서 인라인 마크업을 제거했습니다`,
  dubTranslated: (language) => `먼저 ${language}(으)로 번역해 새 번역을 추가했습니다`,
  dubReusedTranslation: (language) => `기존 ${language} 번역을 사용했습니다`,
  dubWritten: (video, language, engine) =>
    `“${video}”에 새 ${language} 더빙을 추가했습니다${engine ? `(${engine})` : ''}. 이전 더빙은 유지됩니다`,
  dubPlaced: (placed, total) => `${total}문장 중 ${placed}문장을 타임라인에 배치했습니다`,
  linkCreatedVideo: (video, project) =>
    `${project ? `“${project}”에 ` : ''}“${video}” 영상을 만들었습니다. 다운로드한 미디어가 타임라인에 있습니다`,
  linkAddedTo: (file, video) => `“${video}”에 ${file} 파일을 추가했습니다. 파일은 다운로드 폴더에 그대로 있습니다`,
  linkDownloaded: (file, dir) => `${dir ? `${dir}에 ` : ''}${file} 파일을 다운로드했습니다`,
  linkTranscribedFiles: '전사 완료: TXT 전사본과 SRT 자막을 저장했습니다',
  linkTranscribed: '전사 완료: 전사본을 추가했습니다. 이 경로에서는 자막 레이어를 만들지 않으며, 편집기의 자막 패널에서 만들 수 있습니다',
  replacedTranscript: (video) => `“${video}”의 전사본을 대체했습니다. 한 번의 변경이며 실행 취소할 수 있습니다`,
  newVideoFrom: (video, project, original) =>
    `${project ? `“${project}”에 ` : ''}영상 “${video}”을(를) 만들고 같은 소재를 연결했습니다. ${original ? `“${original}”` : '원본 영상'}과 번역은 그대로입니다`,
  carryTranslation: (language, kept, reviewed, stale) => `${language} 번역 · 유지: ${kept}(검토됨: ${reviewed}) · 오래됨: ${stale}`,
  carryPins: (reanchored, orphaned) => `자막 pin · 다시 고정: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language, kept, stale) => `${language} 더빙 · 유지: ${kept} · 오래됨: ${stale}`,
  nothingToCarry: '이 영상에는 이어 갈 번역, 자막 pin, 더빙이 없었습니다',
  refreshHint: "오래된 번역은 '오래된 번역 새로 고침'으로 다시 번역하세요",
};
