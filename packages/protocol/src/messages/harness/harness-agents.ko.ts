import type { HarnessAgentsMessages } from './harness-agents.ts';

export const ko: HarnessAgentsMessages = {
  listSeparator: ', ',
  noDriver: (p) => `ID가 ${p.id}인 Agent가 등록되어 있지 않습니다`,
  probeFailed: (p) => `감지 실패: ${p.error}`,
  cannotChangeAgent: '이 세션은 이미 시작되어 Agent를 바꿀 수 없습니다. 다른 Agent를 선택하려면 새 세션을 시작하세요.',
  noBudgetLedger: '이 Runtime에는 작업 예산 원장이 없어 예산을 설정할 수 없습니다',
  driverGone: (p) =>
    `Agent ${p.id}이(가) 삭제되었거나 등록되어 있지 않아 이 세션에서는 더 이상 보낼 수 없습니다. 다른 Agent로 새 세션을 시작하세요.`,
  driverUnverified: (p) =>
    `${p.agent}은(는) 아직 BaoCut 통합 테스트를 통과하지 않았습니다. 감지 결과만 표시되며 세션을 시작할 수 없습니다.`,
  fullAccessOnly: (p) =>
    `${p.agent}은(는) 단계별로 승인을 요청할 수 없어 “${p.fullAccess}” 모드로만 실행됩니다(현재 “${p.current}”). “${p.fullAccess}” 모드로 바꾼 뒤 다시 보내거나 다른 Agent를 사용하세요.`,
  runtimeStopping: 'Runtime이 중지되는 중입니다',
  sessionBusy: '이 세션에서 아직 작업이 실행 중입니다. 중지하거나 끝날 때까지 기다리세요.',
  sessionBusyOther: '이 세션에서 다른 작업이 실행 중입니다. 중지하거나 끝날 때까지 기다리세요.',
  oldTaskNotStopped: '이전 작업이 아직 중지되지 않았습니다. 나중에 다시 시도하세요',
  attachmentsUnsupported: '이 버전에서는 아직 이미지 첨부 파일을 보낼 수 없습니다',
  attachmentDuplicate: '메시지 하나에 같은 첨부 파일은 한 번만 넣을 수 있습니다',
  tooManyImages: (p) => `메시지 하나에 이미지는 최대 ${p.max}개까지 넣을 수 있습니다`,
  imagesUnsupported: '이 Agent는 이미지를 지원하지 않습니다',
  contractRevisionMissing: (p) => `작업 계약에 리비전 ${p.revision}이(가) 없습니다(최신 리비전 ${p.latest})`,
  taskEnded: '작업이 끝났거나 중지되는 중이어서 계약을 바꿀 수 없습니다. 목표를 바꾸려면 tasks.changeGoal을 사용하세요',
  contractRevisionStale: (p) =>
    `계약은 이미 리비전 ${p.latest}입니다(예상한 리비전 ${p.expected} 아님). 바꾸기 전에 다시 읽으세요`,
  checkMissing: (p) => `작업 계약에 이런 검사 항목이 없습니다: ${p.id}`,
  taskNotFound: (p) => `작업을 찾을 수 없습니다: ${p.id}`,
  approvalNotFound: (p) => `승인 요청을 찾을 수 없습니다: ${p.id}`,
  builtinId: (p) => `${p.id}은(는) 기본 제공 Agent ID입니다. 다른 ID를 선택하세요`,
  agentExists: (p) => `ID가 ${p.id}인 Agent가 이미 있습니다`,
  builtinNotRemovable: (p) => `${p.agent}은(는) 기본 제공 Agent라 삭제할 수 없습니다. 설정에서 끌 수 있습니다`,
  agentMissing: (p) => `ID가 ${p.id}인 Agent가 없습니다`,
  providersUnsupported: '이 Runtime에서는 Agent를 추가하거나 삭제할 수 없습니다',
  modelMissing: (p) => `${p.agent}에는 “${p.model}” 모델이 없습니다. 다음 중에서 선택하세요: ${p.choices}`,
  effortMissing: (p) => `“${p.model}” 모델에는 “${p.effort}” 추론 강도가 없습니다. 다음 중에서 선택하세요: ${p.choices}`,
  effortUnsupported: (p) => `“${p.model}” 모델에는 추론 강도 단계가 없습니다`,
  approvalNoGrant: '이 승인은 데이터를 외부로 보내지 않으므로 허가 선택을 포함할 수 없습니다',
  contractFieldsReadonly: (p) =>
    `Agent는 작업 계약의 다음 필드를 바꿀 수 없습니다: ${p.fields}. 접근 모드, 권한 범위, 예산, 보호 구간은 사용자만 정할 수 있습니다`,
};
