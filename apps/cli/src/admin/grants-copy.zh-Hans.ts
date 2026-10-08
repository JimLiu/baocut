import type { GrantsMessages } from './grants-copy.ts';

export const zhHans: GrantsMessages = {
  help: `用法：
  baocut grants [list]             列出数据外发的授权（在线与智能体服务商）：接收方、数据种类、范围、用量与预算
    --recipient <id>               只看这个服务商的
    --video <视频 id>              只看覆盖这个视频的
    --include-ended                也列出已撤销、到期、额度用完的
  baocut grants create --recipient <id> --data <种类,…> --purpose <用途> [选项]
                                   发放一条授权。数据种类：transcript（文稿与译文）、frames（画面帧）、audio（音频）、
                                   video（原视频）、document（文本与提示词）、context（智能体上下文）
    --video <视频 id|all>          只覆盖这个视频；不给或 all 为全部视频
    --max-calls <n>                调用次数上限；不给时不限
    --budget <金额> --currency <币种>
                                   金额上限：按模型的价格估算并预留，没有价格的模型调用会被拒绝（BUDGET_UNVERIFIABLE）
    --expires <ISO 时间>           到期时间
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>] [--budget <金额|none> --currency …]
                         [--expires <时间|none>]
                                   修改一条授权；缩小、降低、提前的修改会让按旧条件排队的调用在开始时被拒绝
  baocut grants revoke <id>        撤销一条授权：之后的调用不再允许；已经交出的数据与已经计入的费用如实列出
  baocut grants usage <id>         一条授权的用量与用过它的任务（预留与结算）`,
  usage:
    '用法：baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <种类,…> --purpose <用途> [选项]' +
    ' | update <授权 id> [选项] | revoke <授权 id> | usage <授权 id>]',
  listSep: '、',
  missingRecipient: '缺少 --recipient（接收数据的服务商，例如 openai）',
  missingData: (kinds: readonly string[]) => `缺少 --data（数据种类，逗号分隔：${kinds.join('、')}）`,
  missingPurpose: '缺少 --purpose（用途，给人看的一句话）',
  recipientFixed: '接收方不能修改：撤销这条，另发一条',
  nothingToUpdate: '没有要修改的：给 --data、--video、--purpose、--max-calls、--budget 或 --expires',
  persistOnly: '--scope、--max-calls、--budget、--expires 只和 --persist 一起用',
  scopeChoices: '--scope 可选 video、all',
  unknownKinds: (unknown: string, kinds: readonly string[]) => `不认识的数据种类：${unknown}。可选 ${kinds.join('、')}`,
  maxCallsRange: '--max-calls 要是 1 到 1000000 的整数，或 none（不限）',
  currencyNeedsBudget: '--currency 只和 --budget 一起用',
  budgetFormat: '--budget 要是非负的十进制金额，最多 6 位小数（例如 5 或 2.50）',
  budgetNeedsCurrency: '--budget 要和 --currency <三位币种代码，例如 USD> 一起给',
  expiresFormat: '--expires 要是带时区的 ISO 时间（例如 2026-12-31T23:59:59Z），或 none',
  stateLabels: {
    active: '有效',
    expired: '已到期',
    revoked: '已撤销',
    exhausted: '额度用完',
  },
  originLabels: {
    user: '用户发放',
    approval: '审批时发放',
    'provider-enable': '启用时默认',
  },
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} 预留` : ''}${max !== null ? `/${max}` : ''} 次`,
  unknownCostCalls: (n: number) => `（${n} 次金额未知）`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}，${amount}${reserved ? `+${reserved} 预留` : ''}/${cap} ${currency}`,
  noGrants: '没有授权：在线与智能体服务商的调用会要求审批（或用 baocut grants create 发放）',
  scopeVideo: (videoId: string) => `视频 ${videoId}`,
  scopeAll: '全部视频',
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
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `，只限任务 ${g.taskId}` : ''}${g.once ? '，只这一次' : ''}  用量 ${g.usage}${g.expiresAt ? `，到期 ${g.expiresAt}` : ''}  （${g.origin}：${g.purpose}）`,
  revoked: (id: string, recipient: string, kinds: string) => `已撤销 ${id}（${recipient} ← ${kinds}）`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `已经交出：${calls} 次调用${amount ? `，计入 ${amount}` : ''}${unknownCostCalls ? `（${unknownCostCalls} 次金额未知）` : ''}`,
  runningJobs: (jobs: readonly string[]) => `正在执行、照常结束的任务：${jobs.join('、')}`,
  noJobs: '（还没有任务用过它，或任务记录已经清理）',
  settled: (calls: number, amount: string, basis: string) => `结算 ${calls} 次 ${amount}（${basis}）`,
  unsettled: '未结算',
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  预留 ${calls} 次 ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    外发：${a.recipient} ← ${a.kinds}${a.videoId ? `（视频 ${a.videoId}）` : ''}：${a.purpose}${a.estimate ? `，估算 ${a.estimate}` : '，金额未知'}${a.maxCalls !== null ? `，至多 ${a.maxCalls} 次` : ''}${a.reason === 'revoked' ? '，授权已撤销或到期' : a.reason === 'unverifiable' ? '，金额无法估算' : ''}`,
};
