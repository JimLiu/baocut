import type { GrantsMessages } from './grants-copy.ts';

export const zhHant: GrantsMessages = {
  help: `用法：
  baocut grants [list]             列出資料分享授權（線上與 Agent 供應商）：
                                   接收方、資料類型、範圍、用量與預算
    --recipient <id>               只列出這個供應商的授權
    --video <video id>             只列出涵蓋這部影片的授權
    --include-ended                一併列出已撤銷、已到期與額度用盡的授權
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   發放一項授權。資料類型：transcript（逐字稿與譯文）、frames（影片影格）、
                                   audio（音訊）、video（原始影片）、document（文字與提示詞）、context（Agent 上下文）
    --video <video id|all>         只涵蓋這部影片；省略或 all 表示所有影片
    --max-calls <n>                呼叫次數上限；省略時不限
    --budget <amount> --currency <currency>
                                   金額上限：依模型定價估算並預留；
                                   呼叫沒有定價的模型會被拒絕（BUDGET_UNVERIFIABLE）
    --expires <ISO time>           到期時間
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   變更一項授權；縮小範圍、調低上限或提前到期，會讓依舊條件排隊的呼叫
                                   在開始時被拒絕
  baocut grants revoke <id>        撤銷一項授權：之後的呼叫不再允許；已傳送的資料與已計入的費用
                                   會如實列出
  baocut grants usage <id>         一項授權的用量，以及使用過它的任務（預留與結算）`,
  usage:
    '用法：baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' +
    ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]',
  listSep: '、',
  missingRecipient: '缺少 --recipient（接收資料的供應商，例如 openai）',
  missingData: (kinds: readonly string[]) => `缺少 --data（資料類型，以逗號分隔：${kinds.join('、')}）`,
  missingPurpose: '缺少 --purpose（用途，一句給人看的說明）',
  recipientFixed: '無法變更接收方：請撤銷這項授權，再建立一項新的',
  nothingToUpdate: '沒有要變更的內容：請指定 --data、--video、--purpose、--max-calls、--budget 或 --expires',
  persistOnly: '--scope、--max-calls、--budget 與 --expires 只能與 --persist 一起使用',
  scopeChoices: '--scope 可用 video 或 all',
  unknownKinds: (unknown: string, kinds: readonly string[]) => `未知的資料類型：${unknown}。可選 ${kinds.join('、')}`,
  maxCallsRange: '--max-calls 必須是 1 至 1000000 的整數，或 none（不限）',
  currencyNeedsBudget: '--currency 只能與 --budget 一起使用',
  budgetFormat: '--budget 必須是非負的十進位金額，最多 6 位小數（例如 5 或 2.50）',
  budgetNeedsCurrency: '--budget 需要搭配 --currency <三個字母的貨幣代碼，例如 USD>',
  expiresFormat: '--expires 必須是含時區的 ISO 時間（例如 2026-12-31T23:59:59Z），或 none',
  stateLabels: {
    active: '有效',
    expired: '已到期',
    revoked: '已撤銷',
    exhausted: '額度用盡',
  },
  originLabels: {
    user: '由你發放',
    approval: '核准時發放',
    'provider-enable': '啟用時預設',
  },
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 預留` : ''}${max !== null ? `/${max}` : ''} 次`,
  unknownCostCalls: (n: number) => `（${n} 次費用未知）`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}，${amount}${reserved ? `+${reserved} 預留` : ''}/${cap} ${currency}`,
  noGrants: '沒有授權：呼叫線上與 Agent 供應商時會要求核准（或用 baocut grants create 建立一項）',
  scopeVideo: (videoId: string) => `影片 ${videoId}`,
  scopeAll: '所有影片',
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
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `，僅限任務 ${g.taskId}` : ''}${g.once ? '，僅限這一次' : ''}  用量 ${g.usage}${g.expiresAt ? `，${g.expiresAt} 到期` : ''}  （${g.origin}：${g.purpose}）`,
  revoked: (id: string, recipient: string, kinds: string) => `已撤銷 ${id}（${recipient} ← ${kinds}）`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `已傳送：${calls} 次呼叫${amount ? `，已計入 ${amount}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 次費用未知）` : ''}`,
  runningJobs: (jobs: readonly string[]) => `仍在執行的任務（會照常完成）：${jobs.join('、')}`,
  noJobs: '（還沒有任務使用過它，或任務記錄已清除）',
  settled: (calls: number, amount: string, basis: string) => `已結算 ${calls} 次 ${amount}（${basis}）`,
  unsettled: '未結算',
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  預留 ${calls} 次 ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    傳送：${a.recipient} ← ${a.kinds}${a.videoId ? `（影片 ${a.videoId}）` : ''}：${a.purpose}${a.estimate ? `，估計 ${a.estimate}` : '，費用未知'}${a.maxCalls !== null ? `，最多 ${a.maxCalls} 次` : ''}${a.reason === 'revoked' ? '，授權已撤銷或到期' : a.reason === 'unverifiable' ? '，無法估算費用' : ''}`,
};
