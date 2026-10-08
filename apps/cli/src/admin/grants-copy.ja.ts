import type { GrantsMessages } from './grants-copy.ts';

export const ja: GrantsMessages = {
  help: `使い方：
  baocut grants [list]             データ送信の許可（オンラインと Agent のプロバイダ）を一覧表示：
                                   送信先、データの種類、範囲、使用量、予算
    --recipient <id>               このプロバイダの許可だけ
    --video <video id>             この動画を対象に含む許可だけ
    --include-ended                撤回済み、期限切れ、使い切った許可も表示
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   許可を発行。データの種類：transcript（文字起こしと翻訳）、frames（動画のフレーム）、
                                   audio（音声）、video（元の動画）、document（テキストとプロンプト）、context（Agent のコンテキスト）
    --video <video id|all>         この動画だけを対象にする。省略または all ですべての動画
    --max-calls <n>                呼び出し回数の上限。省略すると無制限
    --budget <amount> --currency <currency>
                                   金額の上限：モデルの料金から見積もって予約します。
                                   料金が設定されていないモデルの呼び出しは拒否します（BUDGET_UNVERIFIABLE）
    --expires <ISO time>           有効期限
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   許可を変更。範囲を狭める、上限を下げる、期限を早めると、古い条件で
                                   待機中の呼び出しは開始時に拒否されます
  baocut grants revoke <id>        許可を撤回する：以後の呼び出しは許可されません。すでに送信したデータと
                                   計上済みの費用はそのまま表示します
  baocut grants usage <id>         許可の使用量と、それを使ったタスク（予約と精算）`,
  usage:
    '使い方：baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' +
    ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]',
  listSep: '、',
  missingRecipient: '--recipient がありません（データを受け取るプロバイダ。例：openai）',
  missingData: (kinds: readonly string[]) => `--data がありません（データの種類をカンマ区切りで：${kinds.join('、')}）`,
  missingPurpose: '--purpose がありません（人が読むための 1 文の用途）',
  recipientFixed: '送信先は変更できません：この許可を撤回して、新しく作成してください',
  nothingToUpdate: '変更する内容がありません：--data、--video、--purpose、--max-calls、--budget、--expires のいずれかを指定してください',
  persistOnly: '--scope、--max-calls、--budget、--expires は --persist と一緒にのみ使えます',
  scopeChoices: '--scope には video または all を指定してください',
  unknownKinds: (unknown: string, kinds: readonly string[]) => `不明なデータの種類：${unknown}。${kinds.join('、')} から選んでください`,
  maxCallsRange: '--max-calls には 1 から 1000000 までの整数、または none（無制限）を指定してください',
  currencyNeedsBudget: '--currency は --budget と一緒にのみ使えます',
  budgetFormat: '--budget には小数点以下 6 桁までの 0 以上の 10 進数の金額を指定してください（例：5 または 2.50）',
  budgetNeedsCurrency: '--budget には --currency <3 文字の通貨コード。例：USD> が必要です',
  expiresFormat: '--expires にはタイムゾーン付きの ISO 時刻（例：2026-12-31T23:59:59Z）または none を指定してください',
  stateLabels: {
    active: '有効',
    expired: '期限切れ',
    revoked: '撤回済み',
    exhausted: '使い切り',
  },
  originLabels: {
    user: 'ユーザが許可',
    approval: '承認時に許可',
    'provider-enable': '有効化時の既定',
  },
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 予約` : ''}${max !== null ? `/${max}` : ''} 回`,
  unknownCostCalls: (n: number) => `（${n} 回は費用不明）`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}、${amount}${reserved ? `+${reserved} 予約` : ''}/${cap} ${currency}`,
  noGrants: '許可はありません：オンラインと Agent のプロバイダの呼び出しでは承認を求めます（または baocut grants create で作成してください）',
  scopeVideo: (videoId: string) => `動画 ${videoId}`,
  scopeAll: 'すべての動画',
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) =>
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `、タスク ${g.taskId} のみ` : ''}${g.once ? '、今回のみ' : ''}  使用量 ${g.usage}${g.expiresAt ? `、期限 ${g.expiresAt}` : ''}  （${g.origin}：${g.purpose}）`,
  revoked: (id: string, recipient: string, kinds: string) => `${id} を撤回しました（${recipient} ← ${kinds}）`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `送信済み：${calls} 回の呼び出し${amount ? `、計上 ${amount}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 回は費用不明）` : ''}`,
  runningJobs: (jobs: readonly string[]) => `実行中のタスク（通常どおり完了します）：${jobs.join('、')}`,
  noJobs: '（まだどのタスクも使っていないか、タスクの記録が整理済みです）',
  settled: (calls: number, amount: string, basis: string) => `精算 ${calls} 回 ${amount}（${basis}）`,
  unsettled: '未精算',
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  予約 ${calls} 回 ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    送信：${a.recipient} ← ${a.kinds}${a.videoId ? `（動画 ${a.videoId}）` : ''}：${a.purpose}${a.estimate ? `、見積もり ${a.estimate}` : '、費用不明'}${a.maxCalls !== null ? `、最大 ${a.maxCalls} 回` : ''}${a.reason === 'revoked' ? '、許可が撤回済みまたは期限切れ' : a.reason === 'unverifiable' ? '、費用を見積もれません' : ''}`,
};
