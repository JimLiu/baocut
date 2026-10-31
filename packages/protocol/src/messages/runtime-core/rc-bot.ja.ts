import type { RcBotMessages } from './rc-bot.ts';

export const ja: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'メイン',
  channelNotFound: (p: { id: string }) => `チャンネルが見つかりません: ${p.id}`,
  mainChannelLocked: 'メインチャンネルはアーカイブも削除もできません。',
  channelArchived: 'このチャンネルはアーカイブされています。ここで作業を続けるには元に戻してください。',
  channelDeleteCountsChanged: 'このチャンネルのタスクまたは定期タスクの数が変わりました。もう一度確認してから削除してください。',
  memoryVersionConflict: '開いた後にメモリが変更されました。最新の内容を確認してから、もう一度お試しください。',
  memoryTooLarge: (p: { max: number }) => `メモリは最大 ${p.max} KB までです。追加する前に整理してください。`,
  memorySensitive: 'キー、パスワード、ID 番号、カード番号はメモリに入れないでください。',
  accessAboveChannelMax: 'タスクのアクセスモードをチャンネルの上限より高くすることはできません。',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `タスクが見つかりません: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `このタスクは ${p.from} の状態では「${p.event}」を実行できません。`,
  textHasLinkOrNumber: 'タスクのテキストにはリンク、メールアドレス、長い数字を含めないでください。リソースに入れてください。',
  titleByUser: 'このタイトルはあなたが書いたものなので、エージェントは変更できません。',
  userTasksNoThread: 'あなた自身のタスクではスレッドは始まりません。',
  stoppedByYou: 'あなたが停止しました。',
  continueOrStop: '続けますか、それとも停止しますか?',
  optionContinue: '続ける',
  optionStop: '停止',
  stalledNoProgress: (p: { minutes: number }) => `${p.minutes} 分間進捗がありません。`,
  stalledJobHung: (p: { job: string }) => `${p.job} の応答が予想よりかなり長い間ありません。`,
  stalledBudget: 'このタスクは予算の 80% を使いました。',
  interruptedOnExit: '前回 BaoCut を終了したときに中断されました。',
  threadLost: 'このタスクのスレッドが見つかりません。',
  needsYouToRun: (p: { agent: string }) => `この手順にはあなたの立ち会いが必要です。${p.agent} は手順ごとの承認に対応していません。今すぐ続けますか?`,
  approvalWaiting: (p: { summary: string }) => `あなたの承認待ち: ${p.summary}`,
  youAnswered: (p: { text: string }) => `あなたの回答: ${p.text}`,
  youConfirmedDone: 'あなたが完了を確認しました。',
  youReopened: 'あなたがこのタスクを再開しました。',
  previousQuestion: (p: { text: string }) => `前の質問: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `タスクが解決した後に、スレッドが ${p.what} を変更しました。`,
  movedFrom: (p: { channel: string }) => `${p.channel} から移動しました。`,
  queued: (p: { position: number }) => `空きを待っています (${p.position} 番目)。`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `バージョン ${p.version} で ${p.video} をあなたが編集しているため、エージェントの変更だけを取り消すことはできません。`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `${p.video} のバージョン ${p.version} にはあなたの編集とエージェントの編集が混在しているため、エージェントの変更だけを取り消すことはできません。`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `リマインダー: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} の期限は ${p.date} でした。まだ完了していません。`,
  reminderStale: (p: { title: string; days: number }) => `${p.title} は ${p.days} 日間あなたを待っています。`,
  welcome: 'こんにちは、ここでのアシスタントです。動画でやりたいことを教えてください。私が引き受けます。あなたの判断が必要なときはお知らせします。',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `こんにちは、ここでのアシスタントです。${p.projects} 件のプロジェクトと ${p.videos} 本の動画が見えています。やりたいことを教えてください。私が引き受けます。`,
  starterSummarize: '動画を要約',
  starterSummarizeText: '最新の動画を要約して',
  starterCaptions: '字幕を追加',
  starterCaptionsText: '最新の動画に字幕を付けて',
  starterHighlights: 'ハイライトを探す',
  starterHighlightsText: '最新の動画から一番良い場面を探して',
  markDone: '完了にする',
  handoffDriver: (p: { agent: string }) => `${p.agent} で続けます。`,
  editedMessage: 'あなたがこのメッセージを編集しました。',
  reactionYes: 'はい',
  reactionNo: 'いいえ',
  approvalNeedsYou: '承認があなたを待っています。',
  makeNoGenerator: 'テキストモデルが設定されていないため、提案を使えません。',
  scheduleNotReady: '定期タスクは現在使えません。',
  proposalChannelExists: '同じ名前のチャンネルがすでにあります。',
  dependencyWaiting: (p: { title: string }) => `「${p.title}」を待っています。`,
  lateStart: (p: { minutes: number }) => `${p.minutes} 分遅れて開始しました。`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} を確認できます`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} にあなたの回答が必要です`,
  notifyStalled: (p: { title: string }) => `${p.title} が止まっています`,
  notifyReminder: (p: { title: string }) => `リマインダー: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'このカードはもう使えません。',
  proposalHandled: 'このカードはすでに処理されています。',
  chipStale: 'これらの提案は古くなっています。',
  userOnly: 'これはユーザー本人にしかできません。',
  notReady: 'Bot モードはまだ準備ができていません。',
  automationPaused: '自動化は一時停止中です。',
};
