import type { RcGrantsMessages } from './rc-grants.ts';

const JA_KINDS: Readonly<Record<string, string>> = {
  transcript: '文字起こしと翻訳',
  frames: 'フレームとサムネイル',
  audio: '音声',
  video: '元の動画',
  document: 'テキストとプロンプト',
  context: 'Agent の会話コンテキスト',
};

function jaKinds(codes: string): string {
  return codes
    .split(',')
    .filter(Boolean)
    .map((k) => JA_KINDS[k] ?? k)
    .join('、');
}

export const ja: RcGrantsMessages = {
  dataKinds: (p) => jaKinds(p.kinds),

  grantLapsed: (p) =>
    `${p.label} に${jaKinds(p.kinds)}を送信する許可は${p.expired ? '期限切れになりました' : '取り消されました'}`,
  grantRequired: (p) => `${p.label} に${jaKinds(p.kinds)}を送信するには、ユーザの許可が必要です`,
  grantCallsUsedUp: (p) => `許可の呼び出し回数（${p.used}/${p.max}）を使い切ったため、この呼び出しは予算を超えます`,
  grantAmountUsedUp: '許可の金額上限を使い切ったため、この呼び出しは予算を超えます',
  budgetUnverifiable: (p) =>
    `許可には金額上限がありますが、${p.label} のこのモデルには信頼できる単価がないため、上限内に収まることを保証できません`,
  taskCallsUsedUp: (p) =>
    `このタスクの呼び出し回数の予算（${p.used}/${p.max}）を使い切ったため、この呼び出しはタスクの予算を超えます`,
  taskAmountUsedUp: (p) =>
    `このタスクの金額の予算（${p.amount} ${p.currency}）を使い切ったため、この呼び出しはタスクの予算を超えます`,
  taskBudgetUnverifiable: (p) =>
    `このタスクの予算には金額上限がありますが、この呼び出しの費用を ${p.currency} で見積もれないため、上限内に収まることを保証できません`,
  combined: (p) => `${p.message}（ほかに ${p.others} 件の送信にも許可が必要です）`,

  hintRevoked:
    '取り消された許可や期限切れの許可は自動では復元されません。BaoCut の設定でもう一度許可するか、セッション内で今回だけ承認するよう、ユーザに依頼してください。',
  hintRequired:
    'データの送信にはユーザの許可（データの種類、送信先、範囲、用途ごと）が必要です。BaoCut の設定で許可を発行するか、セッション内で今回だけ承認するよう、ユーザに依頼してください。',
  hintExhausted:
    '使い切った予算は自動では引き上げられません。この許可の上限を引き上げるようユーザに依頼するか、実行中の呼び出しが終わるのを待ってください（失敗またはキャンセルされた呼び出しは予約を解放します）。',
  hintUnverifiable:
    '費用を見積もれない場合、ユーザは呼び出しごとに承認する（金額不明）か、金額不明の回数制の許可を発行するしかありません。',
  hintTaskExhausted:
    '使い切ったタスクの予算は自動では引き上げられません。タスクの契約でこのタスクの予算を引き上げるようユーザに依頼するか、実行中の呼び出しが終わるのを待ってください（失敗またはキャンセルされた呼び出しは予約を解放します）。',
  hintTaskUnverifiable:
    'タスクの予算に金額上限がある場合、同じ通貨で費用を見積もれる呼び出ししか受け付けません。金額不明の呼び出しや別の通貨の呼び出しがすでにある場合も保証できません。タスクの予算の金額上限を外す（回数の上限だけを残す）か、単価のあるモデルに切り替えるよう、ユーザに依頼してください。',
  hintServiceAuto:
    '外部サービスの auto レベルは、データを送信する許可ではありません。BaoCut でこのプロバイダへの許可（データの種類、範囲、予算）を発行するか、サービスのレベルを ask に変えて呼び出しごとに承認するよう、ユーザに依頼してください。',

  placeholderPurpose: '<用途>',
  placeholderMaxCalls: '<より多い回数>',
  placeholderBudget: '<より高い金額>',
  placeholderCalls: '<回数>',

  grantLapsedBeforeStart: (p) =>
    `タスクの開始前に許可が${p.state === 'expired' ? '期限切れになった' : p.state === 'revoked' ? '取り消された' : '狭められた'}ため、データは送信されませんでした`,
  grantInvalidBeforeStart: 'タスクの開始前に許可が無効になったため、データは送信されませんでした',
  retrySkipped: (p) => `自動再試行は実行されませんでした：${p.reason}`,
  ledgerUnsaved: '許可の台帳をディスクに書き込めなかったため、データは送信されませんでした',
  providerDisabledBeforeStart: 'タスクの開始前にプロバイダがオフになったため、データは送信されませんでした',

  noSuchGrant: 'この許可はありません',
  toolPurpose: (p) => `ツール「${p.tool}」`,
  pipelinePurpose: (p) => `パイプライン「${p.label}」`,
};
