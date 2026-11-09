import type { StandaloneMessages } from './standalone-copy.ts';

export const ko: StandaloneMessages = {
  cliHelp: `사용법:
  baocut cli install               이 명령줄 패키지를 현재 사용자용으로 설치하고 baocut을 PATH에 둡니다. 패키지는
                                   ~/.local/share/baocut/versions/<버전>(Windows: %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<버전>)에
                                   복사하며, 이미 있으면 복사하지 않습니다. macOS: ~/.local/bin/baocut에 심볼릭 링크.
                                   Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd를 두고 그 폴더를 사용자 PATH에 추가합니다.
                                   관리자 권한이 필요 없습니다
  baocut cli status                baocut이 놓인 위치, 설치된 어느 버전을 가리키는지, 터미널이 실제로 찾는 baocut
  baocut cli remove                baocut cli install이 둔 것을 제거합니다. 설치된 버전은 남습니다. 그 위치에 BaoCut이 두지
                                   않은 것은 절대 바꾸거나 지우지 않습니다`,
  help: `baocut update [--check | --rollback]

독립 실행형 명령줄 패키지를 업데이트합니다. BaoCut 앱과 같은 릴리스 피드를 읽어 최신 릴리스의 명령줄 패키지를
다운로드하고, 크기와 sha256(macOS에서는 서명과 공증도)을 확인한 뒤 현재 버전 옆에 설치하고 baocut이 그것을
가리키게 합니다. 이전 버전은 --rollback용으로 남기고, 어떤 Runtime도 쓰지 않는 그보다 오래된 버전은 삭제합니다.
  --check      새 버전이 있는지만 알려 줍니다
  --rollback   이전 버전으로 돌아갑니다
이미 실행 중인 Runtime은 멈출 때까지 기존 버전을 계속 씁니다(baocut runtime stop).
이 방식으로 업데이트되는 것은 독립 실행형 패키지뿐입니다. BaoCut 앱은 스스로 업데이트하고, Homebrew로 설치한 것은 brew upgrade를 씁니다.
BAOCUT_UPDATE_APPCAST를 설정하면 다른 피드(URL 또는 로컬 파일, 테스트용)를 읽습니다.`,
  version: (version, build) => `${version}(build ${build})`,
  state: {
    none: '설치 안 됨',
    current: '현재 버전을 가리킴',
    stale: '다른 BaoCut을 가리킴',
    broken: '더 이상 없는 위치를 가리킴',
    foreign: '다른 항목이 있음(건드리지 않음)',
  },
  statusPackage: (version, root) => `패키지    ${version}  ${root}`,
  statusVersions: (versions, root) => `설치됨    ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `${root}에 아직 설치된 것이 없습니다. baocut cli install이 이 패키지를 그곳에 복사합니다`,
  currentMark: ' (현재)',
  previousMark: ' (이전)',
  copied: (dest, from) => `패키지를 ${dest}에 복사했습니다. ${from}은(는) 더 이상 필요 없습니다`,
  versionsKept: (dir) => `설치된 버전은 ${dir}에 남습니다. 지우려면 그 폴더를 삭제하세요`,
  entryTaken: (path) =>
    `${path}은(는) BaoCut이 둔 것이 아니므로 건드리지 않습니다. 직접 옮기거나 삭제한 뒤 baocut cli install을 다시 실행하세요`,
  pathFailed: (dir) => `${dir}을(를) 사용자 PATH에 추가하지 못했습니다. 시스템 속성 → 환경 변수에서 추가하세요`,
  copyFailed: (from, dest, detail) => `${from}을(를) ${dest}에 복사하지 못했습니다${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update에는 --check 또는 --rollback 중 하나만 쓸 수 있습니다: ${token}`,
  updateUnavailable:
    'baocut update는 독립 실행형 명령줄 패키지를 업데이트합니다. 이 baocut은 스스로 업데이트하는 BaoCut 앱(BaoCut → 업데이트 확인) 또는 Homebrew(brew upgrade --cask baocut)의 것입니다',
  upToDate: (current) => `최신 버전입니다: ${current}`,
  available: (latest, current) => `새 버전 ${latest} 사용 가능(현재 ${current})`,
  downloading: (version, build, megabytes) => `${version}(build ${build}) 다운로드 중, ${megabytes} MB…`,
  updated: (from, to) => `업데이트함: ${from} → ${to}`,
  rolledBack: (from, to) => `${from}에서 ${to}(으)로 되돌렸습니다`,
  rollbackHint: '되돌리려면: baocut update --rollback',
  entrySwitched: (path) => `${path}이(가) 이제 이 버전을 가리킵니다`,
  entryNotInstalled: (path) => `${path}이(가) 설치되어 있지 않습니다. baocut cli install로 baocut을 PATH에 둘 수 있습니다`,
  entryLeftAlone: (path) =>
    `${path}이(가) 이 패키지가 아닌 다른 것을 가리켜 그대로 두었습니다. baocut cli install로 여기를 가리키게 할 수 있습니다`,
  removedVersions: (versions) => `오래된 버전을 삭제했습니다: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Runtime(pid ${pid})이 시작할 때의 버전으로 계속 실행 중입니다. 멈추면 다음 명령이 새 버전을 시작합니다(지금 멈추려면 baocut runtime stop)`,
  systemTooOld: (required, system) => `새 버전에는 macOS ${required}이(가) 필요합니다. 이 Mac은 ${system}입니다`,
  feedFailed: (url, detail) => `릴리스 피드 ${url}을(를) 읽지 못했습니다: ${detail}`,
  feedMissing: (url) => `릴리스 피드 ${url}에 아직 명령줄 패키지가 없습니다. 다음 릴리스 후에 다시 시도하세요`,
  downloadFailed: (url, detail) => `${url}을(를) 다운로드하지 못했습니다: ${detail}`,
  verifyFailed: (detail) => `다운로드한 패키지가 검사를 통과하지 못해 설치하지 않았습니다: ${detail}`,
  unsignedBuild:
    '이 패키지는 서명되지 않아 업데이트의 서명을 확인할 수 없습니다. 대신 BaoCut 릴리스 페이지에서 독립 실행형 패키지를 다운로드하세요',
  noPrevious: (dir) => `${dir}에 되돌아갈 이전 버전이 없습니다`,
  inProgress: (pid) => `다른 baocut update(pid ${pid})가 실행 중입니다. 끝날 때까지 기다리세요`,
};
