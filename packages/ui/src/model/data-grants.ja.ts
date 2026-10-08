import type { DataGrantsMessages } from './data-grants.ts';

export const ja: DataGrantsMessages = {
  state: { active: '有効', expired: '期限切れ', revoked: '撤回済み', exhausted: '上限に到達' },
  kindList: (kinds: readonly string[]) => kinds.join('、'),
  noKinds: 'データの種類なし',
  origin: {
    'provider-enable': 'プロバイダを有効にしたときに既定で許可',
    approval: '承認時に許可',
    user: '手動で許可',
  },
  oneVideoNamed: (name: string) => `動画「${name}」のみ`,
  oneVideo: '1 本の動画のみ',
  allVideos: 'すべての動画',
  oneTask: '1 件のタスクのみ',
  budgetCap: (amount: string) => `金額の上限 ${amount}`,
  budgetUnknown: '金額不明、回数のみでカウント',
  once: '今回のみ',
  unlimited: '回数無制限',
  maxCalls: (n: number) => `最大 ${n} 回`,
  revokedOn: (day: string) => `${day} に撤回`,
  expiredOn: (day: string) => `${day} に期限切れ`,
  expiresOn: (day: string) => `${day} に期限切れ予定`,
  neverUsed: '未使用',
  usedWithAmount: (calls: number, amount: string) => `${calls} 回使用（${amount}）`,
  used: (calls: number) => `${calls} 回使用`,
  reservedWithAmount: (calls: number, amount: string) => `${calls} 回処理中（${amount} を確保）`,
  reserved: (calls: number) => `${calls} 回処理中`,
  unknownCost: (calls: number) => `${calls} 回は金額不明`,
  usageSeparator: '、',
  revokeConfirm: (running: number, sent: number) =>
    `撤回すると、この許可を使う新しい呼び出しと待機中の呼び出しは拒否されます。${running ? `すでに実行中の ${running} 回は通常どおり完了します。` : ''}${sent ? `すでに ${sent} 回で送信したデータと発生した費用は取り戻せません。` : ''}`,
  revoked: '撤回しました',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `これまでに ${calls} 回送信${amount ? `（${amount}${unknownCostCalls ? `、ほかに金額不明 ${unknownCostCalls} 回` : ''}）` : ''}`,
  runningJobs: (n: number) => `実行中のタスク ${n} 件は通常どおり完了します`,
};
