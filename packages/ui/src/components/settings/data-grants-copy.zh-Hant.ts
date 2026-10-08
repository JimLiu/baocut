import type { DataGrantsMessages } from './data-grants-copy.ts';

export const zhHant: DataGrantsMessages = {
  title: '資料外傳授權',
  showEnded: (count: number) => `顯示已結束的（${count}）`,
  lead: '傳給雲端供應商的資料需要授權：啟用供應商時預設會發出一個，核准時選「總是允許」也會再發出一個。撤銷之後，新的呼叫不再外傳資料；已經送出的資料與已產生的費用無法收回。本機模型不需要授權。',
  loading: '正在載入授權…',
  disconnected: '未連線到 Runtime',
  revoke: '撤銷',
  noActive: '沒有有效的授權',
  none: '還沒有授權',
  emptyDesc: '啟用雲端供應商，或在核准時選「總是允許」之後，授權會列在這裡。',
  revokeTitle: (name: string) => `要撤銷「${name}」嗎？`,
  revokeFailed: (message: string) => `無法撤銷：${message}`,
  cancel: '取消',
};
