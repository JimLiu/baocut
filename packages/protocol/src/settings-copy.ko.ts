import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const ko: SettingDescriptionMessages = {
  'agent.defaultDriver': "새 세션에 사용할 Agent. null이면 감지된 사용 가능한 Agent를 우선 사용합니다(Codex 우선). 세션을 만들 때 고정됩니다",
  'agent.defaultModel': '새 세션의 모델. null이면 권장 모델(Claude Code는 Sonnet, Codex는 -sol 계열), __agent-default__이면 모델을 지정하지 않고 Agent 자체 CLI 설정을 따릅니다',
  'agent.defaultEffort': '새 세션의 추론 강도. null이면 Agent 자체의 기본값을 사용합니다',
  'agent.defaultAccessMode':
    '접근 모드를 한 번도 바꾸지 않은 세션에 사용합니다: ask, autoAcceptEdits, auto, fullAccess 또는 plan(이전 값 controlled와 authorized는 각각 ask와 fullAccess로 처리)',
  'ui.language': `인터페이스 언어: system은 시스템 언어를 따르며(맞는 언어가 없으면 영어), 또는 언어 코드(${LOCALES.join(', ')})를 지정합니다. Runtime이 사람에게 보여 주는 텍스트도 이 설정을 따릅니다`,
  'captions.maxLineLength': '자동 줄바꿈의 목표 줄 길이(문자 수): cjk는 중국어·일본어·한국어 텍스트, other는 그 밖의 텍스트',
  'transcribe.afterComplete': '전사가 끝난 뒤: open-video는 영상을 열고, notify는 알림만 보내고, nothing은 아무것도 하지 않습니다',
  'downloads.directory':
    '영상이 없는 도구 결과, 링크에서 다운로드한 미디어, downloads_save가 넘긴 파일의 기본 저장 위치(절대 경로). null이면 프로젝트와 관계없이 이 호스트의 ~/Downloads를 사용합니다',
  'downloads.cookieBrowsers': '링크에서 다운로드할 때의 웹사이트 로그인(영상 다운로드, 링크에서 전사, Agent의 download와 transcribe): all은 이 호스트에서 쿠키 저장소가 감지된 모든 브라우저를 최근에 쓴 순서로 사용합니다. 브라우저 id 목록(chrome, edge, firefox, safari, brave, chromium, opera, vivaldi, whale)은 그 순서대로 시도합니다. 빈 목록은 익명으로 다운로드합니다. 다운로드를 시작할 때마다 그때 감지된 브라우저로 펼칩니다',
  'models.downloadEndpoint':
    '로컬 모델의 다운로드 소스(미러 기본 URL, http(s)://). null이면 공개 모델 허브를, https://www.modelscope.cn이면 ModelScope를 사용합니다. BAOCUT_MODELS_ENDPOINT 환경 변수가 우선합니다',
  'models.dir':
    '로컬 모델을 둘 폴더(절대 경로). null이면 데이터 폴더의 models를 사용합니다. BAOCUT_MODELS_DIR 환경 변수가 우선합니다. settings set이 아니라 models.setDir로 변경하세요',
  'tools.downloadEndpoint':
    '관리되는 외부 도구(yt-dlp)의 다운로드 소스(미러 기본 URL, http(s)://, 파일 위치는 <base>/<tool>/<version>/<file>). null이면 공식 배포 URL을 사용합니다. BAOCUT_TOOLS_ENDPOINT 환경 변수가 우선합니다',
  'models.downloadMirrors':
    "추가한 모델 저장소 미러({ name, base } 목록, base는 중복 없는 http(s):// 기본 URL). 선택지 목록일 뿐이며 다운로드는 models.downloadEndpoint를 따릅니다",
  'tools.downloadMirrors':
    "추가한 릴리스 페이지 미러({ name, base } 목록, base는 중복 없는 http(s):// 기본 URL). 선택지 목록일 뿐이며 다운로드는 tools.downloadEndpoint를 따릅니다",
  'fonts.autoDownload':
    '레이아웃에 필요하지만 이 컴퓨터에 없고 글꼴 카탈로그에 있는 글꼴을 자동으로 다운로드합니다(미리보기와 내보내기). 끄면 대체 글꼴로 그리고 안내를 표시합니다',
  'fonts.cssEndpoint': '글꼴 CSS API의 기본 URL(미러, https://). null이면 https://fonts.googleapis.com을 사용합니다',
  'fonts.fileEndpoint': '글꼴 파일의 기본 URL(미러, https://. 파일은 이 경로 아래에서만 가져옵니다). null이면 https://fonts.gstatic.com을 사용합니다',
  'space.trashRetentionDays':
    'Space 휴지통에 항목을 보관할 일수(1–3650): 이보다 오래된, 참조되지 않는 항목과 삭제된 영상은 주기적으로 영구 삭제됩니다',
  'versions.keep': "동영상마다 버전 기록에 남길 이름 없는 버전 수(1–100). 저장한 버전은 항상 남깁니다. 동영상의 버전 파일은 64 MiB까지이며, 넘으면 가장 오래된 이름 없는 버전부터 삭제합니다",
  'versions.cadence': "버전 기록이 새 버전을 시작하는 시점: segment는 5분 동안 작업이 없을 때, 연속 편집 30분마다, 저장과 복원 전후. turn은 여기에 Agent의 각 턴 시작 시 추가",
  'cache.maxSizeMiB': '데이터 폴더 캐시의 크기 상한(MiB, 256–1048576): 넘으면 가장 오래된 캐시 파일(미디어 분석, 재생용 변환본)부터 삭제해 상한의 90%까지 줄입니다. 영상 간 검색 색인은 삭제하지 않습니다',
  'resources.capacity':
    '고급: 리소스 스케줄링에 쓰는 머신 용량 { memoryMiB, gpuMemoryMiB, cpuThreads }. 항목을 null로 두면 자동으로 감지하고, null이면 모두 감지합니다(메모리와 CPU는 시스템에서 가져오고, Apple 실리콘의 GPU 메모리는 통합 메모리로 추정)',
  'runtime.idleExitMinutes':
    'CLI가 시작한 Runtime이 유휴 상태로 몇 분이 지나면 스스로 종료할지(1–1440): 연결도, 작업도, 열린 외부 서비스도 없는 상태. 데스크톱 앱을 종료할 때 백그라운드에서 계속 실행하도록 한 Runtime도 작업이 끝나고 이 시간이 지나면 종료됩니다. 그 밖의 Runtime에는 영향이 없습니다',
  'updates.autoCheck': '앱 업데이트 자동 확인',
  'updates.autoDownload': '새 버전을 백그라운드에서 다운로드(자동으로 설치하지 않음)',
  'diagnostics.enabled': '익명 사용 통계와 성능 요약 보내기(미디어, 텍스트, 경로는 포함하지 않음)',
  'offline.strict': '엄격한 오프라인: 어떤 온라인 서비스에도 아무것도 보내지 않습니다',
  'semantic.channels': '의미 색인을 만들 채널: text(말한 내용: 대본, 자막, 번역, 챕터). 화면(visual)은 8초마다 키프레임 하나로, 멀티모달 모델 패키지가 필요하고 더 오래 걸립니다. 소리(audio)는 아직 사용할 수 없습니다',
  'semantic.excludedProjects': '의미 색인에서 제외할 프로젝트(프로젝트 ID 목록): BaoCut의 모든 프로젝트와 프로젝트 밖의 동영상을 색인하고 이것만 뺍니다. 제외한 동영상도 정확한 단어로는 찾을 수 있습니다',
  'semantic.folders': '프로젝트 밖의 색인 폴더({id, path} 목록). 안의 동영상과 이미지가 Space에 표시되고 의미로 색인됩니다(읽기 전용). space.folderAdd와 space.folderRemove로 바꿉니다',
  'semantic.excludedVideos': '의미 색인에서 따로 제외할 동영상(동영상 ID 목록). 제외한 프로젝트에 더해 적용되며 이미 만든 색인은 지웁니다',
  'semantic.indexDir':
    '의미 색인을 둘 폴더(절대 경로). null이면 앱 캐시에 둡니다. space.indexSetDir로 바꾸면 색인을 옮기거나 다시 만듭니다',
  'semantic.pauseOnBattery': '배터리 사용 중에는 의미 색인 생성을 일시 정지하고 전원에 연결하면 이어서 진행합니다(발열로 성능이 제한될 때는 항상 일시 정지)',
  'semantic.translationMemory': '번역할 때 이전에 번역한 거의 같은 문장을 제안(텍스트 검색 모델 필요)',
  'semantic.glossaryCandidates': '대본들 사이의 거의 같은 표기에서 용어 후보를 제안(텍스트 검색 모델 필요)',
};
