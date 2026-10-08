import type { GrantsMessages } from './grants-copy.ts';

export const ko: GrantsMessages = {
  help: `사용법:
  baocut grants [list]             데이터 공유 허가 목록(온라인 공급자와 Agent 공급자):
                                   받는 곳, 데이터 종류, 범위, 사용량, 예산
    --recipient <id>               이 공급자의 허가만 보기
    --video <영상 id>              이 영상을 포함하는 허가만 보기
    --include-ended                철회, 만료, 한도 소진된 허가도 보기
  baocut grants create --recipient <id> --data <종류,…> --purpose <용도> [옵션]
                                   허가를 발급합니다. 데이터 종류: transcript(전사본과 번역), frames(영상 프레임),
                                   audio(오디오), video(원본 영상), document(텍스트와 프롬프트), context(Agent 컨텍스트)
    --video <영상 id|all>          이 영상만 포함합니다. 생략하거나 all이면 모든 영상
    --max-calls <n>                호출 횟수 상한. 생략하면 무제한
    --budget <금액> --currency <통화>
                                   지출 상한: 모델 가격으로 추정해 예약합니다.
                                   가격 정보가 없는 모델 호출은 거부됩니다(BUDGET_UNVERIFIABLE)
    --expires <ISO 시각>           만료 시각
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <금액|none> --currency …] [--expires <시각|none>]
                                   허가를 변경합니다. 범위를 좁히거나 상한을 낮추거나 만료를 앞당기면
                                   이전 조건으로 대기 중인 호출은 시작할 때 거부됩니다
  baocut grants revoke <id>        허가를 철회합니다: 이후 호출은 더 이상 허용되지 않습니다. 이미 보낸
                                   데이터와 이미 집계된 비용은 그대로 보여 줍니다
  baocut grants usage <id>         허가의 사용량과 이 허가를 쓴 작업(예약과 정산)`,
  usage:
    '사용법: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <종류,…> --purpose <용도> [옵션]' +
    ' | update <허가 id> [옵션] | revoke <허가 id> | usage <허가 id>]',
  listSep: ', ',
  missingRecipient: '--recipient가 없습니다(데이터를 받는 공급자, 예: openai)',
  missingData: (kinds: readonly string[]) => `--data가 없습니다(데이터 종류, 쉼표로 구분: ${kinds.join(', ')})`,
  missingPurpose: '--purpose가 없습니다(사람이 읽을 용도 한 문장)',
  recipientFixed: '받는 곳은 바꿀 수 없습니다: 이 허가를 철회하고 새로 발급하세요',
  nothingToUpdate: '변경할 내용이 없습니다: --data, --video, --purpose, --max-calls, --budget 또는 --expires를 지정하세요',
  persistOnly: '--scope, --max-calls, --budget, --expires는 --persist와 함께만 쓸 수 있습니다',
  scopeChoices: '--scope에는 video 또는 all을 지정하세요',
  unknownKinds: (unknown: string, kinds: readonly string[]) => `알 수 없는 데이터 종류: ${unknown}. ${kinds.join(', ')} 중에서 고르세요`,
  maxCallsRange: '--max-calls는 1~1000000 사이의 정수이거나 none(무제한)이어야 합니다',
  currencyNeedsBudget: '--currency는 --budget과 함께만 쓸 수 있습니다',
  budgetFormat: '--budget은 소수점 이하 최대 6자리의 음수가 아닌 십진 금액이어야 합니다(예: 5 또는 2.50)',
  budgetNeedsCurrency: '--budget에는 --currency <세 글자 통화 코드, 예: USD>가 필요합니다',
  expiresFormat: '--expires는 시간대가 포함된 ISO 시각(예: 2026-12-31T23:59:59Z)이거나 none이어야 합니다',
  stateLabels: {
    active: '유효',
    expired: '만료됨',
    revoked: '철회됨',
    exhausted: '한도 소진',
  },
  originLabels: {
    user: '사용자가 발급',
    approval: '승인 시 발급',
    'provider-enable': '활성화 시 기본값',
  },
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved}(예약)` : ''}${max !== null ? `/${max}` : ''}회`,
  unknownCostCalls: (n: number) => `(${n}회는 비용 알 수 없음)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}, ${amount}${reserved ? `+${reserved}(예약)` : ''}/${cap} ${currency}`,
  noGrants: '허가가 없습니다: 온라인 공급자와 Agent 공급자 호출은 승인을 요청합니다(또는 baocut grants create로 발급하세요)',
  scopeVideo: (videoId: string) => `영상 ${videoId}`,
  scopeAll: '모든 영상',
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) =>
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, 작업 ${g.taskId}만` : ''}${g.once ? ', 이번 한 번만' : ''}  사용량 ${g.usage}${g.expiresAt ? `, 만료 ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `${id} 허가를 철회했습니다(${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `이미 보냄: 호출 ${calls}회${amount ? `, ${amount} 집계됨` : ''}${unknownCostCalls ? `(${unknownCostCalls}회는 비용 알 수 없음)` : ''}`,
  runningJobs: (jobs: readonly string[]) => `아직 실행 중인 작업(평소대로 끝남): ${jobs.join(', ')}`,
  noJobs: '(아직 이 허가를 쓴 작업이 없거나 작업 기록이 정리되었습니다)',
  settled: (calls: number, amount: string, basis: string) => `${calls}회 ${amount} 정산(${basis})`,
  unsettled: '정산 안 됨',
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  ${calls}회 ${amount} 예약  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    보낼 데이터: ${a.recipient} ← ${a.kinds}${a.videoId ? `(영상 ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, 추정 ${a.estimate}` : ', 비용 알 수 없음'}${a.maxCalls !== null ? `, 최대 ${a.maxCalls}회` : ''}${a.reason === 'revoked' ? ', 허가가 철회되었거나 만료됨' : a.reason === 'unverifiable' ? ', 비용을 추정할 수 없음' : ''}`,
};
