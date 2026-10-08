import type { DataGrantsMessages } from './data-grants.ts';

export const ko: DataGrantsMessages = {
  state: { active: '활성', expired: '만료됨', revoked: '철회됨', exhausted: '한도 도달' },
  kindList: (kinds: readonly string[]) => kinds.join(', '),
  noKinds: '데이터 유형 없음',
  origin: {
    'provider-enable': '공급자를 켤 때 기본으로 부여됨',
    approval: '승인할 때 부여됨',
    user: '직접 부여함',
  },
  oneVideoNamed: (name: string) => `“${name}” 영상만`,
  oneVideo: '영상 하나만',
  allVideos: '모든 영상',
  oneTask: '작업 하나만',
  budgetCap: (amount: string) => `지출 한도 ${amount}`,
  budgetUnknown: '비용을 알 수 없어 호출 횟수로만 계산',
  once: '이번만',
  unlimited: '호출 횟수 무제한',
  maxCalls: (n: number) => `최대 ${n}회`,
  revokedOn: (day: string) => `${day} 철회됨`,
  expiredOn: (day: string) => `${day} 만료됨`,
  expiresOn: (day: string) => `${day} 만료`,
  neverUsed: '아직 사용하지 않음',
  usedWithAmount: (calls: number, amount: string) => `${calls}회 사용(${amount})`,
  used: (calls: number) => `${calls}회 사용`,
  reservedWithAmount: (calls: number, amount: string) => `${calls}회 진행 중(${amount} 예약됨)`,
  reserved: (calls: number) => `${calls}회 진행 중`,
  unknownCost: (calls: number) => `${calls}회 비용 알 수 없음`,
  usageSeparator: ', ',
  revokeConfirm: (running: number, sent: number) =>
    [
      '철회하면 이 허가를 사용하는 새 호출과 대기 중인 호출이 거부됩니다.',
      running ? `이미 실행 중인 ${running}회는 정상적으로 끝납니다.` : '',
      sent ? `이미 ${sent}회에 걸쳐 보낸 데이터와 발생한 비용은 되돌릴 수 없습니다.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  revoked: '철회됨',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `이전에 ${calls}회 보냄${amount ? `(${amount}${unknownCostCalls ? `, 비용을 알 수 없는 ${unknownCostCalls}회 별도` : ''})` : ''}`,
  runningJobs: (n: number) => `실행 중인 작업 ${n}개는 정상적으로 끝납니다`,
};
