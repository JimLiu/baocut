import type { HarnessAgentsMessages } from './harness-agents.ts';

export const ja: HarnessAgentsMessages = {
  listSeparator: '、',
  noDriver: (p) => `ID が ${p.id} の Agent は登録されていません`,
  probeFailed: (p) => `検出に失敗しました：${p.error}`,
  cannotChangeAgent: 'このセッションはすでに開始しているため、Agent を変更できません。別の Agent を選ぶには、新しいセッションを開始してください。',
  noBudgetLedger: 'この Runtime にはタスクの予算台帳がないため、予算を設定できません',
  driverGone: (p) =>
    `Agent ${p.id} は削除されたか登録されていないため、このセッションでは送信できなくなりました。別の Agent で新しいセッションを開始してください。`,
  driverUnverified: (p) =>
    `${p.agent} はまだ BaoCut の統合テストに合格していません。検出結果のみ表示され、セッションの開始には使用できません。`,
  fullAccessOnly: (p) =>
    `${p.agent} は操作ごとに承認を求めることができないため、「${p.fullAccess}」モードでのみ実行できます（現在は「${p.current}」）。「${p.fullAccess}」に切り替えてから再送信するか、別の Agent を使用してください。`,
  runtimeStopping: 'Runtime は停止中です',
  sessionBusy: 'このセッションではまだタスクが実行中です。停止するか、完了するまでお待ちください。',
  sessionBusyOther: 'このセッションでは別のタスクが実行中です。停止するか、完了するまでお待ちください。',
  oldTaskNotStopped: '以前のタスクがまだ停止していません。しばらくしてから再試行してください',
  attachmentsUnsupported: 'このバージョンでは画像の添付をまだ送信できません',
  attachmentDuplicate: '1 つのメッセージに同じ添付ファイルは 1 回しか含められません',
  tooManyImages: (p) => `1 つのメッセージに含められる画像は ${p.max} 枚までです`,
  imagesUnsupported: 'この Agent は画像に対応していません',
  contractRevisionMissing: (p) => `タスク契約にリビジョン ${p.revision} はありません（最新は ${p.latest}）`,
  taskEnded: 'タスクは終了している（または停止中の）ため、契約を変更できません。目標を変更するには tasks.changeGoal を使用してください',
  contractRevisionStale: (p) =>
    `契約はすでにリビジョン ${p.latest} で、${p.expected} ではありません。変更する前にもう一度読み込んでください`,
  checkMissing: (p) => `タスク契約にそのチェックはありません：${p.id}`,
  taskNotFound: (p) => `タスクが見つかりません：${p.id}`,
  approvalNotFound: (p) => `承認が見つかりません：${p.id}`,
  builtinId: (p) => `${p.id} は組み込み Agent の ID です。別の ID を選んでください`,
  agentExists: (p) => `ID が ${p.id} の Agent はすでに存在します`,
  builtinNotRemovable: (p) => `${p.agent} は組み込みのため削除できません。設定でオフにできます`,
  agentMissing: (p) => `ID が ${p.id} の Agent はありません`,
  providersUnsupported: 'この Runtime では Agent を追加または削除できません',
  modelMissing: (p) => `${p.agent} にモデル「${p.model}」はありません。${p.choices} から選んでください`,
  effortMissing: (p) => `モデル「${p.model}」に推論強度「${p.effort}」はありません。${p.choices} から選んでください`,
  effortUnsupported: (p) => `モデル「${p.model}」には推論強度のレベルがありません`,
  approvalNoGrant: 'この承認はデータを外部に送信しないため、許可の選択肢を含めることはできません',
  contractFieldsReadonly: (p) =>
    `Agent はタスク契約の次の項目を変更できません：${p.fields}。アクセスモード、権限の範囲、予算、保護範囲を決められるのはユーザだけです`,
};
