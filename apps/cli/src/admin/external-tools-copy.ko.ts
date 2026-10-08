import type { ToolsMessages } from './external-tools-copy.ts';

export const ko: ToolsMessages = {
  help: `사용법:
  baocut external-tools [list]     외부 도구(yt-dlp, ffmpeg): 상태, 버전, 경로, 출처,
                                   사용 동의 여부
  baocut external-tools detect [이름]
                                   다시 감지합니다
  baocut external-tools install <이름> [--yes]
                                   Runtime Home의 tools/에 관리 사본을 다운로드합니다. 출처, 버전, 크기, 라이선스를
                                   먼저 보여 주고 확인 후 다운로드하며 sha256을 검증합니다(--yes는 동의를 뜻함).
                                   다운로드 출처: 설정 tools.downloadEndpoint와 환경 변수 BAOCUT_TOOLS_ENDPOINT
  baocut external-tools update <이름> [--yes]
                                   시스템에 있는 사본을 원래 설치 방식(Homebrew, pipx, pip 또는 공식 독립 실행
                                   프로그램)으로 업데이트합니다. 실행할 전체 명령을 먼저 보여 주고 확인 후 Runtime이
                                   실행하며(--yes는 확인을 뜻함), 출력을 한 줄씩 보여 주고 끝나면 다시 감지합니다.
                                   관리자 권한이 필요한 명령은 출력만 하니 터미널에서 직접 실행하세요
  baocut external-tools path <이름> <파일>|--clear
                                   직접 설치한 사본을 사용합니다(--version을 한 번 실행해 확인). --clear는 지정을 해제합니다
  baocut external-tools remove <이름>
                                   관리 사본을 삭제합니다(시스템 사본과 지정한 사본은 건드리지 않음)
  baocut external-tools consent <이름> [--revoke]
                                   다운로드 도구 사용에 동의하거나 동의를 철회합니다(철회하면 링크에서 가져오기가 거부됨)`,
  usage:
    '사용법: baocut external-tools [list] | detect [이름] | install <이름> [--yes] | update <이름> [--yes] | path <이름> <파일>|--clear | remove <이름> | consent <이름> [--revoke]',
  clearOrFile: '--clear와 파일 중 하나만 지정하세요',
  stateLabels: {
    installed: '설치됨',
    missing: '설치되지 않음',
    outdated: '업데이트 가능',
    unavailable: '사용할 수 없음',
  },
  sourceLabels: {
    system: '시스템 PATH',
    user: '지정한 경로',
    managed: 'BaoCut이 다운로드한 사본',
    env: '환경 변수',
  },
  updateMethodLabels: {
    homebrew: 'Homebrew',
    pipx: 'pipx',
    pip: 'pip',
    standalone: '공식 독립 실행 빌드',
    winget: 'winget',
    scoop: 'Scoop',
    chocolatey: 'Chocolatey',
  },
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ''}${source ? `(${source})` : ''}  ${purpose}`,
  pathLine: (path: string) => `  경로: ${path}`,
  userPathLine: (path: string) => `  지정한 경로: ${path}`,
  managedLine: (version: string, path: string) => `  관리 사본: ${version}  ${path}`,
  consentLine: (label: string) => `  동의: ${label}`,
  installingLine: (jobId: string) => `  설치 중: 작업 ${jobId}`,
  updatingLine: (jobId: string) => `  업데이트 중: 작업 ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  업데이트: ${command}(${method}${runnable ? '' : ', 터미널에서 직접 실행하세요'})`,
  reasonLine: (reason: string) => `  이유: ${reason}`,
  remedyLine: (remedy: string) => `  해결: ${remedy}`,
  consentMissing: (name: string) => `아직 동의하지 않음(사용하기 전에 동의하세요: baocut external-tools consent ${name})`,
  consentVia: { agent: 'Agent의 승인을 통해', cli: 'CLI에서', app: '앱에서' },
  consentGranted: (at: string, via: string) => `동의함(${at}, ${via})`,
  consentRevoked: (at: string) => `철회됨(${at})`,
  noTools: '등록된 외부 도구가 없습니다',
  cannotUpdate: (label: string, reason: string) => `${label}은(는) 대신 업데이트할 수 없습니다: ${reason}`,
  runInTerminal: '터미널에서 다음을 실행하세요:',
  redetect: (name: string) => `완료 후 다시 확인하세요: baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `원래 설치 방식(${method})으로 ${label}${version ? ` ${version}` : ''}을(를) 업데이트합니다`,
  runLine: (command: string) => `  실행: ${command}`,
  updatePrompt: (label: string) => `이 컴퓨터에서 이 명령을 실행해 ${label}을(를) 업데이트할까요? [y/N] `,
  omittedLines: (n: number) => `…(${n}줄 생략)`,
  updated: (label: string, before: string | null, after: string) => `${label}을(를) 업데이트했습니다: ${before ?? '알 수 없는 버전'} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label}은(는) 최신 버전입니다${version ? `(${version})` : ''}`,
  sizeEstimated: (size: string) => `약 ${size}(크기를 알 수 없어 추정함)`,
  sizeAbout: (size: string) => `약 ${size}`,
  willDownload: (label: string, version: string) => `${label} ${version}을(를) 다운로드합니다`,
  sourceLine: (url: string | null) => `  출처: ${url ?? '(이 컴퓨터에서 쓸 수 있는 파일이 없음)'}`,
  sizeLine: (size: string) => `  크기: ${size}`,
  licenseLine: (license: string) => `  라이선스: ${license}`,
  homepageLine: (url: string) => `  홈페이지: ${url}`,
  sha256Line: (hash: string) => `  sha256: ${hash}`,
  blockedLine: (reason: string) => `  다운로드할 수 없음: ${reason}`,
  installPrompt: (label: string, version: string, size: string) => `${label} ${version}(${size})을(를) 다운로드해 사용할까요? [y/N] `,
  noExternalTool: (name) => `외부 도구 “${name}”이(가) 없습니다`,
  alreadyInstalling: (jobId) => `이미 설치 중입니다(작업 ${jobId}). 진행 상황을 표시합니다`,
  installDone: '설치를 완료했습니다',
  notDownloadedByBaoCut: (label, remedy) => `${label}은(는) BaoCut이 다운로드하지 않습니다: ${remedy ?? '직접 설치하세요'}`,
  cannotDownload: (label, reason) => `${label}을(를) 다운로드할 수 없습니다: ${reason}`,
  notTtyAgreeDownload: '터미널에서 실행 중이 아닙니다: 사용자가 다운로드에 동의하면 --yes를 추가하세요',
  notTtyConfirmRun: '터미널에서 실행 중이 아닙니다: 사용자가 실행을 확인하면 --yes를 추가하세요',
  notDownloaded: '다운로드하지 않았습니다',
  notRun: '실행하지 않았습니다',
  remedy: (remedy) => `해결 방법: ${remedy}`,
  partialDownloadKept: (name) => `다운로드한 부분은 보관했습니다: baocut external-tools install ${name}을(를) 실행하면 이어서 받습니다`,
  alreadyUpdating: (jobId) => `이미 업데이트 중입니다(작업 ${jobId}). 출력을 표시합니다`,
  managedCopy: (label, name) =>
    `지금 사용 중인 ${label}은(는) BaoCut이 다운로드한 사본입니다: 버전을 바꾸려면 baocut external-tools install ${name}을(를) 사용하세요`,
  unknownInstall: (file, name) =>
    `${file}이(가) 어떻게 설치되었는지 알 수 없습니다: 원래 설치 방식대로 터미널에서 업데이트한 뒤 baocut external-tools detect ${name}을(를) 실행하세요`,
  noRunnableTool: (label, remedy) => `실행할 수 있는 ${label}을(를) 찾지 못했습니다: ${remedy}`,
  updateManual: (label, command) => `${label} 업데이트는 터미널에서 직접 실행해야 합니다: ${command}`,
  partialCommand: (name) =>
    `명령이 일부만 실행되었을 수 있습니다: baocut external-tools detect ${name}을(를) 실행해 현재 버전을 확인하세요`,
};
