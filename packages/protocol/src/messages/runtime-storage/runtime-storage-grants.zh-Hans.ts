import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const zhHans: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: '本机计算不需要授权',
  dataKindRequired: '至少要给一种数据',
  budgetCapRequired: '有金额上限的授权要给 budgetCap',
  unknownCostNoCap: '金额未知的授权不设金额上限：要设上限请用 estimate-cap',
  expiryPassed: '到期时间已经过了',
  grantNotFound: '没有这条授权',
  grantRevoked: '授权已经撤销，不能再改：重新发放一条',
  cannotRemoveCap: '有金额上限的授权不能去掉上限：撤销后重新发放一条金额未知的授权',
  unknownCostCannotCap: '金额未知的授权不设金额上限：撤销后重新发放一条 estimate-cap 的授权',
  cannotChangeCurrency: '不能改币种',
  expiryPassedRevoke: '到期时间已经过了：要立即停用请撤销',
  revokeNote:
    '撤销之后不再发出新的调用，排队中的调用在开始时被拒绝。已经交给服务商的数据与已经产生的费用无法从本地撤回；正在执行的调用照常结束并计入用量。',
  taskCallLimit: '任务预算的次数上限应为正整数',
  providerGrantPurpose: (p) => `启用 ${p.label} 时默认发放`,
  invalidCurrency: (p) => `币种应为三个大写字母（ISO 4217）：${p.currency}`,
};
