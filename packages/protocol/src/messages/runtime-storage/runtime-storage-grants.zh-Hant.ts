import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const zhHant: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: '本機運算不需要授權',
  dataKindRequired: '請至少提供一種資料',
  budgetCapRequired: '有金額上限的授權需要 budgetCap',
  unknownCostNoCap: '費用未知的授權不能設定金額上限。要設定上限，請使用 estimate-cap',
  expiryPassed: '到期時間已過',
  grantNotFound: '找不到這項授權',
  grantRevoked: '授權已撤銷，無法變更。請重新發放一項',
  cannotRemoveCap: '有金額上限的授權無法移除上限。請撤銷後重新發放一項費用未知的授權',
  unknownCostCannotCap: '費用未知的授權無法設定金額上限。請撤銷後重新發放一項 estimate-cap 授權',
  cannotChangeCurrency: '無法變更幣別',
  expiryPassedRevoke: '到期時間已過。要立即停止，請撤銷授權',
  revokeNote:
    '撤銷後不會再發出新的呼叫，佇列中的呼叫會在開始時遭拒。已傳送給供應商的資料與已產生的費用無法在本機撤回；進行中的呼叫照常完成，並計入用量。',
  taskCallLimit: '任務預算的呼叫次數上限必須是正整數',
  providerGrantPurpose: (p) => `啟用 ${p.label} 時預設發放`,
  invalidCurrency: (p) => `幣別必須是三個大寫字母（ISO 4217）：${p.currency}`,
};
