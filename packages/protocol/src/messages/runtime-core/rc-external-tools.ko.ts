import type { RcExternalToolsMessages } from './rc-external-tools.ts';

const WIN_ADMIN = '관리자 권한으로 터미널을 열고 이 명령을 실행하세요.';

export const ko: RcExternalToolsMessages = {
  manageOnlyInAppOrCli: '외부 도구는 데스크톱 앱이나 CLI에서만 관리할 수 있습니다',
  videoNotOpen: '영상이 열려 있지 않습니다',

  toolUpdating: (p) => `${p.label} 업데이트 중`,
  waitForUpdate: (p) => `업데이트 작업 ${p.jobId}이(가) 끝난 뒤 다시 시도하세요`,
  toolNotInstalled: (p) => `${p.label}이(가) 설치되어 있지 않습니다`,
  toolCannotRun: (p) => `${p.label}을(를) 실행할 수 없습니다: ${p.reason}`,
  toolOutdated: (p) => `${p.label} 버전이 오래되었습니다: ${p.reason}`,
  consentRevoked: (p) => `${p.label} 사용 동의가 철회되었습니다`,
  consentRequired: (p) => `${p.label}을(를) 사용하려면 먼저 사용자의 동의가 필요합니다`,
  consentRemedy: (p) =>
    `사용자가 동의한 뒤 다시 시도하세요: externalTools.consent(baocut external-tools consent ${p.name}) 또는 설치하면서 동의(externalTools.install에 consent: true 지정)`,

  notExecutable: (p) => `${p.path}은(는) 실행 파일이 아닙니다`,
  notWindowsProgram: (p) => `${p.path}은(는) Windows 프로그램(.exe)이 아닙니다. BaoCut은 명령 인터프리터를 통해 외부 도구를 실행하지 않습니다`,
  cannotRunAs: (p) => `${p.path}을(를) ${p.label}(으)로 실행할 수 없습니다: ${p.reason}`,
  noVersion: '버전을 읽지 못했습니다',
  toolInUse: (p) => `${p.label}을(를) 설치하는 중이거나 작업에서 사용 중입니다`,
  notDownloadedByBaocut: (p) => `BaoCut은 ${p.label}을(를) 다운로드하지 않습니다: ${p.remedy}`,
  downloadNeedsConsent: (p) => `${p.label}을(를) 다운로드하려면 사용자의 동의가 필요합니다. 먼저 출처, 버전, 크기, 라이선스를 확인하세요`,
  offlineStrictNoDownload: '엄격한 오프라인 모드에서는 외부 도구를 다운로드하지 않습니다',
  cannotDownload: (p) => `${p.label}을(를) 다운로드할 수 없습니다: ${p.reason}`,
  manifestIncompleteRemedy: (p) =>
    `BaoCut이 매니페스트를 업데이트할 때까지 기다리거나, ${p.label}을(를) 직접 설치한 뒤 externalTools.setPath로 경로를 지정하세요`,
  updateManagedCopy: (p) => `사용 중인 ${p.label}은(는) BaoCut이 다운로드한 사본이므로 설치 프로그램으로 업데이트하지 않습니다`,
  updateUnknownInstall: (p) => `${p.path}이(가) 어떻게 설치되었는지 알 수 없습니다`,
  updateNoRunnable: (p) => `실행 가능한 ${p.label}을(를) 찾지 못했습니다`,
  updateManagedRemedy: 'externalTools.install로 매니페스트의 버전으로 전환하세요',
  updateManualRemedy: '설치했던 방식대로 터미널에서 업데이트한 뒤 다시 감지하세요(externalTools.detect)',
  cannotUpdateFor: (p) => `BaoCut에서 ${p.label}을(를) 대신 업데이트할 수 없습니다`,
  runInTerminalRemedy: (p) => `터미널에서 ${p.command} 명령을 실행한 뒤 다시 감지하세요(externalTools.detect)`,
  confirmUpdateCommand: (p) => `${p.label}을(를) 업데이트하려면 먼저 사용자가 이 명령을 확인해야 합니다: ${p.command}`,
  updateCommandChanged: (p) => `${p.label} 업데이트 명령이 바뀌었습니다. 다시 확인하세요: ${p.command}`,
  offlineStrictNoUpdate: '엄격한 오프라인 모드에서는 외부 도구를 업데이트하지 않습니다',
  unknownTool: (p) => `외부 도구 “${p.name}”이(가) 없습니다`,
  notManaged: (p) => `BaoCut은 ${p.label}을(를) 관리하지 않습니다: ${p.remedy}`,
  endpointInvalid: '외부 도구 다운로드 소스가 올바른 주소가 아닙니다',
  endpointBadForm: '외부 도구 다운로드 소스는 http(s)://로 시작하는 기본 주소여야 하며 자격 증명, 쿼리 매개변수, 프래그먼트를 포함할 수 없습니다',

  sourceEnvVar: (p) => `환경 변수 ${p.name}`,
  sourceUserPath: '지정한 경로',
  sourceManaged: 'BaoCut이 다운로드한 사본',
  commandNotFound: (p) => `${p.command}을(를) 찾을 수 없습니다`,
  commandNotFoundIn: (p) => `${p.where}에서 ${p.command}을(를) 찾을 수 없습니다`,
  sourceNotExecutable: (p) => `${p.where}: 실행 파일이 아닙니다`,
  sourceIsScript: (p) =>
    `${p.where}: Windows 프로그램(.exe)이 아니라 ${p.batch ? '배치 스크립트' : '스크립트'}입니다. BaoCut은 명령 인터프리터를 통해 외부 도구를 실행하지 않습니다`,
  setExePathRemedy: (p) =>
    `externalTools.setPath로 ${p.command}.exe 경로를 지정하세요${p.canInstall ? '. 또는 externalTools.install로 다운로드하세요' : ''}`,
  belowMinVersion: (p) => `${p.version} 버전은 최소 버전 ${p.min}보다 낮습니다`,
  installOrUpdateRemedy: (p) => `externalTools.install로 ${p.version} 버전을 다운로드하거나 시스템의 ${p.label}을(를) 업데이트하세요`,
  updateTool: (p) => `${p.label} 업데이트`,

  diskFull: '도구 파일을 쓰는 중에 디스크가 가득 찼습니다',
  downloadedCannotRun: (p) => `다운로드한 ${p.label}을(를) 실행할 수 없습니다: ${p.reason}`,
  updateStopped: '업데이트가 중지되었습니다',
  updateExited: (p) => `업데이트 명령이 종료되었습니다(${p.code})`,
  updateTimedOut: (p) => `업데이트 명령이 ${p.minutes}분 안에 끝나지 않아 중지했습니다`,
  updateSignalled: (p) => `업데이트 명령이 시그널 ${p.signal}에 의해 종료되었습니다`,
  updateCannotStart: (p) => `업데이트 명령을 시작하지 못했습니다(${p.reason})`,
  updateFailedRemedy: (p) => `작업의 출력을 확인하거나, 터미널에서 ${p.command} 명령을 실행한 뒤 다시 감지하세요`,

  remedyNoSpace: 'Runtime Home이 있는 디스크의 공간이 부족합니다. 공간을 확보한 뒤 다시 설치하세요',
  remedyNetwork:
    '네트워크에 연결할 수 없거나 다운로드가 중단되었습니다. 네트워크를 확인하고 다시 설치하거나(다운로드한 부분부터 이어 받음) 설정 › 일반의 “도구 다운로드 소스”에서 미러를 바꾸세요',
  remedyIntegrity:
    '다운로드한 파일이 매니페스트의 크기 또는 sha256과 일치하지 않습니다(소스나 미러의 내용이 잘못됨). 잘못된 파일은 삭제했습니다. 다른 다운로드 소스로 바꾼 뒤 다시 설치하세요',
  remedySource:
    '다운로드 소스에 이 파일이 없거나 접근을 거부했습니다. 설정 › 일반의 “도구 다운로드 소스”(또는 BAOCUT_TOOLS_ENDPOINT 환경 변수)에 지정한 미러를 확인하세요',
  downloadFailed: (p) => `${p.file} 다운로드 실패: ${p.reason}`,
  integrityMismatch: (p) => `${p.file} 파일이 매니페스트의 크기 또는 sha256과 일치하지 않습니다`,
  sourceHttpStatus: (p) => `다운로드 소스에서 ${p.file} 파일에 대해 HTTP ${p.status} 상태를 반환했습니다`,
  largerThanManifest: (p) => `${p.file} 파일이 매니페스트에 적힌 것보다 큽니다`,

  ytDlpLicense: 'Unlicense(소스 코드). 단독 실행 파일에는 GPLv3+ 구성 요소가 포함되어 전체가 GPLv3+입니다',
  ytDlpPurpose: '링크에서 가져오기: 영상 페이지를 읽고 미디어와 자막을 다운로드합니다',
  ytDlpMissingRemedy:
    'externalTools.install(baocut external-tools install yt-dlp)로 다운로드하거나, 직접 설치한 뒤 externalTools.setPath로 경로를 지정하세요',
  ffmpegPurpose: '미디어 분석, 파일 트랜스코딩, 내보내기, 다운로드 후 오디오와 영상 병합',
  noReleaseForPlatform: (p) => `이 컴퓨터(${p.platform})용 릴리스 파일이 없습니다`,
  noTrustedSha: '기본 제공 매니페스트에 아직 이 파일의 신뢰할 수 있는 sha256이 없어 다운로드할 수 없습니다',

  probeCannotStart: (p) => `시작할 수 없습니다: ${p.error}`,
  probeTimeout: (p) => `${p.command} 명령이 ${p.seconds}초 안에 끝나지 않았습니다`,
  probeCannotStartCode: (p) => `시작할 수 없습니다(${p.code})`,
  probeExited: (p) => `종료됨(${p.code})${p.detail ? `: ${p.detail}` : ''}`,

  pipxMissing: (p) => `이 ${p.label}은(는) pipx로 설치되었지만 PATH에 pipx가 없습니다.`,
  brewMissing: (p) => `이 ${p.label}은(는) Homebrew로 설치되었지만 해당 Homebrew의 ${p.brew}을(를) 찾을 수 없습니다.`,
  wingetMachineWide: (p) =>
    `이 ${p.label}은(는) winget으로 모든 사용자용으로 설치되어(${p.dir}) 업데이트하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. ${WIN_ADMIN}`,
  wingetMissing: (p) => `이 ${p.label}은(는) winget으로 설치되었지만 PATH에 winget이 없습니다.`,
  scoopGlobal: (p) =>
    `이 ${p.label}은(는) Scoop 전역 설치(${p.dir})라 업데이트하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. ${WIN_ADMIN}`,
  scoopMissing: (p) => `이 ${p.label}은(는) Scoop으로 설치되었지만 Scoop 자체를 찾을 수 없습니다(${p.script}).`,
  chocolateyAdmin: `Chocolatey로 설치한 프로그램은 업데이트하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. ${WIN_ADMIN}`,
  pythonScriptMissing: '이 진입 스크립트가 가리키는 Python 인터프리터가 더 이상 없습니다.',
  pipAdmin: (p) =>
    `이 ${p.label}은(는) ${p.dir}에 설치되어 있어 변경하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. 설치했던 방식대로 업데이트하세요.`,
  pythonLauncherMissing: '이 진입 프로그램이 가리키는 Python 인터프리터가 더 이상 없습니다.',
  pipAdminWin: (p) =>
    `이 ${p.label}은(는) ${p.dir}에 설치되어 있어 변경하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. ${WIN_ADMIN}`,
  standaloneAdmin: (p) => `이 ${p.label}이(가) 있는 ${p.dir}은(는) 변경하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다.`,
  standaloneAdminWin: (p) =>
    `이 ${p.label}이(가) 있는 ${p.dir}은(는) 변경하려면 관리자 권한이 필요하며, BaoCut은 권한을 대신 올리지 않습니다. ${WIN_ADMIN}`,
};
