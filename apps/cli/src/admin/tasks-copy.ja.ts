import type { TasksMessages } from './tasks-copy.ts';

export const ja: TasksMessages = {
  help: `使い方：
  baocut tasks contract <task id> [--revision <n>]
                                   タスク契約を表示：目標、範囲、制約、変更禁止の一覧、成果物、
                                   アクセスモード、予算と使用量、受け入れチェックとその結果
  baocut tasks history <task id>   契約のリビジョン履歴（誰がいつどのフィールドを変更したか）
  baocut tasks list --conversation <session id>
                                   セッション内の各タスクの最新の契約`,
  usage: '使い方：baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>',
  revisionPositive: '--revision には正の整数を指定してください',
  changeBy: { user: 'ユーザ', agent: 'Agent', runtime: 'Runtime（既定）' },
  changeReason: {
    created: '作成',
    updated: '変更',
    mode: 'アクセスモードを切り替え',
    goal: '目標を変更',
  },
  outcomeLabels: { passed: '合格', failed: '不合格', skipped: 'スキップ' },
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason}（${by}）${fields.length > 0 ? `：${fields.join('、')}` : ''}、${at}`,
  wholeVideo: '動画全体',
  entity: (id: string) => `エンティティ ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `エンティティ ${id} の ${paths.join('、')}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `シーケンス ${sequenceId} のフレーム ${from}〜${to}${trackIds.length ? `（トラック ${trackIds.join('、')}）` : ''}`,
  protection: (id: string, videoId: string, what: string, note: string | null) =>
    `${id}  動画 ${videoId}：${what}${note ? `（${note}）` : ''}`,
  noBudget: '上限なし（各許可の予算だけが適用されます）',
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 予約` : ''}${max !== null ? `/${max}` : ''} 回`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `、支出 ${spent}` : ''}${reserved ? `、予約 ${reserved}` : ''}${cap ? `、上限 ${cap}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 回は費用不明）` : ''}`,
  latest: '最新',
  latestIs: (revision: number) => `最新はリビジョン ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `タスク ${taskId}  契約リビジョン ${revision}（${latest}）  ${change}`,
  goal: (goal: string) => `目標：${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `セッション：${conversationId}  動画：${videoId ?? 'なし'}${baseRevision ? `（バージョン ${baseRevision}）` : ''}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `範囲：${s.videoId ? `動画 ${s.videoId}` : '動画の指定なし'}${s.sequenceId ? `、シーケンス ${s.sequenceId}` : ''}${s.itemIds.length ? `、選択 ${s.itemIds.join('、')}` : ''}${s.range ? `、${s.range.from}〜${s.range.to} 秒` : ''}`,
  access: (mode: string, scopeRef: string) => `アクセスモード：${mode}  権限の範囲：${scopeRef}`,
  budgetLine: (budget: string) => `予算：${budget}`,
  supersedes: (taskId: string, stopped: boolean) =>
    `置き換え元：タスク ${taskId}（古いタスクの作業は${stopped ? '停止しました' : '候補として残しています'}）`,
  constraints: (empty: boolean) => (empty ? '制約：なし' : '制約：'),
  protectedRefs: (empty: boolean) => (empty ? '変更禁止：なし' : '変更禁止：'),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? `（${language}）` : ''}`,
  deliverables: (items: readonly string[]) => (items.length ? `成果物：${items.join('、')}` : '成果物：指定なし'),
  checks: (empty: boolean) => (empty ? '受け入れチェック：なし' : '受け入れチェック：'),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label}（${byAgent ? 'Agent' : 'ユーザ'} が記録${note ? `：${note}` : ''}）`,
  notRecorded: '未記録',
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? '、必須' : ''}] ${description}：${outcome}`,
  noContracts: '契約はありません',
  historyLine: (revision: number, change: string, mode: string) => `リビジョン ${revision}  ${change}  モード ${mode}`,
  noTasks: 'このセッションにはまだタスクがありません',
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  リビジョン ${revision}  ${mode}  ${goal}`,
};
