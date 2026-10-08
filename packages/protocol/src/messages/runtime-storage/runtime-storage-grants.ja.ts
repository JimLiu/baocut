import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const ja: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: 'ローカルでの計算に許可は必要ありません',
  dataKindRequired: 'データの種類を 1 つ以上指定してください',
  budgetCapRequired: '金額上限のある許可には budgetCap が必要です',
  unknownCostNoCap: '費用が不明な許可には金額上限を設定できません。上限を設定するには estimate-cap を使ってください',
  expiryPassed: '有効期限はすでに過ぎています',
  grantNotFound: 'その許可はありません',
  grantRevoked: 'この許可は撤回済みのため変更できません。新しく発行してください',
  cannotRemoveCap: '金額上限のある許可から上限を外すことはできません。撤回してから、費用が不明な許可を新しく発行してください',
  unknownCostCannotCap: '費用が不明な許可に金額上限は設定できません。撤回してから、estimate-cap の許可を新しく発行してください',
  cannotChangeCurrency: '通貨は変更できません',
  expiryPassedRevoke: '有効期限はすでに過ぎています。今すぐ停止するには撤回してください',
  revokeNote:
    '撤回すると新しい呼び出しは行われず、待機中の呼び出しは開始時に拒否されます。すでにプロバイダに送信したデータと発生済みの費用はローカルでは取り消せません。実行中の呼び出しは通常どおり完了し、使用量に計上されます。',
  taskCallLimit: 'タスク予算の呼び出し回数の上限は正の整数にしてください',
  providerGrantPurpose: (p) => `${p.label} を有効にしたときに既定で発行`,
  invalidCurrency: (p) => `通貨は英大文字 3 文字（ISO 4217）で指定してください：${p.currency}`,
};
