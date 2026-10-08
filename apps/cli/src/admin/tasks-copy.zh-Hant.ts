import type { TasksMessages } from './tasks-copy.ts';

export const zhHant: TasksMessages = {
  help: `用法：
  baocut tasks contract <task id> [--revision <n>]
                                   查看任務合約：目標、範圍、限制、不可變更清單、交付項目、存取模式、
                                   預算與用量、驗收檢查及結果
  baocut tasks history <task id>   合約的修訂歷程（誰在何時變更了哪些欄位）
  baocut tasks list --conversation <session id>
                                   一個對話中每個任務的最新合約`,
  usage: '用法：baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>',
  revisionPositive: '--revision 必須是正整數',
  changeBy: { user: '你', agent: 'Agent', runtime: 'Runtime 預設' },
  changeReason: {
    created: '建立',
    updated: '變更',
    mode: '切換存取模式',
    goal: '變更目標',
  },
  outcomeLabels: { passed: '通過', failed: '未通過', skipped: '已略過' },
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason}（${by}）${fields.length > 0 ? `：${fields.join('、')}` : ''}，${at}`,
  wholeVideo: '整部影片',
  entity: (id: string) => `實體 ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `實體 ${id} 的 ${paths.join('、')}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `序列 ${sequenceId} 的第 ${from}–${to} 影格${trackIds.length ? `（軌道 ${trackIds.join('、')}）` : ''}`,
  protection: (id: string, videoId: string, what: string, note: string | null) => `${id}  影片 ${videoId}：${what}${note ? `（${note}）` : ''}`,
  noBudget: '不設上限（只受各項授權的預算限制）',
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 預留` : ''}${max !== null ? `/${max}` : ''} 次`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `，已花費 ${spent}` : ''}${reserved ? `，預留 ${reserved}` : ''}${cap ? `，上限 ${cap}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 次費用未知）` : ''}`,
  latest: '最新',
  latestIs: (revision: number) => `最新為修訂 ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `任務 ${taskId}  合約修訂 ${revision}（${latest}）  ${change}`,
  goal: (goal: string) => `目標：${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `對話：${conversationId}  影片：${videoId ?? '無'}${baseRevision ? `（版本 ${baseRevision}）` : ''}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `範圍：${s.videoId ? `影片 ${s.videoId}` : '未指定影片'}${s.sequenceId ? `，序列 ${s.sequenceId}` : ''}${s.itemIds.length ? `，已選取 ${s.itemIds.join('、')}` : ''}${s.range ? `，${s.range.from}–${s.range.to} 秒` : ''}`,
  access: (mode: string, scopeRef: string) => `存取模式：${mode}  權限範圍：${scopeRef}`,
  budgetLine: (budget: string) => `預算：${budget}`,
  supersedes: (taskId: string, stopped: boolean) => `取代：任務 ${taskId}（舊任務的工作${stopped ? '已停止' : '保留為候選'}）`,
  constraints: (empty: boolean) => (empty ? '限制：無' : '限制：'),
  protectedRefs: (empty: boolean) => (empty ? '不可變更：無' : '不可變更：'),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? `（${language}）` : ''}`,
  deliverables: (items: readonly string[]) => (items.length ? `交付項目：${items.join('、')}` : '交付項目：未指定'),
  checks: (empty: boolean) => (empty ? '驗收檢查：無' : '驗收檢查：'),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label}（${byAgent ? '由 Agent 記錄' : '由你記錄'}${note ? `：${note}` : ''}）`,
  notRecorded: '未記錄',
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? '，必要' : ''}] ${description}——${outcome}`,
  noContracts: '沒有合約',
  historyLine: (revision: number, change: string, mode: string) => `修訂 ${revision}  ${change}  模式 ${mode}`,
  noTasks: '這個對話還沒有任務',
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  修訂 ${revision}  ${mode}  ${goal}`,
};
