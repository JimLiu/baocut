import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const ko: SettingDescriptionMessages = {
  'agent.defaultDriver': '새 세션에 사용할 Agent. null이면 내장 기본값(codex)을 사용합니다. 세션을 만들 때 고정됩니다',
  'agent.defaultModel': '새 세션의 모델. null이면 권장 모델(Claude Code는 Sonnet, Codex는 -sol 계열), __agent-default__이면 모델을 지정하지 않고 Agent 자체 CLI 설정을 따릅니다',
  'agent.defaultEffort': '새 세션의 추론 강도. null이면 Agent 자체의 기본값을 사용합니다',
  'agent.defaultAccessMode':
    '접근 모드를 한 번도 바꾸지 않은 세션에 사용합니다: ask, autoAcceptEdits, auto, fullAccess 또는 plan(이전 값 controlled와 authorized는 각각 ask와 fullAccess로 처리)',
  'ui.language': `인터페이스 언어: system은 시스템 언어를 따르며(맞는 언어가 없으면 영어), 또는 언어 코드(${LOCALES.join(', ')})를 지정합니다. Runtime이 사람에게 보여 주는 텍스트도 이 설정을 따릅니다`,
  'captions.maxLineLength': '자동 줄바꿈의 목표 줄 길이(문자 수): cjk는 중국어·일본어·한국어 텍스트, other는 그 밖의 텍스트',
  'transcribe.afterComplete': '전사가 끝난 뒤: open-video는 영상을 열고, notify는 알림만 보내고, nothing은 아무것도 하지 않습니다',
  'downloads.directory':
    '영상이 없는 도구 결과, 링크에서 다운로드한 미디어, downloads_save가 넘긴 파일의 기본 저장 위치(절대 경로). null이면 프로젝트와 관계없이 이 호스트의 ~/Downloads를 사용합니다',
  'models.downloadEndpoint':
    '로컬 모델의 다운로드 소스(미러 기본 URL, http(s)://). null이면 공개 모델 허브를 사용합니다. BAOCUT_MODELS_ENDPOINT 환경 변수가 우선합니다',
  'models.dir':
    '로컬 모델을 둘 폴더(절대 경로). null이면 데이터 폴더의 models를 사용합니다. BAOCUT_MODELS_DIR 환경 변수가 우선합니다. settings set이 아니라 models.setDir로 변경하세요',
  'tools.downloadEndpoint':
    '관리되는 외부 도구(yt-dlp)의 다운로드 소스(미러 기본 URL, http(s)://, 파일 위치는 <base>/<tool>/<version>/<file>). null이면 공식 배포 URL을 사용합니다. BAOCUT_TOOLS_ENDPOINT 환경 변수가 우선합니다',
  'fonts.autoDownload':
    '레이아웃에 필요하지만 이 컴퓨터에 없고 글꼴 카탈로그에 있는 글꼴을 자동으로 다운로드합니다(미리보기와 내보내기). 끄면 대체 글꼴로 그리고 안내를 표시합니다',
  'fonts.cssEndpoint': '글꼴 CSS API의 기본 URL(미러, https://). null이면 https://fonts.googleapis.com을 사용합니다',
  'fonts.fileEndpoint': '글꼴 파일의 기본 URL(미러, https://. 파일은 이 경로 아래에서만 가져옵니다). null이면 https://fonts.gstatic.com을 사용합니다',
  'space.trashRetentionDays':
    'Space 휴지통에 항목을 보관할 일수(1–3650): 이보다 오래된, 참조되지 않는 항목과 삭제된 영상은 주기적으로 영구 삭제됩니다',
  'resources.capacity':
    '고급: 리소스 스케줄링에 쓰는 머신 용량 { memoryMiB, gpuMemoryMiB, cpuThreads }. 항목을 null로 두면 자동으로 감지하고, null이면 모두 감지합니다(메모리와 CPU는 시스템에서 가져오고, Apple 실리콘의 GPU 메모리는 통합 메모리로 추정)',
  'runtime.idleExitMinutes':
    'CLI가 시작한 Runtime이 유휴 상태로 몇 분이 지나면 스스로 종료할지(1–1440): 연결도, 작업도, 열린 외부 서비스도 없는 상태. 데스크톱 앱과 직접 시작한 Runtime에는 영향이 없습니다',
  'updates.autoCheck': '앱 업데이트 자동 확인',
  'updates.autoDownload': '새 버전을 백그라운드에서 다운로드(자동으로 설치하지 않음)',
  'diagnostics.enabled': '익명 사용 통계와 성능 요약 보내기(미디어, 텍스트, 경로는 포함하지 않음)',
  'offline.strict': '엄격한 오프라인: 어떤 온라인 서비스에도 아무것도 보내지 않습니다',
};
