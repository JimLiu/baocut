import type { ForkMessages } from './fork-copy.ts';

export const ko: ForkMessages = {
  button: '이 턴에서 분기',
  fork: '새 세션에서 이어서 하기',
  forkHint: '이 턴까지의 대화를 가져갑니다',
  restore: '이어서 하고 동영상을 그때로 되돌리기…',
  restoreOne: (name) => `"${name}"을(를) 이 턴이 끝난 시점으로 되돌립니다`,
  restoreMany: (n) => `동영상 ${n}개를 이 턴이 끝난 시점으로 되돌립니다`,
  restoreNone: '그때의 버전이 없거나 읽을 수 없습니다',
  checking: '버전 기록 확인 중…',
  dialogTitle: '분기하고 동영상 되돌리기',
  dialogLead:
    '새 세션은 이 턴까지의 대화를 가져갑니다. 아래 동영상은 이 턴이 끝난 시점으로 돌아갑니다. 되돌리기는 새 버전으로 저장되므로 버전 기록에서 다시 돌아올 수 있습니다.',
  listLabel: '되돌릴 동영상',
  cancel: '취소',
  confirm: '분기하고 되돌리기',
  ok: (version, undone) => `버전 ${version}(으)로 되돌립니다. 그 이후의 버전 ${undone}개(내 변경과 다른 세션의 변경)는 취소됩니다`,
  pruned: '그때의 버전이 없습니다(버전 기록에는 최근 버전과 저장한 버전만 남습니다)',
  createdAfter: '이 동영상은 이 턴 이후에 만들어져 그대로 둡니다',
  chainBroken: '버전 기록을 그때까지 읽을 수 없습니다',
  done: '새 세션으로 분기했습니다',
  doneRestored: (n) => `새 세션으로 분기하고 동영상 ${n}개를 그때로 되돌렸습니다. 버전 기록에서 다시 돌아올 수 있습니다`,
  failed: (error) => `분기하지 못했습니다: ${error}`,
  forkedFrom: (title, turn) => `"${title}"에서 분기 · ${turn}번째 턴까지`,
  sourceDeleted: '(원래 세션 삭제됨)',
  history: (turns, omitted) => `가져온 기록 · ${turns}턴${omitted ? ` (이전 ${omitted}턴 생략)` : ''}`,
  hideHistory: '기록 접기',
};
