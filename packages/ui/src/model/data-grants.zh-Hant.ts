import type { DataGrantsMessages } from './data-grants.ts';

export const zhHant: DataGrantsMessages = {
  state: { active: '有效', expired: '已到期', revoked: '已撤銷', exhausted: '已達上限' },
  kindList: (kinds: readonly string[]) => kinds.join('、'),
  noKinds: '沒有資料類型',
  origin: {
    'provider-enable': '開啟供應商時預設授予',
    approval: '核准時授予',
    user: '手動授予',
  },
  oneVideoNamed: (name: string) => `僅限影片「${name}」`,
  oneVideo: '僅限一部影片',
  allVideos: '所有影片',
  oneTask: '僅限一個任務',
  budgetCap: (amount: string) => `支出上限 ${amount}`,
  budgetUnknown: '費用不明，只按呼叫次數計算',
  once: '僅限這一次',
  unlimited: '不限次數',
  maxCalls: (n: number) => `最多 ${n} 次`,
  revokedOn: (day: string) => `${day} 已撤銷`,
  expiredOn: (day: string) => `${day} 已到期`,
  expiresOn: (day: string) => `${day} 到期`,
  neverUsed: '尚未使用',
  usedWithAmount: (calls: number, amount: string) => `已使用 ${calls} 次（${amount}）`,
  used: (calls: number) => `已使用 ${calls} 次`,
  reservedWithAmount: (calls: number, amount: string) => `${calls} 次進行中（已預留 ${amount}）`,
  reserved: (calls: number) => `${calls} 次進行中`,
  unknownCost: (calls: number) => `${calls} 次費用不明`,
  usageSeparator: '，',
  revokeConfirm: (running: number, sent: number) =>
    `撤銷後，使用這項授權的新呼叫和排隊中的呼叫都會被拒絕。${running ? `已在執行的 ${running} 次會正常完成。` : ''}${sent ? `已在 ${sent} 次呼叫中送出的資料，以及已產生的費用，都無法收回。` : ''}`,
  revoked: '已撤銷',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `先前已送出 ${calls} 次${amount ? `（${amount}${unknownCostCalls ? `，另有 ${unknownCostCalls} 次費用不明` : ''}）` : ''}`,
  runningJobs: (n: number) => `${n} 個執行中的任務會正常完成`,
};
