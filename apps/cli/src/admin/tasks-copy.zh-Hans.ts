import type { TasksMessages } from './tasks-copy.ts';

export const zhHans: TasksMessages = {
  help: `用法：
  baocut tasks contract <任务 id> [--revision <n>]
                                   查看任务合同：目标、范围、约束、不要改动、交付、访问模式、预算与用量、验收检查及结果
  baocut tasks history <任务 id>   合同的修订历史（谁在什么时候改了哪些字段）
  baocut tasks list --conversation <会话 id>
                                   一个会话每个任务的最新合同`,
  usage: '用法：baocut tasks contract <任务 id> [--revision <n>] | history <任务 id> | list --conversation <会话 id>',
  revisionPositive: '--revision 要是正整数',
  changeBy: { user: '用户', agent: '智能体', runtime: 'Runtime 默认' },
  changeReason: {
    created: '建立',
    updated: '修改',
    mode: '切换访问模式',
    goal: '改变目标',
  },
  outcomeLabels: { passed: '通过', failed: '未通过', skipped: '跳过' },
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${by}${reason}${fields.length > 0 ? `：${fields.join('、')}` : ''}，${at}`,
  wholeVideo: '整个视频',
  entity: (id: string) => `实体 ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `实体 ${id} 的 ${paths.join('、')}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `序列 ${sequenceId} 的第 ${from}–${to} 帧${trackIds.length ? `（轨道 ${trackIds.join('、')}）` : ''}`,
  protection: (id: string, videoId: string, what: string, note: string | null) => `${id}  视频 ${videoId}：${what}${note ? `（${note}）` : ''}`,
  noBudget: '不限（只受各授权的预算约束）',
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 预留` : ''}${max !== null ? `/${max}` : ''} 次`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `，已用 ${spent}` : ''}${reserved ? `，预留 ${reserved}` : ''}${cap ? `，上限 ${cap}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 次金额未知）` : ''}`,
  latest: '最新',
  latestIs: (revision: number) => `最新是修订 ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `任务 ${taskId}  合同修订 ${revision}（${latest}）  ${change}`,
  goal: (goal: string) => `目标：${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `会话：${conversationId}  视频：${videoId ?? '无'}${baseRevision ? `（版本 ${baseRevision}）` : ''}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `范围：${s.videoId ? `视频 ${s.videoId}` : '没有指定视频'}${s.sequenceId ? `，序列 ${s.sequenceId}` : ''}${s.itemIds.length ? `，选中 ${s.itemIds.join('、')}` : ''}${s.range ? `，${s.range.from}–${s.range.to} 秒` : ''}`,
  access: (mode: string, scopeRef: string) => `访问模式：${mode}  权限范围：${scopeRef}`,
  budgetLine: (budget: string) => `预算：${budget}`,
  supersedes: (taskId: string, stopped: boolean) => `接替：任务 ${taskId}（旧任务的工作${stopped ? '已停止' : '保留为候选'}）`,
  constraints: (empty: boolean) => (empty ? '约束：无' : '约束：'),
  protectedRefs: (empty: boolean) => (empty ? '不要改动：无' : '不要改动：'),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? `（${language}）` : ''}`,
  deliverables: (items: readonly string[]) => (items.length ? `交付：${items.join('、')}` : '交付：未指定'),
  checks: (empty: boolean) => (empty ? '验收检查：无' : '验收检查：'),
  outcome: (label: string, byAgent: boolean, note: string | null) => `${label}（${byAgent ? '智能体' : '用户'}记录${note ? `：${note}` : ''}）`,
  notRecorded: '未记录',
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? '，必过' : ''}] ${description} — ${outcome}`,
  noContracts: '没有合同',
  historyLine: (revision: number, change: string, mode: string) => `修订 ${revision}  ${change}  模式 ${mode}`,
  noTasks: '这个会话还没有任务',
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  修订 ${revision}  ${mode}  ${goal}`,
};
