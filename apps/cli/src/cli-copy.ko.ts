import type { CliMessages } from './cli-copy.ts';

export const ko: CliMessages = {
  helpTagline:
    'baocut: BaoCut으로 영상을 전사, 번역, 편집, 더빙하고 내보냅니다. 먼저 `baocut status`를 실행해 이 컴퓨터에서 할 수 있는 일을 확인하세요.',
  helpFlows: '플로(처리를 반환하며, 기본적으로 끝날 때까지 기다림)',
  helpObjects: '객체',
  helpAdmin: '로컬 관리(사람용. Agent는 먼저 사용자에게 물어볼 것)',
  helpMore: '더 보기',
  helpMoreHelp: '매개변수, 효과, 예시',
  helpMoreSpec: '기계가 읽을 수 있는 카탈로그(JSON)',
  helpMoreStatus: '이 컴퓨터에서 지금 할 수 있는 일',
  helpGlobalFlags: '--json --project <폴더> --yes --max-bytes <n> --result-file <파일> --no-start',
  helpJobFlags: '처리: --no-wait --timeout <초> --progress jsonl',
  helpAdminVerbs: '로컬 관리',
  helpGroupMore: (noun) => `매개변수와 예시는 baocut help ${noun} <명령>에서 확인하세요.`,
  helpFlagsPlaceholder: '[플래그]',
  effectLabel: (effect) => `효과: ${effect}`,
  effectQuery: 'query(읽기 전용)',
  effectMutation: 'mutation(상태 변경)',
  effectJob: 'job(처리를 반환하며, 기본적으로 끝날 때까지 기다림)',
  effectDestructive: 'destructive(되돌릴 수 없음, --yes 필요)',
  helpParameters: '매개변수',
  helpNoParameters: '(없음)',
  helpRequired: '필수',
  helpRepeatable: '반복 가능',
  helpPositionalNote: (positional, flag) => `${positional}은(는) 위치 인수 또는 ${flag} 중 하나로만 지정할 수 있습니다.`,
  helpExamples: '예시',
  helpCommonFlags: '공통 플래그',

  nextLabel: '다음',
  errorLabel: '오류',
  runtimeStartedNote: '(백그라운드에서 BaoCut Runtime을 시작했습니다. 유휴 상태가 되면 스스로 종료합니다)',
  spilledNote: (maxBytes) =>
    `결과가 ${maxBytes}바이트보다 큽니다: 전체 결과는 path가 가리키는 파일(JSON)에 있습니다. coverage에는 최상위 키와 배열 길이가, summary에는 짧은 필드가 들어 있습니다. 파일을 읽거나, continueWith.paging의 플래그로 요청을 좁히거나, --max-bytes continueWith.maxBytes로 다시 실행하세요.`,
  resultFileWritten:
    '--result-file 요청에 따라 전체 결과를 path가 가리키는 파일(JSON)에 썼습니다. coverage에는 최상위 키와 배열 길이가, summary에는 짧은 필드가 들어 있습니다.',

  unknownCommand: (command) => `알 수 없는 명령: ${command}. baocut --help로 명령 목록을 확인하세요.`,
  unknownFlag: (flag, command) => `baocut ${command}에는 ${flag} 플래그가 없습니다. 자세한 내용은 baocut help ${command}에서 확인하세요.`,
  missingValue: (flag) => `${flag}에는 값이 필요합니다.`,
  noValueExpected: (flag) => `${flag}은(는) 스위치라서 값을 받지 않습니다.`,
  duplicateFlag: (flag) => `${flag}을(를) 두 번 이상 지정했습니다.`,
  badNumber: (flag, value) => `${flag}에는 숫자가 필요합니다. 받은 값: “${value}”.`,
  badInteger: (flag, value) => `${flag}에는 정수가 필요합니다. 받은 값: “${value}”.`,
  badBoolean: (flag, value) => `${flag}에는 true 또는 false가 필요합니다. 받은 값: “${value}”.`,
  badChoice: (flag, value, choices) => `${flag}은(는) ${choices.join(', ')} 중 하나여야 합니다. 받은 값: “${value}”.`,
  badValue: (flag, value) => `“${value}”은(는) ${flag}에 쓸 수 없는 값입니다.`,
  badJson: (flag, reason) => `${flag}에는 JSON이 필요합니다(리터럴, @파일 또는 표준 입력을 뜻하는 -): ${reason}`,
  expectedObject: (flag) => `${flag}에는 JSON 객체가 필요합니다.`,
  readFileFailed: (flag, file, reason) => `${flag}에 지정한 ${file} 파일을 읽지 못했습니다: ${reason}`,
  stdinTwice: (flag) => `표준 입력은 한 번만 읽을 수 있습니다(${flag}에서 다시 요청함).`,
  noPositional: (command, value) => `baocut ${command}은(는) 위치 인수를 받지 않습니다(받은 값: “${value}”). 플래그를 쓰세요.`,
  tooManyPositionals: (command, extra) => `baocut ${command}은(는) 위치 인수를 하나만 받습니다. 남는 인수: ${extra}`,
  positionalAndFlag: (field, flag) => `${field}을(를) 위치 인수와 ${flag}(으)로 모두 지정했습니다. 하나만 지정하세요.`,
  missingRequired: (names, command) => `${names}이(가) 없습니다. 자세한 내용은 baocut help ${command}에서 확인하세요.`,
  dryRunUnsupported: (command) => `baocut ${command}에는 --dry-run이 없습니다.`,
  projectNotDirectory: (value) => `--project ${value}은(는) 폴더가 아닙니다.`,
  confirmationRequired: (command, summary) =>
    `baocut ${command}은(는) 되돌릴 수 없어 실행하지 않았습니다. 실행하면 다음을 수행합니다: ${summary} 사용자가 동의하면 --yes를 붙여 다시 실행하세요.`,
  confirmationNext: (command) => `baocut ${command} … --yes(사용자가 동의한 뒤)`,
  unknownSpec: (name) => `이름이 ${name}인 도구가 없습니다. baocut spec에서 전체 카탈로그를 볼 수 있습니다.`,
  unknownEditOp: (op) => `edits apply에는 이름이 ${op}인 연산이 없습니다. baocut edits ops에서 목록을 볼 수 있습니다.`,
  catalogUnavailable: (command) =>
    `오프라인 카탈로그 스냅샷이 없고 실행 중인 Runtime도 없습니다. 저장소에서 \`${command}\`로 스냅샷을 만들거나 baocut runtime ensure로 Runtime을 시작하세요.`,
  runtimeUsage: '사용법: baocut runtime ensure | status | stop',
  installConfirmationRequired: (bundleId, size, source) =>
    `로컬 모델 ${bundleId}을(를) 설치하려면 ${source}에서 ${size}을(를) 다운로드해야 합니다. 아무것도 다운로드하지 않았습니다. 사용자에게 크기를 알리고 동의하면 --yes를 붙여 다시 실행하세요.`,
  sizeEstimated: '(추정)',

  metaHelp: {
    help: 'baocut help [<명령>]\n\n명령 없이 실행하면 한 화면 개요를 보여 줍니다. 명령을 지정하면(`help videos`, `help videos inspect`, `help runtime`) 그 명령의 매개변수, 효과, 예시를 보여 줍니다. 실행 중인 Runtime이 있으면 그 카탈로그를, 없으면 오프라인 스냅샷을 씁니다. Runtime을 시작하지 않습니다.',
    spec: 'baocut spec [<이름>]\n\n기계가 읽을 수 있는 카탈로그를 봉투 없는 JSON으로 출력하며 인터페이스 버전을 포함합니다. <이름>은 도구 이름(videos_inspect), 점 표기 이름(videos.inspect), 명령(videos inspect) 또는 edits apply의 연산 하나를 뜻하는 edits.<연산>입니다. 실행 중인 Runtime이 있으면 그 카탈로그를, 없으면 오프라인 스냅샷을 씁니다. Runtime을 시작하지 않습니다.',
    version:
      'baocut version\n\n이 CLI의 버전과 실행 중인 Runtime의 버전, 양쪽의 도구 인터페이스 버전과 일치 여부를 보여 줍니다. 봉투 없는 JSON이며 Runtime을 시작하지 않습니다.',
    status:
      'baocut status [--full] [--no-start]\n\n이 컴퓨터에서 지금 할 수 있는 일: Runtime, 기능별 기본값과 사용 가능 여부, 로컬 모델 번들과 외부 도구, 부족한 항목의 해결 명령. 실행 중인 Runtime이 없으면 시작합니다. --no-start를 지정하면 대신 running: false로 답합니다. 기능과 모델 번들은 요약으로 표시합니다. --full을 붙이면 각 공급자의 모델, 매개변수, 제한과 모델 번들 상세 정보도 표시합니다.',
    runtime: [
      'baocut runtime ensure | status | stop',
      '',
      '이 CLI가 통신하는 BaoCut Runtime(BAOCUT_HOME마다 하나).',
      '  ensure   실행 중인 Runtime을 찾거나 백그라운드에서 시작합니다. CLI가 시작한 Runtime은 유휴 상태(연결, 처리,',
      '           열린 서비스 없음)로 runtime.idleExitMinutes가 지나면 스스로 종료합니다',
      '  status   실행 여부, 시작한 주체, 연결, 진행 중인 처리, 열린 서비스, 유휴 종료 정보. Runtime을 시작하지 않습니다',
      '  stop     CLI가 시작한 Runtime을 중지합니다. 데스크톱 앱이나 다른 주체가 시작했으면 RUNTIME_NOT_OWNED,',
      '           데스크톱 앱, 다른 CLI 또는 끝나지 않은 처리가 사용 중이면 RUNTIME_IN_USE(종료 코드 1)',
      '',
      '플래그: --json  --no-start(ensure: 시작하지 않고 종료 코드 3으로 실패)',
    ].join('\n'),
  },

  runtimeNotRunning: (home) => `${home}에 대해 실행 중인 BaoCut Runtime이 없고 --no-start가 지정되었습니다.`,
  runtimeNoEntry:
    '실행 중인 BaoCut Runtime이 없고 시작할 수도 없습니다: BaoCut 앱을 설치하거나, 저장소에서 실행하거나, BAOCUT_RUNTIME_ENTRY를 Runtime 진입점으로 설정하세요.',
  runtimeStartFailed: (reason, log) => `BaoCut Runtime을 시작하지 못했습니다(${reason}). ${log} 파일을 확인하세요.`,
  runtimeStartTimeout: (seconds, log) => `BaoCut Runtime이 ${seconds}초 안에 준비되지 않았습니다. ${log} 파일을 확인하세요.`,
  exitedWith: (code) => `종료됨(종료 코드 ${code ?? '알 수 없음'})`,
  runtimeConnectFailed: (reason) => `BaoCut Runtime에 연결하지 못했습니다: ${reason}`,
  runtimeLost: (reason) => `BaoCut Runtime과의 연결이 끊어졌습니다: ${reason}`,
  protocolMismatch: (reason) => `이 CLI와 BaoCut Runtime의 프로토콜 버전이 다릅니다: ${reason}. 오래된 쪽을 업데이트하세요.`,
  interfaceMismatch: (cli, runtime, update) =>
    `이 CLI의 도구 인터페이스 버전은 ${cli}, Runtime은 ${runtime}입니다. ${update === 'cli' ? 'CLI를 업데이트하세요.' : 'BaoCut 앱을 업데이트하세요(또는 CLI와 같은 체크아웃에서 Runtime을 다시 시작하세요).'}`,

  jobCancelling: (jobId) => `${jobId} 처리를 취소하는 중…(바로 기다림을 멈추려면 Ctrl-C를 한 번 더 누르세요)`,
  jobCancelFailed: (reason) => `처리를 취소하지 못했습니다: ${reason}`,
  jobEnded: (state) => `처리가 끝났습니다: ${state}.`,
  statusFullNext:
    'baocut status --full은 각 기능의 모든 공급자와 모델을 표시합니다. 기능 하나를 보려면 baocut models capabilities --capability <capability>를, 모델 번들 상세 정보를 보려면 baocut models list를 실행하세요.',
  waitTimeout: (seconds, jobId) => `${seconds}초가 지나 기다림을 멈췄습니다. 처리 ${jobId}은(는) 계속 실행됩니다.`,

  noRuntimeClient: '이 명령은 Runtime에 연결하지 않습니다',
};
