import type { LinkImportMessages } from './link-import-copy.ts';

const endSentence = (text: string) => (/[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const joinSentences = (parts: readonly (string | null | undefined)[]) =>
  parts
    .filter((p): p is string => !!p?.trim())
    .map(endSentence)
    .join(' ');

export const ko: LinkImportMessages = {
  title: (name: string | null) => (name ? `링크에서 가져오기 · ${name}` : '링크에서 가져오기'),

  phase: {
    starting: '준비 중',
    probing: '링크 읽는 중',
    downloading: '영상 다운로드 중',
    validating: '파일 재생 가능 여부 확인 중',
    publishing: '다운로드 폴더로 옮기는 중',
    applying: '영상 가져오는 중',
    transcribing: '전사 시작 중',
  },
  phaseFallback: '진행 중',
  downloaded: (bytes: string) => `${bytes} 다운로드됨`,

  stageDownload: '영상 다운로드',
  stageVideo: '미디어 확인 및 영상 만들기',
  stageSubs: '자막 생성',

  issue: {
    TOOL_NOT_INSTALLED: {
      title: '한 번만 설정하면 이후에는 붙여 넣기만 하면 됩니다',
      body: 'BaoCut이 이 사이트를 읽으려면 영상 다운로드 도구 yt-dlp가 필요합니다. 설치한 뒤 이 가져오기를 다시 시작하세요.',
    },
    TOOL_CONSENT_REQUIRED: {
      title: '다운로드 도구를 사용하려면 동의가 필요합니다',
      body: '다운로드 도구가 이미 이 컴퓨터에 있습니다. BaoCut은 동의를 받은 뒤에만 이 도구로 웹사이트에서 영상을 다운로드합니다.',
    },
    TOOL_UNAVAILABLE: {
      title: '다운로드 도구를 실행할 수 없습니다',
      body: '다운로드 도구를 찾았지만 실행되지 않습니다. 다시 설치하거나 작동하는 사본을 고르세요.',
    },
    TOOL_OUTDATED: {
      title: '다운로드 도구를 업데이트해야 합니다',
      body: '버전이 너무 오래되어 이 사이트를 읽지 못할 수 있습니다. 업데이트한 뒤 다시 시도하세요.',
    },
    OFFLINE_STRICT: {
      title: '엄격한 오프라인 모드에서는 링크로 다운로드할 수 없습니다',
      body: '엄격한 오프라인 모드에서는 BaoCut이 온라인에 연결하지 않습니다. 먼저 브라우저에서 영상을 다운로드한 뒤 로컬 파일을 고르세요.',
    },
    LINK_UNSUPPORTED: {
      title: '아직 지원하지 않는 출처입니다',
      body: '다운로드 도구가 이 사이트나 페이지를 인식하지 못합니다. 재생목록, 라이브 스트림, 검색 페이지가 아닌 영상 페이지 자체의 링크를 사용하거나 로컬 파일을 사용하세요.',
    },
    LINK_LOGIN_REQUIRED: {
      title: '이 영상은 로그인해야 볼 수 있습니다',
      body: '먼저 브라우저에서 사이트에 로그인한 뒤 영상 다운로드로 돌아가 “웹사이트 로그인”에서 그 브라우저를 체크하고 다시 다운로드하세요.',
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: '브라우저 쿠키를 읽지 못했습니다',
      body: '브라우저에 로그인되어 있는지 확인하세요. 데이터베이스가 잠겨 있으면 브라우저를 완전히 종료하고(백그라운드에서 실행 중인 것 포함) 키체인 권한을 확인하세요(Safari는 전체 디스크 접근 권한에서 BaoCut을 허용). Windows에서는 앱 바인딩 암호화로 보호된 Chrome, Edge, Brave 쿠키를 읽을 수 없으니 대신 Firefox를 체크하세요. 또는 다른 브라우저를 체크하고 다시 다운로드하세요.',
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: 'yt-dlp를 업데이트해야 합니다',
      body: '사이트에서 영상을 제공하는 방식이 바뀌었습니다. yt-dlp를 설치한 방식대로 업데이트하고 다시 확인한 뒤 다시 시도하세요.',
    },
    LINK_UNAVAILABLE: {
      title: '이 영상을 사용할 수 없습니다',
      body: '영상이 삭제되었거나, 지역 제한이 있거나, 다운로드할 수 있는 형식이 없을 수 있습니다. 다른 링크를 시도하거나 로컬 파일을 사용하세요.',
    },
    LINK_NETWORK_ERROR: {
      title: '연결이 끊어졌습니다',
      body: '네트워크를 확인하고 다시 시도하세요. 이미 다운로드한 부분부터 이어서 받습니다.',
    },
    LINK_DISK_FULL: {
      title: '디스크 공간이 부족합니다',
      body: '다운로드 폴더가 있는 디스크가 가득 찼습니다. 공간을 확보한 뒤 다시 시도하세요.',
    },
    LINK_DOWNLOAD_FAILED: {
      title: '다운로드 도구에서 오류가 발생했습니다',
      body: '사이트가 바뀌었거나 일시적으로 다운로드를 제한하고 있을 수 있습니다. 먼저 다시 시도하고, 그래도 실패하면 다운로드 도구를 업데이트해야 하는지 확인하거나 로컬 파일을 사용하세요.',
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: '다운로드한 파일을 사용할 수 없습니다',
      body: '파일이 불완전하거나, 오디오 트랙이 없거나, 디코딩할 수 없습니다. 사이트가 자리 표시용 콘텐츠를 보냈을 수 있습니다. 다시 다운로드하거나 다른 링크 또는 로컬 파일을 시도하세요.',
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: '다운로드 폴더에 쓸 수 없습니다',
      body: '다운로드 폴더가 있는지, 쓸 수 있는지 확인하세요. 다른 폴더를 고른 뒤 가져오기를 다시 시작하세요.',
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: '다운로드한 파일을 확인할 수 없습니다',
      body: '미디어를 확인하려면 ffprobe(ffmpeg에 포함)가 필요한데 이 컴퓨터에 없습니다. ffmpeg를 설치한 뒤 다시 시도하세요.',
    },
    LINK_SOURCE_EXPIRED: {
      title: '원래 링크가 없어졌습니다',
      body: 'Runtime은 다시 시작한 뒤 전체 링크가 아니라 일부를 가린 링크만 보관합니다. 링크를 붙여 넣어 가져오기를 다시 시작하세요.',
    },
    INTERRUPTED: {
      title: '가져오기가 중단되었습니다',
      body: '끝나기 전에 Runtime이 멈췄거나 다시 시작되었습니다. 다시 시도하면 멈춘 단계부터 이어서 진행합니다.',
    },
  },
  issueUnknownTitle: '가져오기가 완료되지 않았습니다',
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || '문제가 발생했습니다.',

  headingStopped: '가져오기 중지됨',
  headingFailed: '가져오기가 완료되지 않았습니다',
  headingRunning: '이 링크를 편집할 수 있는 영상으로 만드는 중',
  headingDownloaded: '영상 다운로드됨',
  headingVideoFailed: '파일은 다운로드했지만 영상을 만들지 못했습니다',
  headingCreatingVideo: '파일 다운로드됨, 영상 만드는 중',
  headingTranscribing: '영상 준비됨, 자막 생성 중',
  headingTranscribeFailed: '영상 준비됨, 전사 확인 필요',
  headingReady: '영상 준비됨',
  headingSubsReady: '자막이 준비되었습니다',

  toolSource: {
    system: '시스템에 설치됨',
    user: '직접 지정함',
    managed: 'BaoCut이 다운로드함',
    env: '환경 변수로 지정됨',
  },
  factVersion: (version: string, size: string | null) => (size ? `버전 ${version} · 약 ${size}` : `버전 ${version}`),
  factFrom: (host: string) => `${host}에서 다운로드`,
  factLicense: (license: string) => `${license} 라이선스`,
  factIsolated: 'BaoCut 전용 폴더에 보관하고 체크섬을 확인한 뒤에만 실행하며, 시스템은 바꾸지 않습니다',
  factInstalledWith: (method: string) => `설치 방법: ${method}`,

  cardChecking: '다운로드 도구 확인 중…',
  cardCheckingBody: '이 컴퓨터에 있는 버전만 확인하며 온라인에 연결하지 않습니다.',
  cardUnknown: '다운로드 도구가 등록되어 있지 않습니다',
  cardUnknownBody: '이 Runtime은 yt-dlp를 알지 못하므로 지금은 링크에서 가져올 수 없습니다.',
  cardInstalling: '다운로드 도구 준비 중…',
  cardInstallingBody: '다운로드 → 검증 → 시험 실행. 완료되면 여기에 “준비됨”이 표시됩니다.',
  cardUpdating: '다운로드 도구 업데이트 중…',
  cardUpdatingBody: '출력은 명령 아래에 표시되며, 완료되면 버전을 다시 확인합니다.',
  cardBlockedWhy: '이 컴퓨터에서는 BaoCut이 대신 다운로드할 수 없습니다.',
  cardMissing: '다운로드 도구가 설치되어 있지 않습니다',
  cardMissingBody: (why: string) => `${endSentence(why)} yt-dlp를 직접 설치한 뒤 “다시 확인”을 클릭하거나 위치를 지정하세요.`,
  cardInstall: '한 번만 설정하면 이후에는 붙여 넣기만 하면 됩니다',
  cardInstallBody:
    'BaoCut이 영상 사이트를 읽으려면 영상 다운로드 도구 yt-dlp가 필요합니다. 동의하면 도구를 다운로드하고 동의 사실을 기억하므로, 이후 링크에서 가져올 때 다시 묻지 않습니다.',
  cardInstallAction: '동의하고 설치',
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `버전 ${version ?? '알 수 없음'}은(는) 필요한 버전 ${minVersion ?? ''}보다 낮습니다`),
  cardOutdated: '다운로드 도구를 업데이트해야 합니다',
  cardOutdatedBlocked: (reason: string, why: string) => `${reason} ${why}`,
  cardOutdatedRunnable: 'BaoCut이 다운로드한 도구가 아닙니다. 아래 명령으로 설치한 방식대로 업데이트할 수 있습니다.',
  cardOutdatedManual: 'BaoCut이 다운로드한 도구가 아닙니다. 아래 안내에 따라 터미널에서 업데이트한 뒤 “다시 확인”을 클릭하세요.',
  cardOutdatedUpdate: (reason: string) => `${reason} 시작하기 전에 업데이트하세요.`,
  cardUpdateAction: '동의하고 업데이트',
  cardBroken: '다운로드 도구를 실행할 수 없습니다',
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || '찾았지만 실행되지 않습니다.',
  cardReinstallAction: '동의하고 다시 설치',
  cardConsentRevoked: '다운로드 도구 사용 동의를 철회했습니다',
  cardConsent: '다운로드 도구를 사용하려면 동의가 필요합니다',
  cardConsentBody: 'BaoCut은 동의를 받은 뒤에만 이 도구로 웹사이트에서 영상을 다운로드합니다. 동의는 Runtime에 저장되므로 이후 링크에서 가져올 때 다시 묻지 않습니다.',
  cardConsentAction: '동의하고 사용',
  cardReady: '다운로드 도구가 준비되었습니다',
  cardReadyBody: '시작하면 BaoCut이 먼저 링크를 확인하고 영상 정보를 가져온 뒤 다운로드합니다.',
};
