import type { RcGrantsMessages } from './rc-grants.ts';

const ZH_KINDS: Readonly<Record<string, string>> = {
  transcript: '文稿与译文',
  frames: '画面帧与缩略图',
  audio: '音频',
  video: '原视频',
  document: '文本与提示词',
  context: '智能体对话上下文',
};

function zhKinds(codes: string): string {
  return codes
    .split(',')
    .filter(Boolean)
    .map((k) => ZH_KINDS[k] ?? k)
    .join('、');
}

export const zhHans: RcGrantsMessages = {
  dataKinds: (p) => zhKinds(p.kinds),

  grantLapsed: (p) => `把${zhKinds(p.kinds)}交给 ${p.label} 的授权已${p.expired ? '到期' : '撤销'}`,
  grantRequired: (p) => `把${zhKinds(p.kinds)}交给 ${p.label} 需要用户授权`,
  grantCallsUsedUp: (p) => `授权的调用次数（${p.used}/${p.max}）已经用完，这次调用会超出预算`,
  grantAmountUsedUp: '授权的金额上限已经用完，这次调用会超出预算',
  budgetUnverifiable: (p) => `授权有金额上限，但 ${p.label} 的这个模型没有可信的单价，无法保证不超出`,
  taskCallsUsedUp: (p) => `这个任务的预算调用次数（${p.used}/${p.max}）已经用完，这次调用会超出任务预算`,
  taskAmountUsedUp: (p) => `这个任务的预算金额上限（${p.amount} ${p.currency}）已经用完，这次调用会超出任务预算`,
  taskBudgetUnverifiable: (p) => `这个任务的预算有金额上限，但这次调用的费用无法按 ${p.currency} 估算，无法保证不超出`,
  combined: (p) => `${p.message}（另有 ${p.others} 项外发也要授权）`,

  hintRevoked: '用户撤销或到期的授权不会自动恢复：请用户在 BaoCut 的设置里重新授权，或在会话里批准这一次。',
  hintRequired: '数据外发要用户授权（按数据种类、接收方、范围与用途）：请用户在 BaoCut 的设置里发放授权，或在会话里批准这一次。',
  hintExhausted: '预算用完时不会自动放宽：请用户调高这条授权的上限，或等进行中的调用结束（失败、取消的会释放预留）。',
  hintUnverifiable: '金额无法估算时只能由用户逐次批准（金额未知），或发放一条按次计、金额未知的授权。',
  hintTaskExhausted:
    '任务预算用完时不会自动放宽：请用户在任务合同里调高这个任务的预算，或等进行中的调用结束（失败、取消的会释放预留）。',
  hintTaskUnverifiable:
    '任务预算有金额上限时，只接受能按同一币种估算费用的调用；已经有金额未知或别的币种的调用时也无法保证。请用户去掉任务预算的金额上限（只留次数上限），或换用有单价的模型。',
  hintServiceAuto:
    '对外服务的 auto 等级不等于数据外发的授权：请用户在 BaoCut 里为这个服务商发放授权（数据种类、范围与预算），或把服务等级改为 ask 逐次批准。',

  placeholderPurpose: '<用途>',
  placeholderMaxCalls: '<更大的次数>',
  placeholderBudget: '<更高的金额>',
  placeholderCalls: '<次数>',

  grantLapsedBeforeStart: (p) =>
    `授权在任务开始之前${p.state === 'expired' ? '到期' : p.state === 'revoked' ? '被撤销' : '被收紧'}，数据没有交出`,
  grantInvalidBeforeStart: '授权在任务开始之前失效，数据没有交出',
  retrySkipped: (p) => `自动重试没有执行：${p.reason}`,
  ledgerUnsaved: '授权账本写不进磁盘，数据没有交出',
  providerDisabledBeforeStart: 'Provider 在任务开始之前被停用，数据没有交出',

  noSuchGrant: '没有这条授权',
  toolPurpose: (p) => `工具「${p.tool}」`,
  pipelinePurpose: (p) => `固定流程「${p.label}」`,
};
