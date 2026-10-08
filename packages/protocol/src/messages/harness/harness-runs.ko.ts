import type { HarnessRunsMessages } from './harness-runs.ts';

export const ko: HarnessRunsMessages = {
  retrying: (p) => `${p.message}(다시 시도 중)`,
  modeChanged: (p) => `접근 모드가 “${p.to}” 모드로 바뀌었습니다(이전 “${p.from}”). 이후 동작부터 적용됩니다.`,
  jobsCancelled: (p) =>
    `이 세션에서 아직 끝나지 않은 백그라운드 작업 ${p.count}개의 취소를 요청했습니다. 이미 끝난 결과는 유지됩니다.`,
  jobsCancelledGenerated: (p) =>
    `이 세션에서 아직 끝나지 않은 백그라운드 작업 ${p.count}개(생성 또는 전사)의 취소를 요청했습니다. 이미 끝난 결과는 유지됩니다.`,
  goalChangedStopped: '목표가 바뀌었습니다: 이전 작업을 중지했습니다. 새 목표로 새 작업을 시작합니다.',
  goalChangedKept:
    '목표가 바뀌었습니다: 이전 작업의 턴을 중지했습니다. 이미 제출된 백그라운드 작업은 평소대로 끝나고 결과물은 후보로 남습니다. 새 목표로 새 작업을 시작합니다.',
  stopReplyUnconfirmed: (p) => `응답 중지를 요청했지만 ${p.agent}이(가) 멈췄는지 확인하지 못했습니다.`,
  stopUnconfirmed: (p) => `중지를 요청했지만 ${p.agent}이(가) 멈췄는지 확인하지 못했습니다.`,
  stopTimedOut: (p) =>
    `${p.agent}이(가) 10초 안에 중지를 확인하지 않아 프로세스를 종료했습니다. 취소가 확인되지 않은 단계는 이미 적용되었을 수 있습니다.`,
  agentRemovedNotice: (p) =>
    `Agent ${p.agent}이(가) 삭제되어 이 작업을 끝내지 못했습니다. 이미 적용된 변경 사항은 자동으로 되돌리지 않습니다.`,
  agentRemoved: (p) => `Agent ${p.agent}이(가) 삭제되었습니다`,
  runtimeStoppedNotice: 'Runtime이 중지될 때 작업이 아직 실행 중이어서 중단되었습니다.',
  runtimeExitedNotice:
    '작업 실행 중에 Runtime이 종료되어 이 작업을 끝내지 못했습니다. 이미 적용된 변경 사항은 자동으로 되돌리지 않습니다.',
  runtimeExited: '작업 실행 중에 Runtime이 종료되었습니다',
  turnFailed: '턴이 실패했습니다',
  processExited: (p) => `${p.agent} 프로세스가 예기치 않게 종료되었습니다: ${p.error}`,
  noErrorMessage: '오류 메시지 없음',
  fileChangeSummary: '파일 수정',
};
