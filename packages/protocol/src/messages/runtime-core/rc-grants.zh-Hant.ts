import type { RcGrantsMessages } from './rc-grants.ts';

const ZH_HANT_KINDS: Readonly<Record<string, string>> = {
  transcript: '逐字稿與譯文',
  frames: '影格與縮圖',
  audio: '音訊',
  video: '原始影片',
  document: '文字與提示詞',
  context: 'Agent 對話上下文',
};

function zhHantKinds(codes: string): string {
  return codes
    .split(',')
    .filter(Boolean)
    .map((k) => ZH_HANT_KINDS[k] ?? k)
    .join('、');
}

export const zhHant: RcGrantsMessages = {
  dataKinds: (p) => zhHantKinds(p.kinds),

  grantLapsed: (p) => `將資料（${zhHantKinds(p.kinds)}）傳送給 ${p.label} 的授權已${p.expired ? '過期' : '撤銷'}`,
  grantRequired: (p) => `將資料（${zhHantKinds(p.kinds)}）傳送給 ${p.label} 需要使用者授權`,
  grantCallsUsedUp: (p) => `授權的呼叫次數上限（${p.used}/${p.max}）已用完，這次呼叫會超出預算`,
  grantAmountUsedUp: '授權的金額上限已用完，這次呼叫會超出預算',
  budgetUnverifiable: (p) => `授權設有金額上限，但這個 ${p.label} 模型沒有可靠的價格，無法保證不超出上限`,
  taskCallsUsedUp: (p) => `這個任務的呼叫次數預算（${p.used}/${p.max}）已用完，這次呼叫會超出任務預算`,
  taskAmountUsedUp: (p) => `這個任務的金額預算（${p.amount} ${p.currency}）已用完，這次呼叫會超出任務預算`,
  taskBudgetUnverifiable: (p) => `這個任務的預算設有金額上限，但無法以 ${p.currency} 估算這次呼叫的費用，無法保證不超出上限`,
  combined: (p) => `${p.message}（另有 ${p.others} 項資料傳送也需要授權）`,

  hintRevoked: '已撤銷或過期的授權不會自動恢復。請使用者在 BaoCut 的設定中重新授權，或在對話中核准這一次。',
  hintRequired:
    '將資料傳送出去需要使用者授權（依資料類型、接收者、範圍和用途）。請使用者在 BaoCut 的設定中發出授權，或在對話中核准這一次。',
  hintExhausted:
    '預算用完後不會自動提高。請使用者提高這項授權的上限，或等待進行中的呼叫結束（失敗和已取消的呼叫會釋放其預留額度）。',
  hintUnverifiable: '無法估算費用時，使用者只能逐次核准每次呼叫（金額不明），或發出一項按次計算、金額不明的授權。',
  hintTaskExhausted:
    '任務預算用完後不會自動提高。請使用者在任務合約中提高這個任務的預算，或等待進行中的呼叫結束（失敗和已取消的呼叫會釋放其預留額度）。',
  hintTaskUnverifiable:
    '任務預算設有金額上限時，只接受能以相同幣別估算費用的呼叫；一旦有金額不明或其他幣別的呼叫，也無法保證不超出。請使用者移除任務預算的金額上限（只保留呼叫次數上限），或改用有價格的模型。',
  hintServiceAuto:
    '外部服務的 auto 等級並不等於資料外傳的授權。請使用者在 BaoCut 中為這個供應商發出授權（資料類型、範圍和預算），或將服務等級改為 ask，逐次核准每次呼叫。',

  placeholderPurpose: '<用途>',
  placeholderMaxCalls: '<更高的呼叫次數>',
  placeholderBudget: '<更高的金額>',
  placeholderCalls: '<呼叫次數>',

  grantLapsedBeforeStart: (p) =>
    `授權在任務開始前${p.state === 'expired' ? '已過期' : p.state === 'revoked' ? '已被撤銷' : '已被縮小範圍'}，因此沒有傳送任何資料`,
  grantInvalidBeforeStart: '授權在任務開始前失效，因此沒有傳送任何資料',
  retrySkipped: (p) => `沒有執行自動重試：${p.reason}`,
  ledgerUnsaved: '無法將授權帳本寫入磁碟，因此沒有傳送任何資料',
  providerDisabledBeforeStart: '供應商在任務開始前已停用，因此沒有傳送任何資料',

  noSuchGrant: '沒有這項授權',
  toolPurpose: (p) => `工具「${p.tool}」`,
  pipelinePurpose: (p) => `流程「${p.label}」`,
};
