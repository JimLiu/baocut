import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const ko: ModelsMessages = {
  help: `사용법:
  baocut models cancel <bundleId> [--discard]
                                   설치를 멈춥니다(이미 다운로드한 부분은 보관되며 다시 install하면 이어서 받음).
                                   --discard는 그 부분도 삭제합니다
  baocut models repair <bundleId> [--yes]
                                   파일마다 sha256을 검증하고 없거나 손상된 파일만 다시 다운로드합니다
                                   (확인 방식은 install과 같음)
  baocut models dir                로컬 모델 폴더 보기: 위치, 출처, 사용 공간과 여유 공간, 인식된 모델 수
  baocut models dir --set <경로> [--move|--switch]
                                   모델 폴더를 바꿉니다: --move는 기존 모델을 옮기고(백그라운드 작업, 실패하면 롤백),
                                   --switch는 위치만 바꿉니다(이전 파일은 남고 새 위치에 이미 있는 모델만 사용 가능).
                                   현재 폴더에 모델이 있으면 둘 중 하나가 필요합니다. 로컬 모델을 쓰는 작업이 있으면
                                   거부되며, 환경 변수 BAOCUT_MODELS_DIR로 지정한 경우 읽기 전용입니다
  baocut models dir --reset [--move|--switch]
                                   기본 위치(<BAOCUT_HOME>/models)로 되돌립니다. 규칙은 --set과 같습니다
  baocut models configure <providerId> [옵션]
                                   온라인 공급자를 설정합니다: 카탈로그 공급자(openai, google, elevenlabs, anthropic, deepseek,
                                   qwen 등, baocut models capabilities 참고) 또는 OpenAI 호환 사용자 지정 엔드포인트 custom:<이름>.
                                   Agent 공급자 agent:codex는 켜기/끄기만 있습니다(이 컴퓨터의 Codex 로그인을 사용, 키 없음)
    --enable | --disable           사용(필요할 때 지속 허가로 소재의 오디오, 텍스트, 프롬프트를 보냄) 또는 사용 중지
    --key-stdin                    표준 입력에서 API 키를 읽습니다(명령줄 인수의 키는 받지 않음): 첫 번째 계정의
                                   키를 바꾸거나, 계정이 없으면 새로 만듭니다(계정이 여러 개라면
                                   baocut models accounts 사용)
    --endpoint <url>               사용자 지정 엔드포인트의 기본 URL(처음 설정할 때 필수). 카탈로그 공급자는 프록시나
                                   게이트웨이를 가리키도록 바꿀 수 있습니다
    --model <id> ...               사용자 지정 엔드포인트가 제공하는 전사 모델(반복 가능, 첫 번째가 기본값)
    --speech-model <id> ...        사용자 지정 엔드포인트가 제공하는 음성 합성 모델(/audio/speech, 반복 가능)
    --image-model <id> ...         사용자 지정 엔드포인트가 제공하는 이미지 생성 모델(/images/generations, 반복 가능)
    --text-model <id> ...          사용자 지정 엔드포인트가 제공하는 텍스트 모델(/chat/completions, 반복 가능)
                                   어떤 종류든 모델을 지정하면 선언된 모델 전체가 바뀝니다
    --verify                       저장하기 전에 새 키와 엔드포인트를 공급자에게 한 번 검증합니다
  baocut models accounts <providerId>
                                   공급자의 계정 목록: 순서, 이름, 가린 키, 켜기/끄기, 상태(호출은 키가 있는 첫 번째
                                   사용 중인 계정을 쓰며, 오류가 나도 다음 계정으로 넘어가지 않음)
  baocut models accounts add <providerId> [--label <이름>] [--region <리전>] [--endpoint <url>] [--verify]
                                   계정을 추가합니다. 키는 표준 입력에서 읽습니다. --region은 카탈로그의 리전(global,
                                   cn 등)을 받습니다. --verify는 먼저 공급자에게 검증하고 실패하면 저장하지 않습니다.
                                   계정을 추가해도 공급자가 사용 설정되지는 않습니다
  baocut models accounts remove <providerId> <accountId|이름>
                                   계정과 그 키를 제거합니다(마지막 계정을 제거해도 공급자는 남고,
                                   쓸 수 있는 키만 없어짐)
  baocut models accounts use <providerId> <accountId|이름>
                                   우선 계정으로 설정: 이 계정을 맨 앞으로 옮깁니다
  baocut models usage [--period <${USAGE_PERIODS.join('|')}>] [--provider <id>]
                                   온라인 공급자와 Agent의 호출 수, 사용량, 지출(기본값은 최근 30일):
                                   정가로 추정한 금액, 공급자가 보고한 금액, 알 수 없는 비용을 따로 보여 주며
                                   통화는 환산하지 않습니다. 공급자, 기능, 모델, 계정별로 나눠 보여 줍니다
  baocut models default <기능> <providerId|none> [modelId]
                                   기능(${MODEL_SERVICE_CAPABILITIES.join(', ')})의 기본 공급자와 모델을 설정하거나 지웁니다
  baocut models remove <bundleId|providerId>
                                   로컬 모델 번들을 삭제합니다(다른 번들이 쓰는 공유 구성 요소는 남기며, 작업이
                                   사용 중이면 거부). 또는 온라인 공급자를 제거합니다: 사용자 지정 엔드포인트(custom:<이름>)는
                                   통째로 삭제하고, 카탈로그 공급자는 사용 중지한 뒤 모든 계정과 키를 삭제합니다
  baocut models refresh <providerId>
                                   온라인 공급자에서 모델(과 목소리) 목록을 가져와 캐시합니다: 목록에 없는 내장
                                   모델은 사용할 수 없음으로 표시합니다. 목록을 가져오지 못하면 이전처럼
                                   내장 목록을 씁니다
  baocut models parameters generateText [--effort <강도|default>] [--concurrency <n|default>]
                                   텍스트 생성의 기본 추론 강도와 공급자별 동시 요청 수 상한(기본값 4)을 보거나
                                   설정합니다. default는 초기값으로 되돌립니다`,
  byteProgressUnknown: (done) => `${done} 받음(전체 크기 알 수 없음)`,
  byteProgress: (done, total, percent) => `${done} / ${total}(${percent}%)`,
  bundleStates: {
    'not-installed': '설치되지 않음',
    downloading: '다운로드 중',
    installed: '설치됨',
    loading: '불러오는 중',
    ready: '준비됨',
    busy: '사용 중',
    unloading: '내리는 중',
    error: '사용할 수 없음',
  },
  installStates: {
    queued: '대기 중',
    downloading: '다운로드 중',
    verifying: '검증 및 게시 중',
    paused: '일시 중지됨',
  },
  bundleState: (label, state, reason) => `${label}(${state}${reason ? ` / ${reason}` : ''})`,
  componentInstalled: '설치됨',
  componentMissing: '없음',
  sharedWith: (bundles) => `  ${bundles.join(', ')}와(과) 공유`,
  installTask: (jobId) => `  작업 ${jobId}`,
  resumeHint: (bundleId) => `. baocut models install ${bundleId} 명령으로 이어서 받기`,
  installLine: (state, progress, task, hint) => `  설치: ${state}  ${progress}${task}${hint}`,
  checkPassed: '통과',
  checkFailed: (code) => `실패${code ? `(${code})` : ''}`,
  checkLine: (result, at, detail) => `  검사: ${result}  ${at}${detail ? `  ${detail}` : ''}`,
  remedyAppFileMissing: '해결 방법: BaoCut을 다시 설치하세요. 모델을 복구해도 해결되지 않습니다',
  remedyRepair: (bundleId) => `해결 방법: baocut models repair ${bundleId} 명령으로 손상된 파일만 다시 다운로드한 뒤 다시 검사하세요`,
  remedyMaybeRepair: (bundleId) =>
    `해결 방법: 먼저 baocut models repair ${bundleId} 명령을 실행해 보고(손상된 파일만 다시 다운로드) 다시 검사하세요`,
  remedyOutOfMemory: '해결 방법: 메모리를 많이 쓰는 다른 앱을 종료하거나 더 작은 모델을 고른 뒤 다시 검사하세요',
  remedy: (text) => `해결 방법: ${text}`,
  upToDate: (repair, bundleId) =>
    repair ? `${bundleId}의 파일이 모두 온전해 복구할 것이 없습니다` : `${bundleId}은(는) 이미 설치되어 다운로드할 것이 없습니다`,
  planHeader: (repair, bundleId, source) => `${bundleId} ${repair ? '복구' : '설치'}, 출처 ${source}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  설치됨, 유지`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  파일 ${files}개 다운로드, ${size}`,
  sizeUnknown: '크기 알 수 없음',
  toDownloadEstimate: (estimate) => `다운로드할 크기: 알 수 없음, 약 ${estimate}`,
  toDownload: (size) => `다운로드할 크기: ${size}`,
  resumed: (size) => `이어 받기: 스테이징 영역에 이미 ${size}이(가) 있어 다시 다운로드하지 않습니다`,
  freeSpace: (size, short) => `여유 공간: ${size}${short ? '(부족)' : ''}`,
  sizeAbout: (size) => `약 ${size}`,
  installPrompt: (repair, size) => `${repair ? '복구' : '설치'}하고 ${size}을(를) 다운로드할까요? [y/N] `,
  noSpace: (need, have) => `디스크 공간: ${need}이(가) 필요하지만 ${have}만 남아 있습니다`,
  removed: (files) => `삭제함: ${files.join(', ')}`,
  nothingRemoved: '삭제한 파일이 없습니다',
  keptInUse: (repo, users) => `${repo} 유지: ${users.join(', ')}에서 아직 사용 중`,
  keptOtherVersion: (repo) => `${repo} 유지: 폴더에 이 모델 번들에 속하지 않는 다른 버전이 있음`,
  dirSources: {
    default: '기본 위치',
    setting: '설정에서 고른 폴더',
    env: '환경 변수 BAOCUT_MODELS_DIR(읽기 전용: 바꾸려면 환경 변수를 바꾸고 BaoCut을 다시 시작하세요)',
  },
  dirSource: (label) => `  출처: ${label}`,
  dirMissing: '  이 폴더가 없습니다(외장 드라이브가 연결되지 않았을 때도 이렇게 됩니다)',
  dirNotWritable: '  BaoCut이 이 폴더에 쓸 수 없습니다',
  dirUsage: (used, free, models) => `  ${used} 사용${free ? ` · 이 디스크 여유 ${free}` : ''} · 모델 ${models}개 인식`,
  dirDefault: (path) => `  기본 위치: ${path}`,
  dirMoving: (to, jobId) => `  ${to ? `${to}(으)로 ` : ''}옮기는 중(작업 ${jobId})`,
  dirEnvLocked: '모델 폴더가 환경 변수 BAOCUT_MODELS_DIR로 지정되어 있습니다: 바꾸려면 환경 변수를 바꾸고 BaoCut을 다시 시작하세요',
  dirProblemMissing: '이 폴더가 없습니다: 외장 드라이브가 연결되지 않았을 때도 이렇게 됩니다. 연결한 뒤 다시 시도하세요',
  dirProblemNotWritable: 'BaoCut이 이 폴더에 쓸 수 없습니다: 쓸 수 있는 위치를 고르거나 먼저 권한을 바꾸세요',
  dirProblemNested: '새 위치와 현재 모델 폴더가 서로를 포함합니다: 그 안에 있지도 않고 그것을 포함하지도 않는 폴더를 고르세요',
  dirProblemSame: '이미 현재 모델 폴더입니다',
  dirFound: (count, size) => `다운로드된 모델 ${count}개를 찾았습니다(${size}). 바로 쓸 수 있습니다`,
  dirEmpty: '이 폴더에는 아직 모델이 없습니다. 이제부터 다운로드하는 모델은 여기에 저장됩니다',
  dirFree: (size) => `이 디스크 여유 ${size}`,
  moveSameVolume: '같은 디스크: 옮기기는 이름만 바꾸므로 추가 공간이 들지 않습니다',
  moveSize: (size, fits) => `${size} 옮기기${fits ? '' : '(공간 부족)'}`,
  dirCurrentHas: (size, move) => `현재 폴더에 모델 ${size}이(가) 있습니다: ${move}`,
  moveOrSwitch: '--move와 --switch 중 하나만 지정하세요',
  accountStates: {
    unknown: '검증 안 됨',
    ok: '정상',
    'invalid-key': '잘못된 키',
    'rate-limited': '속도 제한',
    'quota-exhausted': '할당량 소진',
  },
  rateLimitedUntil: (label, until) => `${label}(${until}까지)`,
  noAccounts: '아직 계정이 없습니다: baocut models accounts add <providerId>가 표준 입력에서 키를 읽습니다',
  accountEnabled: '사용 중',
  accountDisabled: '사용 중지됨',
  accountKeyUnreadable: '키를 읽을 수 없음',
  accountRegion: (region) => `리전 ${region}`,
  accountEndpoint: (endpoint) => `엔드포인트 ${endpoint}`,
  accountLastUsed: (at) => `마지막 사용 ${at}`,
  accountCurrent: '현재 사용 중',
  accountChoice: (accountId, label) => `${accountId}(${label})`,
  noAccountChoices: '계정 없음',
  listSep: ', ',
  accountAmbiguous: (count, ref, choices) => `이름이 “${ref}”인 계정이 ${count}개입니다. accountId를 쓰세요: ${choices}`,
  accountNotFound: (ref, choices) => `그런 계정이 없습니다: ${ref}(선택 가능: ${choices})`,
  usagePeriods: { today: '오늘', '7d': '최근 7일', '30d': '최근 30일', all: '전체 기간' },
  unitTokens: (input, output) => `입력 ${input} / 출력 ${output} 토큰`,
  unitCached: (cached) => `캐시 ${cached}`,
  unitAudio: (minutes) => `오디오 ${minutes}분`,
  unitChars: (chars) => `${chars}자`,
  unitImages: (images) => `이미지 ${images}장`,
  clauseSep: ', ',
  costKinds: {
    reported: '공급자 보고',
    estimated: '정가로 추정',
    mixed: '보고와 추정',
    unknown: '비용 알 수 없음',
  },
  rowCalls: (calls, failed) => `${calls}회${failed > 0 ? `(실패 ${failed}회)` : ''}`,
  costApprox: (money, kind) => `≈ ${money}(${kind})`,
  usageHeader: (scope, period, from, to) => `사용량(${scope ? `${scope}, ` : ''}${period}: ${from}~${to})`,
  noCalls: '  아직 호출이 없습니다',
  totalCalls: (calls, failed) => `  호출 ${calls}회${failed > 0 ? `(실패 ${failed}회)` : ''}`,
  usageUnits: (units) => `  사용량: ${units}`,
  spentEstimated: (money) => `  지출 ≈ ${money}(정가로 추정)`,
  spentReported: (money) => `  지출 ${money}(공급자 보고)`,
  unknownCostCalls: (calls) => `  그 밖에 호출 ${calls}회는 비용 알 수 없음`,
  noBilledCalls: '  청구된 호출 없음',
  byProvider: '공급자별',
  byCapability: '기능별',
  byModel: '모델별',
  byAccount: '계정별',
  usageRepair: '사용법: baocut models repair <bundleId> [--yes]',
  usageCancel: '사용법: baocut models cancel <bundleId> [--discard]',
  usageConfigure: '사용법: baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …',
  usageDefault: '사용법: baocut models default <기능> <providerId|none> [modelId]',
  usageRemove: '사용법: baocut models remove <bundleId|providerId>',
  usageRefresh: '사용법: baocut models refresh <providerId>',
  usageParameters: '사용법: baocut models parameters generateText [--effort <강도|default>] [--concurrency <n|default>]',
  usageAccounts:
    '사용법: baocut models accounts <providerId> | add <providerId> [--label <이름>] [--region <리전>] [--verify] | remove <providerId> <계정> | use <providerId> <계정>',
  usageDir: '사용법: baocut models dir [--set <경로> [--move|--switch] | --reset [--move|--switch]]',
  cancelledDiscarded: '중지하고 다운로드한 부분을 삭제했습니다',
  cancelledKept: '중지했습니다(다운로드한 부분은 보관되며 다시 install하면 이어서 받음)',
  unknownCapability: (capability, choices) => `알 수 없는 기능: ${capability}(${choices.join(', ')} 중 하나)`,
  clearDefaultNoModel: '기본값을 지울 때는 모델을 지정하지 마세요',
  defaultSet: (label, provider, model) => `${label} 기본값: ${provider} / ${model}`,
  defaultCleared: (label) => `${label} 기본값을 지웠습니다`,
  customProviderDeleted: (id) => `${id} 항목을 삭제했습니다(이를 가리키는 기본값은 남아 사용할 수 없음으로 표시됩니다)`,
  providerRemoved: (id) =>
    `${id} 항목을 제거했습니다: 사용을 중지하고 모든 계정과 키를 삭제했습니다(이를 가리키는 기본값은 남아 사용할 수 없음으로 표시됩니다)`,
  providerRefreshFailed: (id, error) => `${id} 항목을 새로 고치지 못했습니다: ${error ?? '알 수 없는 이유'}. 내장 모델 목록을 계속 씁니다`,
  providerRefreshed: (id, models, voices, at) =>
    `${id} 항목을 새로 고쳤습니다: 모델 ${models}개${voices !== undefined ? `, 목소리 ${voices}개` : ''}(${at})`,
  periodChoices: (periods) => `--period는 ${periods.join(', ')} 중 하나여야 합니다`,
  enableDisableConflict: '--enable과 --disable 중 하나만 지정하세요',
  saved: (description) => `저장했습니다: ${description}`,
  verifiedAndSaved: '검증하고 저장했습니다',
  savedPlain: '저장했습니다',
  providerNotEnabled: (id) => `${id}은(는) 아직 사용 설정되지 않았습니다: baocut models configure ${id} --enable`,
  accountRemoved: (name) => `계정 ${name}을(를) 제거했습니다`,
  accountPreferred: (name) => `우선 계정으로 설정했습니다: ${name}`,
  providerHasNoAccounts: (id) => `${id}에 계정이 없습니다`,
  noSuchProvider: (id) => `그런 공급자가 없습니다: ${id}`,
  alreadyRepairing: (jobId) => `이미 복구 중입니다(작업 ${jobId}). 진행 상황을 표시합니다`,
  nothingToRepair: '복구할 파일이 없습니다',
  notTtyConfirmDownload: '터미널에서 실행 중이 아닙니다: 사용자가 다운로드를 확인하면 --yes를 추가하세요',
  notDownloaded: '다운로드하지 않았습니다',
  nothingToDownload: '다운로드할 것이 없습니다',
  repairDone: '복구를 완료했습니다',
  repairPartialKept: (bundleId) => `다운로드한 부분은 보관했습니다: baocut models repair ${bundleId} 명령을 실행하면 이어서 받습니다`,
  setResetConflict: (usage) => `--set과 --reset 중 하나만 지정하세요. ${usage}`,
  dirHasModels: '현재 폴더에 모델이 있습니다: 옮기려면 --move를, 위치만 바꾸려면 --switch를 추가하세요(이전 파일은 보관됨)',
  dirChanged: (dir, oldFilesKept) => `모델 폴더를 ${dir}(으)로 바꿨습니다${oldFilesKept ? '(이전 위치의 파일은 보관됨)' : ''}`,
  modelsMoved: (dir) => `모델을 ${dir}(으)로 옮겼습니다`,
  dirRolledBack: '롤백했습니다: 원래 모델 폴더는 바뀌지 않았습니다',
  pasteKeyHint: 'API 키를 붙여 넣고 Return 키를 누른 다음 Ctrl-D를 눌러 끝내세요:',
  noKeyOnStdin: '표준 입력에 API 키가 없습니다',
  keyHasWhitespace: 'API 키에는 공백이나 줄바꿈이 없어야 합니다: 표준 입력에는 키만 넣으세요',
  positiveInteger: (option) => `${option}은(는) 양의 정수여야 합니다`,
  effortChoices: (efforts) => `--effort는 ${efforts.join(', ')} 중 하나여야 합니다`,
  capabilityLabels: {
    transcribe: '전사',
    synthesizeSpeech: '음성 합성',
    generateImage: '이미지 생성',
    generateText: '텍스트 생성',
    separateAudio: '음성 분리',
  },
  unavailableLabels: {
    'not-configured': '사용 설정 안 됨',
    'missing-credential': 'API 키 없음',
    'not-installed': '설치되지 않음',
    'signed-out': '로그아웃됨',
    outdated: '버전이 너무 오래됨',
    'not-paired': '페어링 안 됨',
    'not-connected': '연결할 수 없음',
    unsupported: '지원되지 않음',
    resource: '오류가 반복되어 사용 중지됨',
  },
  unavailable: '사용할 수 없음',
  capabilityState: (label, available, reason) => `${label} ${available ? '사용 가능' : `사용 불가(${reason})`}`,
  capabilitySep: ', ',
  configEnabled: '사용 중',
  configDisabled: '사용 중지됨',
  keyState: (set) => `키 ${set ? '설정됨' : '설정 안 됨'}`,
  configEndpoint: (url) => `엔드포인트 ${url}`,
  modelListRefreshed: (at) => `모델 목록 새로 고침 ${at}`,
  lastRefreshFailed: (at) => `마지막 새로 고침 실패(${at}), 내장 목록 사용`,
  textParameters: (effort, concurrency) => `기본 추론 강도: ${effort ?? '모델 자체 값'} · 공급자별 동시 요청 수 ${concurrency}`,
  markDefault: '기본값',
  markDeclared: '사용자 선언',
  wordTimestampsNative: '단어별 타임스탬프',
  wordTimestampsEstimated: '단어 시간을 길이로 추정',
  maxInputMegabytes: (mb) => `호출당 ≤ ${mb} MB`,
  maxDurationMinutes: (minutes) => `호출당 ≤ ${minutes}분`,
  voiceCount: (count, defaultVoice) => `목소리 ${count}개(기본값 ${defaultVoice ?? '없음'})`,
  noPresetVoices: '기본 제공 목소리가 없어 목소리를 지정해야 함',
  acceptsCustomVoices: '사용자 지정 목소리 지원',
  maxInputChars: (count) => `호출당 ≤ ${count}자`,
  acceptsInstructions: '스타일 지시 지원',
  sizeCount: (count, defaultSize) => `크기 ${count}종${defaultSize ? `(기본값 ${defaultSize})` : ''}`,
  aspectRatios: (ratios) => `화면 비율 ${ratios}`,
  maxImageCount: (count) => `호출당 이미지 ≤ ${count}장`,
  sizeAndSeedFixed: '크기와 시드는 지정할 수 없음',
  contextTokens: (count) => `컨텍스트 ${count} 토큰`,
  maxOutputTokens: (count) => `출력 ≤ ${count} 토큰`,
  efforts: (efforts, defaultEffort) => `추론 강도 ${efforts}${defaultEffort ? `(기본값 ${defaultEffort})` : ''}`,
  structuredOutput: '구조화된 출력',
  subscription: '구독에 포함, 할당량 알 수 없음',
  modelName: (id, label) => `${id}(${label})`,
};
