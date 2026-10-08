import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const ko: GeneralSettingsMessages = {
  interfaceGroup: '인터페이스',
  language: '언어',
  languageDesc: '다시 시작하지 않아도 바로 적용됩니다.',
  languageSystem: (current: string) => `시스템(${current})`,
  appearance: '외관',
  appearanceDesc: '이 컴퓨터의 BaoCut 창에만 적용됩니다.',
  schemeSystem: '시스템',
  schemeLight: '라이트',
  schemeDark: '다크',

  saveFailed: (message: string) => `저장하지 못했습니다: ${message}`,

  editingGroup: '편집 및 전사',
  autoOpen: '전사 후 영상 자동으로 열기',
  autoOpenDesc: '로컬에서 가져온 영상에 적용됩니다. 링크로 가져오기가 백그라운드에서 끝나면 알림만 표시하고 현재 페이지는 그대로 둡니다.',
  autoOpenNote: '아직 연결되지 않음: 지금은 전사가 끝나도 항상 현재 페이지에 머물며 영상이 자동으로 열리지 않습니다.',
  lineLength: '자막 줄 길이',
  lineLengthDesc: '자동 줄바꿈의 목표 길이를 정합니다. 직접 수정한 줄에는 적용되지 않습니다.',
  lineLengthNote: (maxChars: number, custom: string | null) =>
    `아직 연결되지 않음: 자동 줄바꿈은 현재 한 줄에 반각 문자 ${maxChars}자로 고정되어 있습니다(한중일 문자는 한 글자를 두 자로 셈).${custom ? ` 저장된 값은 사용자 지정 값(${custom})입니다.` : ''}`,
  cueShading: '전사본의 큐 음영',
  cueShadingDesc: '자막마다 범위에 옅은 음영을 깔아 어디서 끊기는지 보여 줍니다.',
  cueShadingNote: '아직 구현되지 않음: 전사본에서 자막 범위에 음영을 표시하지 않습니다.',

  downloadsGroup: '다운로드 및 업데이트',
  autoUpdateOn: '업데이트 자동 확인 및 다운로드를 켰습니다',
  autoUpdateOff: '업데이트 자동 다운로드를 껐습니다',
  downloader: '영상 다운로더',
  downloaderWeb: '브라우저에서는 이 컴퓨터의 다운로드 도구를 확인하지 않습니다. BaoCut 데스크톱 앱에서 확인하세요.',
  checking: '확인 중…',
  checkFailed: (message: string) => `확인하지 못했습니다: ${message}`,
  checkAgain: '다시 확인',

  sourcesGroup: '다운로드 소스 및 오프라인',
  modelsEndpoint: '모델 다운로드 소스',
  modelsEndpointDesc:
    '로컬 모델은 여기에서 다운로드합니다. 비워 두면 공개 모델 허브(Hugging Face)를 사용하며, 연결할 수 없으면 미러의 기본 URL을 입력하세요. BAOCUT_MODELS_ENDPOINT 환경 변수가 있으면 이 설정보다 우선합니다.',
  toolsEndpoint: '도구 다운로드 소스',
  toolsEndpointDesc:
    'yt-dlp 같은 외부 도구는 여기에서 “기본 URL/도구/버전/파일 이름” 경로로 다운로드합니다. 비워 두면 공식 배포 URL을 사용합니다. BAOCUT_TOOLS_ENDPOINT 환경 변수가 있으면 이 설정보다 우선합니다.',
  toolsEndpointPlaceholder: '공식 배포 URL',
  strictOffline: '엄격한 오프라인',
  strictOfflineDesc:
    '켜면 모델과 외부 도구를 다운로드하지 않고 링크에서 영상도 다운로드하지 않습니다. 클라우드 모델과 Agent 엔진의 온라인 연결에는 영향을 주지 않습니다.',
  strictOfflineOn: '엄격한 오프라인을 켰습니다',
  strictOfflineOff: '엄격한 오프라인을 껐습니다',
  endpointChanged: (endpoint: string) => `이제 ${endpoint} 주소를 사용합니다`,
  endpointReset: (label: string) => `${label}: 기본값으로 재설정됨`,
  save: '저장',
  resetDefault: '기본값으로 재설정',

  trashDays: '휴지통 보관 일수',
  trashDaysDesc: (fallback: number | null) =>
    `휴지통에 이 기간보다 오래 있었고 참조되지 않는 항목과 삭제한 영상은 영구적으로 삭제됩니다(시작할 때와 그 후 6시간마다 확인). 아직 참조되는 항목은 유지됩니다. 비우면 기본값${fallback ? `(${fallback}일)` : ''}이 적용됩니다.`,
};
