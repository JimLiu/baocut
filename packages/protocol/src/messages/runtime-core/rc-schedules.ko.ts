import type { RcSchedulesMessages } from './rc-schedules.ts';

export const ko: RcSchedulesMessages = {
  notFound: (p) => `예약 작업을 찾을 수 없습니다: ${p.id}`,
  conversationNotFound: (p) => `세션을 찾을 수 없습니다: ${p.id}`,
  conversationArchived: '이 세션은 보관되었습니다. ‘보관된 세션’에서 복원한 뒤 예약 작업을 만드세요.',
  noProject: '이 세션은 프로젝트에 속하지 않아 매번 프로젝트에서 새 세션을 열 수 없습니다.',
  invalid: '예약 작업 설정을 확인하세요. 보낼 메시지, 빈도, 최대 실행 횟수가 올바라야 합니다.',
  notActive: '활성 상태인 예약 작업만 지금 실행할 수 있습니다.',
  resumeArchived: '대상 세션이 보관되었습니다. ‘보관된 세션’에서 복원하거나, 매번 새 세션을 열도록 예약 작업을 편집하세요.',
  resumeDeleted: '대상 세션이 삭제되었습니다. 매번 새 세션을 열도록 예약 작업을 편집하세요.',
  resumeProjectRemoved: '이 프로젝트가 BaoCut에서 제거되어 새 세션을 열 수 없습니다.',
  resumeCompleted: '최대 실행 횟수에 도달했습니다. 횟수를 늘린 뒤 계속하세요.',
  runStopped: '끝나기 전에 중지됨',
};
