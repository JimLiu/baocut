import type { DataGrantsMessages } from './data-grants-copy.ts';

export const zhHans: DataGrantsMessages = {
  title: '数据外发授权',
  showEnded: (count: number) => `显示已结束的（${count}）`,
  lead: '交给云端服务商的数据要有授权：启用服务商时默认发放一条，审批时选「以后都允许」也会发放一条。撤销之后不再外发新的调用；已经交出的数据与费用撤不回。本机模型不需要授权。',
  loading: '正在读取授权…',
  disconnected: '没有连上 Runtime',
  revoke: '撤销',
  noActive: '没有有效的授权',
  none: '还没有授权',
  emptyDesc: '启用云端服务商、或在审批时选「以后都允许」之后，授权会列在这里。',
  revokeTitle: (name: string) => `撤销「${name}」？`,
  revokeFailed: (message: string) => `没能撤销：${message}`,
  cancel: '取消',
};
