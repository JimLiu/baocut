import type { DoctorMessages } from './doctor-copy.ts';

export const ko: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'BaoCut이 시작되지 않거나 무언가를 읽지 못하는 이유: 터미널이 찾는 baocut, CLI가 시작할 Runtime과 그 홈,',
    '자격 증명 저장소가 응답하는지, macOS의 전체 디스크 접근 권한. 각 검사는 ok, warn, fail, skip 중 하나이며',
    '해결 명령이 있으면 함께 보여 줍니다. next는 첫 번째 문제의 해결 명령입니다.',
    '읽기 전용: Runtime을 시작하지 않고 키도 읽지 않습니다(키체인 검사는 지어낸 키가 있는지만 묻습니다).',
    '해결 명령은 실행하기 전에 사용자에게 먼저 물어보세요.',
    '저장소에서 실행 중이면 Runtime 자체 점검도 실행해 각 네이티브 프로그램을 한 번씩 시작하고 빌드를 소스와 비교합니다.',
    '',
    '플래그: --json',
  ].join('\n'),
  checkName: {
    entry: '명령줄',
    runtime: 'Runtime',
    credentials: '자격 증명',
    fullDiskAccess: '전체 디스크 접근 권한',
    build: '빌드',
  },
  remedyLabel: '해결',

  entryApp: (found, version) => `터미널은 ${found}을(를) 실행합니다. BaoCut 앱${version ? ` ${version}` : ''}의 명령줄입니다`,
  entryOtherApp: (found, target, app) =>
    `터미널은 ${found}(${target})을(를) 실행합니다. ${app}에 있는 BaoCut 앱의 명령줄이 아닙니다`,
  entryNoApp: (found, target) => `터미널은 ${found}(${target})을(를) 실행합니다. BaoCut 앱을 찾지 못했습니다`,
  entryMissing: '터미널에서 baocut을 찾을 수 없습니다. BaoCut 앱에서 설치하세요(관리자 권한 필요 없음).',
  entryMissingNoApp: '터미널에서 baocut을 찾을 수 없고, 일반적인 위치에서 BaoCut 앱도 찾지 못했습니다',
  entryStandalone: (found, version) => `터미널은 BaoCut 명령줄 단독 패키지 ${version}인 ${found}을(를) 사용합니다`,
  entryOtherStandalone: (found, target, own) => `터미널은 ${found}(${target})을(를) 사용하며, ${own} 같은 BaoCut 명령줄 단독 패키지가 아닙니다`,
  entryMissingStandalone: '터미널에서 baocut을 찾을 수 없습니다. cli install로 이 명령줄 단독 패키지를 설치하세요(관리자 권한 불필요).',

  runtimeRunning: (version, pid, by) =>
    `실행 중: 버전 ${version}, 프로세스 ${pid}, ${by === 'cli' ? '명령줄' : 'BaoCut 앱'}에서 시작함`,
  runtimeStopped: (entry) => `실행 중이 아닙니다. 다음 명령이 ${entry}(으)로 백그라운드에서 시작합니다`,
  runtimeUnreachable: (pid, reason) => `Runtime이 실행 중이지만(프로세스 ${pid}) 응답하지 않습니다: ${reason}`,
  runtimeNoLaunch:
    '실행 중이 아니고 시작할 Runtime도 없습니다: BaoCut 앱을 설치하거나, 저장소에서 실행하거나, BAOCUT_RUNTIME_ENTRY를 Runtime 진입점으로 설정하세요.',

  credentialsFile: (file) => `이 빌드는 키를 파일에 보관합니다: ${file}`,
  credentialsKeychain: (platform) => (platform === 'win32' ? 'Windows 자격 증명 관리자가 응답합니다' : 'macOS 키체인이 응답합니다'),
  credentialsDenied:
    '키체인이 접근을 거부했습니다. SSH로 접속했거나 데스크탑에 로그인하지 않은 상태에서는 macOS가 키체인을 잠근 채로 둘 수 있습니다. 데스크탑의 터미널에서 baocut을 실행하거나 로그인 키체인의 잠금을 해제하세요.',
  credentialsNoHelper: (file) =>
    `자격 증명 도우미${file ? `(${file})` : ''}가 없어 키를 읽을 수 없습니다. BaoCut 앱을 다시 설치하세요.`,
  credentialsUnavailable: (reason) => `자격 증명 저장소에 연결하지 못했습니다: ${reason}`,
  credentialsUnknown: '키를 어디에 보관할지는 BAOCUT_RUNTIME_ENTRY가 정합니다. 확인하지 않았습니다',
  credentialsTimedOut: (seconds) => `도우미가 ${seconds}초 안에 응답하지 않았습니다`,

  fdaGranted: '전체 디스크 접근 권한이 켜져 있습니다',
  fdaMissingApp:
    'BaoCut.app의 전체 디스크 접근 권한이 꺼져 있어 보호된 위치(데스크탑, 문서, 다운로드, 다른 드라이브)의 파일을 읽지 못할 수 있습니다. 시스템 설정 › 개인정보 보호 및 보안 › 전체 디스크 접근 권한에서 BaoCut을 켠 다음 baocut doctor를 다시 실행하세요.',
  fdaMissingCli: (app) =>
    `명령줄이 시작한 Runtime의 전체 디스크 접근 권한이 꺼져 있습니다. macOS는 이를 ${app ?? '명령을 실행한 앱(터미널 또는 Agent를 실행하는 앱)'}의 권한으로 봅니다. 시스템 설정 › 개인정보 보호 및 보안 › 전체 디스크 접근 권한에서 그 앱을 켜고 다시 열거나, 이 Runtime을 중지하고(baocut runtime stop) BaoCut 앱을 여세요. 그런 다음 baocut doctor를 다시 실행하세요.`,
  fdaMissingOwn: (app) =>
    `명령줄이 시작한 Runtime의 전체 디스크 접근 권한이 꺼져 있습니다. 이 Runtime은 ${app}(으)로 따로 실행되므로 macOS는 이를 터미널이 아닌 ${app}의 권한으로 봅니다. 시스템 설정 › 개인정보 보호 및 보안 › 전체 디스크 접근 권한에서 ${app}을(를) 켜고, 이 Runtime을 중지한 다음(baocut runtime stop) baocut doctor를 다시 실행하세요.`,
  fdaNotRunning: 'Runtime이 실행 중일 때만 확인합니다',
  buildOk: (count) => `네이티브 프로그램이 모두 시작되고 빌드 ${count}개가 소스와 일치합니다`,
  buildNotSource: 'Runtime을 저장소에서 실행할 때 점검합니다',
  buildFailed: (reason) => `Runtime 자체 점검이 끝나지 않았습니다: ${reason}`,
  buildTimedOut: (seconds) => `${seconds}초 안에 응답이 없었습니다`,
  buildProblems: (count, first) =>
    count === 1 ? `Runtime 자체 점검에서 문제를 발견했습니다: ${first}` : `Runtime 자체 점검에서 문제 ${count}개를 발견했습니다. 첫 번째: ${first}`,
  buildMore: (first, more) => `${first} (외 ${more}개)`,
};
