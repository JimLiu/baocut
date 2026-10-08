import type { SpeakersMessages } from './speakers-copy.ts';

export const ja: SpeakersMessages = {
  title: '話者を識別',
  back: '戻る',
  background: 'バックグラウンドで実行中',

  // 设置
  cardTitle: '誰が話しているかを区別',
  cardBody: '声紋で話者を識別し直し、字幕と文字起こしに名前を付けます。結果はまず確認でき、適用するまで何も変更されません。',
  who: '実行方法',
  local: 'ローカル声紋モデル',
  localSub: 'このコンピュータの外に出ません',
  agent: 'Agent に任せる',
  agentSub: 'この動画のセッションで実行',
  scope: '範囲',
  scopeAll: '動画全体',
  scopeLocal: (scope: string) => `ローカルでの識別は動画全体が対象です。「${scope}」だけを識別するには Agent に任せてください。`,
  packHint: (size: string | null) =>
    `ローカル声紋モデル${size ? `（約 ${size}）` : ''}は初回実行時にダウンロードされ、以降はオフラインで使えます。`,
  packDownloading: (pct: number | null) =>
    `ローカル声紋モデルをダウンロード中${pct === null ? '…' : ` · ${pct}%`}。完了すると識別が始まります。`,
  packUnlisted: 'このコンピュータで使えるローカル声紋モデルがないため、Agent でのみ実行できます。',
  noSpeech: 'この動画はまだ文字起こしされていません。先に字幕パネルで文字起こししてから、話者を識別してください。',
  manySpeech: '動画に文字起こしが複数あります。最初のものを使います',
  start: '開始',
  startHint: '完了すると確認ページが開きます。適用前に確認が必要なのはこのツールだけです。',
  agentHint: 'このリクエストを動画のセッションに送り、Agent がすぐに開始します。',
  readOnly: '動画が読み取り専用のため、話者を識別できません。',
  web: 'ブラウザでは話者を識別できません',
  webBody: '話者の識別にはこのコンピュータのローカル声紋モデルを使います。BaoCut デスクトップアプリをお使いください。',

  // 运行
  submitting: '送信中…',
  queued: '待機中…',
  running: '話者を識別中…',
  activity: (stage: string) => `ローカル声紋モデル · ${stage}`,
  runNote: '編集を続けられます · 識別はバックグラウンドで実行され、完了すると確認ページが開きます。文字起こしは直接変更されません。',
  cancel: 'キャンセル',
  cancelled: '話者の識別をキャンセルしました',
  cancelFailed: (message: string) => `キャンセルできませんでした：${message}`,

  // 确认
  found: (n: number) =>
    `${n} 人の話者が見つかりました。サンプルを聞いて誰が誰かを確認し、名前をクリックして変更してから適用してください。`,
  same: '話者の区切りは現在のラベルと同じです。適用すると名前だけが変わります。',
  newSpeaker: '新規',
  rename: '名前を変更',
  renameLabel: (name: string) => `「${name}」の名前を変更`,
  sentences: (n: number) => `${n} 文`,
  clipOff: 'この文はカットされ、タイムライン上にありません',
  splitTitle: (n: number) => `${n} 件の翻訳を分割し直します。再翻訳は不要です`,
  splitBody: '話者の区切りの変更は字幕行の分割にのみ影響し、訳文はそのままです。',
  skipped: (n: number) =>
    `古い形式の翻訳 ${n} 件は分割し直されません。適用後は文が揃わなくなり、古いものとして表示されます。`,
  apply: '適用',
  applyHint: '適用後もいつでも取り消せます。',
  discard: 'この結果を破棄',

  // 收据
  engine: 'ローカル声紋モデル',
  undoneReceipt: '取り消しました · 話者ラベルを復元しました',
  undo: '取り消す',
  redo: 'やり直す',
  again: '再実行',
  done: '完了',
  splitDone: (n: number) => `${n} 件の翻訳を新しい話者の区切りで分割し直しました。再翻訳はしていません。`,
  undoneTitle: '取り消し済み',
  undoneBody: '「再実行」で最初からやり直せます。識別の設定は保持されます。',
  captionsStale: (n: number) => `${n} 本の字幕トラックは古い文字起こしから作成されたため、更新されていません。`,
  gotoCaptions: '字幕を開く',
  noUndo: '取り消すものはありません。結果は現在のラベルと同じです。',
  undoFailed: '取り消せませんでした',
  redoFailed: 'やり直せませんでした',

  // 问题
  failed: '話者の識別に失敗しました',
  interrupted: '話者の識別が中断されました',
  submitFailed: '話者の識別を開始できませんでした',
  applyFailed: '結果を適用できませんでした',
  applyStale: '識別後に文字起こしまたは翻訳が変更されました。もう一度実行してから適用してください。',
  badResult: '結果を読み取れませんでした。もう一度実行してください。',
  retry: '再試行',
  decide: 'バックグラウンドタスクで対応',
  dismiss: 'OK',
  chapterScope: (n: number, label: string) => `チャプター ${n} · ${label}`,
  manySpeechNamed: (name: string) => `動画に文字起こしが複数あります。最初の「${name}」を使います`,
};
