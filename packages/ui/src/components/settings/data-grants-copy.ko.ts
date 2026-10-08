import type { DataGrantsMessages } from './data-grants-copy.ts';

export const ko: DataGrantsMessages = {
  title: '데이터 공유 허가',
  showEnded: (count: number) => `종료된 허가 표시(${count})`,
  lead: '클라우드 공급자에 보내는 데이터에는 허가가 필요합니다. 공급자를 활성화하면 기본으로 하나가 발급되고, 승인할 때 “항상 허용”을 선택하면 하나가 더 발급됩니다. 철회하면 새 호출로는 데이터를 보내지 않지만, 이미 보낸 데이터와 발생한 요금은 되돌릴 수 없습니다. 로컬 모델에는 허가가 필요하지 않습니다.',
  loading: '허가 불러오는 중…',
  disconnected: 'Runtime에 연결되지 않음',
  revoke: '철회',
  noActive: '유효한 허가 없음',
  none: '아직 허가가 없습니다',
  emptyDesc: '클라우드 공급자를 활성화하거나 승인할 때 “항상 허용”을 선택하면 허가가 여기에 표시됩니다.',
  revokeTitle: (name: string) => `“${name}” 허가를 철회할까요?`,
  revokeFailed: (message: string) => `철회하지 못했습니다: ${message}`,
  cancel: '취소',
};
