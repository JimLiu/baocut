import type { DataGrantsMessages } from './data-grants.ts';

export const zhHans: DataGrantsMessages = {
  state: { active: '有效', expired: '已到期', revoked: '已撤销', exhausted: '额度用完' },
  kindList: (kinds: readonly string[]) => kinds.join('、'),
  noKinds: '没有数据种类',
  origin: {
    'provider-enable': '启用服务商时默认发放',
    approval: '审批时发放',
    user: '手动发放',
  },
  oneVideoNamed: (name: string) => `只限视频「${name}」`,
  oneVideo: '只限一个视频',
  allVideos: '全部视频',
  oneTask: '只限一个任务',
  budgetCap: (amount: string) => `金额上限 ${amount}`,
  budgetUnknown: '金额未知，只按次数计',
  once: '只这一次',
  unlimited: '次数不限',
  maxCalls: (n: number) => `最多 ${n} 次`,
  revokedOn: (day: string) => `${day} 撤销`,
  expiredOn: (day: string) => `${day} 已到期`,
  expiresOn: (day: string) => `${day} 到期`,
  neverUsed: '还没用过',
  usedWithAmount: (calls: number, amount: string) => `已用 ${calls} 次（${amount}）`,
  used: (calls: number) => `已用 ${calls} 次`,
  reservedWithAmount: (calls: number, amount: string) => `${calls} 次进行中（预留 ${amount}）`,
  reserved: (calls: number) => `${calls} 次进行中`,
  unknownCost: (calls: number) => `${calls} 次金额未知`,
  usageSeparator: '，',
  revokeConfirm: (running: number, sent: number) =>
    `撤销之后，用到这条授权的新调用和排队中的调用都会被拒绝。${running ? `正在执行的 ${running} 次会照常结束；` : ''}${sent ? `已经交出的 ${sent} 次调用的数据与可能产生的费用无法撤回。` : ''}`,
  revoked: '已撤销',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `之前交出过 ${calls} 次${amount ? `（${amount}${unknownCostCalls ? `，另有 ${unknownCostCalls} 次金额未知` : ''}）` : ''}`,
  runningJobs: (n: number) => `${n} 个正在执行的任务照常结束`,
};
