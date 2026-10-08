import type { RcGrantsMessages } from './rc-grants.ts';

const KO_KINDS: Readonly<Record<string, string>> = {
  transcript: '전사본과 번역',
  frames: '영상 프레임과 썸네일',
  audio: '오디오',
  video: '원본 영상',
  document: '텍스트와 프롬프트',
  context: 'Agent 대화 컨텍스트',
};

function koKinds(codes: string): string {
  return codes
    .split(',')
    .filter(Boolean)
    .map((k) => KO_KINDS[k] ?? k)
    .join(', ');
}

export const ko: RcGrantsMessages = {
  dataKinds: (p) => koKinds(p.kinds),

  grantLapsed: (p) =>
    `${p.label}에 ${koKinds(p.kinds)} 데이터를 보내는 허가가 ${p.expired ? '만료되었습니다' : '철회되었습니다'}`,
  grantRequired: (p) => `${p.label}에 ${koKinds(p.kinds)} 데이터를 보내려면 사용자의 허가가 필요합니다`,
  grantCallsUsedUp: (p) => `허가의 호출 한도(${p.used}/${p.max})를 모두 사용해 이번 호출은 예산을 초과합니다`,
  grantAmountUsedUp: '허가의 금액 한도를 모두 사용해 이번 호출은 예산을 초과합니다',
  budgetUnverifiable: (p) =>
    `허가에 금액 한도가 있지만 이 ${p.label} 모델에는 신뢰할 수 있는 가격이 없어 한도 안에서 사용한다고 보장할 수 없습니다`,
  taskCallsUsedUp: (p) => `이 작업의 호출 예산(${p.used}/${p.max})을 모두 사용해 이번 호출은 작업 예산을 초과합니다`,
  taskAmountUsedUp: (p) => `이 작업의 금액 예산(${p.amount} ${p.currency})을 모두 사용해 이번 호출은 작업 예산을 초과합니다`,
  taskBudgetUnverifiable: (p) =>
    `이 작업의 예산에는 금액 한도가 있지만 이번 호출의 비용을 ${p.currency} 기준으로 추정할 수 없어 한도 안에서 사용한다고 보장할 수 없습니다`,
  combined: (p) => `${p.message}(외부 전송 ${p.others}건도 허가가 필요합니다)`,

  hintRevoked:
    '철회되거나 만료된 허가는 자동으로 복원되지 않습니다. 사용자에게 BaoCut 설정에서 다시 허가하거나 세션에서 이번 한 번을 승인해 달라고 요청하세요.',
  hintRequired:
    '데이터를 외부로 보내려면 사용자의 허가(데이터 유형, 수신자, 범위, 용도별)가 필요합니다. 사용자에게 BaoCut 설정에서 허가를 발급하거나 세션에서 이번 한 번을 승인해 달라고 요청하세요.',
  hintExhausted:
    '모두 사용한 예산은 자동으로 늘어나지 않습니다. 사용자에게 이 허가의 한도를 늘려 달라고 요청하거나 진행 중인 호출이 끝날 때까지 기다리세요(실패하거나 취소된 호출은 예약을 해제합니다).',
  hintUnverifiable:
    '비용을 추정할 수 없으면 사용자가 호출마다 승인하거나(금액 알 수 없음) 금액을 알 수 없는 호출 단위 허가를 발급하는 수밖에 없습니다.',
  hintTaskExhausted:
    '모두 사용한 작업 예산은 자동으로 늘어나지 않습니다. 사용자에게 작업 계약에서 이 작업의 예산을 늘려 달라고 요청하거나 진행 중인 호출이 끝날 때까지 기다리세요(실패하거나 취소된 호출은 예약을 해제합니다).',
  hintTaskUnverifiable:
    '작업 예산에 금액 한도가 있으면 같은 통화로 비용을 추정할 수 있는 호출만 받으며, 금액을 알 수 없거나 다른 통화로 된 호출이 이미 있으면 역시 보장할 수 없습니다. 사용자에게 작업 예산의 금액 한도를 없애거나(호출 한도만 유지) 가격이 있는 모델로 바꿔 달라고 요청하세요.',
  hintServiceAuto:
    '외부 서비스의 auto 수준은 데이터 외부 전송 허가가 아닙니다. 사용자에게 BaoCut에서 이 공급자에 대한 허가(데이터 유형, 범위, 예산)를 발급하거나 서비스 수준을 ask로 바꿔 호출마다 승인해 달라고 요청하세요.',

  placeholderPurpose: '<용도>',
  placeholderMaxCalls: '<더 큰 호출 횟수>',
  placeholderBudget: '<더 높은 금액>',
  placeholderCalls: '<호출 횟수>',

  grantLapsedBeforeStart: (p) =>
    `작업이 시작되기 전에 허가가 ${p.state === 'expired' ? '만료되어' : p.state === 'revoked' ? '철회되어' : '축소되어'} 데이터를 보내지 않았습니다`,
  grantInvalidBeforeStart: '작업이 시작되기 전에 허가가 무효가 되어 데이터를 보내지 않았습니다',
  retrySkipped: (p) => `자동 다시 시도가 실행되지 않았습니다: ${p.reason}`,
  ledgerUnsaved: '허가 원장을 디스크에 기록하지 못해 데이터를 보내지 않았습니다',
  providerDisabledBeforeStart: '작업이 시작되기 전에 공급자가 꺼져 데이터를 보내지 않았습니다',

  noSuchGrant: '해당 허가가 없습니다',
  toolPurpose: (p) => `도구 “${p.tool}”`,
  pipelinePurpose: (p) => `파이프라인 “${p.label}”`,
};
