import type { TasksMessages } from './tasks-copy.ts';

export const ko: TasksMessages = {
  help: `사용법:
  baocut tasks contract <작업 id> [--revision <n>]
                                   작업 계약 보기: 목표, 범위, 제약, 변경 금지 목록, 산출물,
                                   접근 모드, 예산과 사용량, 검수 항목과 결과
  baocut tasks history <작업 id>   계약의 개정 이력(누가 언제 어떤 필드를 바꿨는지)
  baocut tasks list --conversation <세션 id>
                                   세션에 있는 각 작업의 최신 계약`,
  usage: '사용법: baocut tasks contract <작업 id> [--revision <n>] | history <작업 id> | list --conversation <세션 id>',
  revisionPositive: '--revision은 양의 정수여야 합니다',
  changeBy: { user: '사용자', agent: 'Agent', runtime: 'Runtime(기본값)' },
  changeReason: {
    created: '생성',
    updated: '변경',
    mode: '접근 모드 전환',
    goal: '목표 변경',
  },
  outcomeLabels: { passed: '통과', failed: '실패', skipped: '건너뜀' },
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason}(${by})${fields.length > 0 ? `: ${fields.join(', ')}` : ''}, ${at}`,
  wholeVideo: '영상 전체',
  entity: (id: string) => `엔티티 ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `엔티티 ${id}의 ${paths.join(', ')}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `시퀀스 ${sequenceId}의 ${from}–${to} 프레임${trackIds.length ? `(트랙 ${trackIds.join(', ')})` : ''}`,
  protection: (id: string, videoId: string, what: string, note: string | null) =>
    `${id}  영상 ${videoId}: ${what}${note ? `(${note})` : ''}`,
  noBudget: '제한 없음(각 허가의 예산만 적용)',
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved}(예약)` : ''}${max !== null ? `/${max}` : ''}회`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `, ${spent} 지출` : ''}${reserved ? `, ${reserved} 예약` : ''}${cap ? `, 상한 ${cap}` : ''}${unknownCostCalls ? `(${unknownCostCalls}회는 비용 알 수 없음)` : ''}`,
  latest: '최신',
  latestIs: (revision: number) => `최신은 개정 ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `작업 ${taskId}  계약 개정 ${revision}(${latest})  ${change}`,
  goal: (goal: string) => `목표: ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `세션: ${conversationId}  영상: ${videoId ?? '없음'}${baseRevision ? `(버전 ${baseRevision})` : ''}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `범위: ${s.videoId ? `영상 ${s.videoId}` : '지정한 영상 없음'}${s.sequenceId ? `, 시퀀스 ${s.sequenceId}` : ''}${s.itemIds.length ? `, 선택 항목 ${s.itemIds.join(', ')}` : ''}${s.range ? `, ${s.range.from}–${s.range.to}초` : ''}`,
  access: (mode: string, scopeRef: string) => `접근 모드: ${mode}  권한 범위: ${scopeRef}`,
  budgetLine: (budget: string) => `예산: ${budget}`,
  supersedes: (taskId: string, stopped: boolean) =>
    `대체: 작업 ${taskId}(이전 작업의 결과는 ${stopped ? '중지됨' : '후보로 보관됨'})`,
  constraints: (empty: boolean): string => (empty ? '제약: 없음' : '제약:'),
  protectedRefs: (empty: boolean): string => (empty ? '변경 금지: 없음' : '변경 금지:'),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? `(${language})` : ''}`,
  deliverables: (items: readonly string[]) => (items.length ? `산출물: ${items.join(', ')}` : '산출물: 지정 안 됨'),
  checks: (empty: boolean): string => (empty ? '검수 항목: 없음' : '검수 항목:'),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label}(${byAgent ? 'Agent' : '사용자'} 기록${note ? `: ${note}` : ''})`,
  notRecorded: '기록 안 됨',
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? ', 필수' : ''}] ${description} · ${outcome}`,
  noContracts: '계약이 없습니다',
  historyLine: (revision: number, change: string, mode: string) => `개정 ${revision}  ${change}  모드 ${mode}`,
  noTasks: '이 세션에는 아직 작업이 없습니다',
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  개정 ${revision}  ${mode}  ${goal}`,
};
