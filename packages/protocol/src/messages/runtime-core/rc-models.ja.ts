import type { RcModelsMessages } from './rc-models.ts';

export const ja: RcModelsMessages = {
  offlineStrict: '厳格オフラインモードではモデルをダウンロードしません',
  sizeChanged: 'ダウンロードするバイト数が変わりました。新しい計画でもう一度確認してください',
  bundleInUse: 'モデルパッケージは使用中です。タスクが終了するかキャンセルされてから削除してください',
  diarizationNoCheck:
    '話者分離のモデルパッケージには単独の確認がありません：文字起こしのときに認識モデルパッケージと一緒に使われます',
  bundleUnavailable: 'モデルパッケージは現在使用できません',
  installFailed: 'モデルのインストール中にエラーが発生しました',
  noSuchBundle: (p) => `このモデルパッケージはありません：${p.bundleId}`,
  movingDirWait: 'モデルフォルダを移動中です。完了してから再試行してください',
  dirMissing:
    'モデルフォルダが存在しません（外付けドライブが接続されていない場合にも起こります）。接続して再試行するか、設定で別のモデルフォルダを選んでください',
  selfTestSampleLabel: '認識チェックのサンプル',

  workerFailed: (p) => `Worker が失敗しました：${p.reason}`,
  workerCancelledCheck: 'Worker が自分で確認をキャンセルしました',
  noWorkerOutput: 'Worker が何も出力しませんでした',
  outputMissing: '出力ファイルが存在しません',
  outputMismatch: '出力ファイルの長さまたは sha256 が Worker の応答と一致しません',
  namedOutputMissing: (p) => `出力ファイル ${p.file} が存在しません`,
  namedOutputMismatch: (p) => `${p.file} の長さまたは sha256 が Worker の応答と一致しません`,
  outputNotJson: '出力が有効な JSON ではありません',
  outputNotAsrResult: '出力が asr-result の契約に従っていません',
  transcriptMissingExpected: (p) => `認識されたテキストに「${p.expected}」が含まれていません`,
  separationPassed: (p) =>
    `${p.duration} 秒 · ${p.sampleRate} Hz · ボーカルが背景より${p.finite ? ` ${p.ratio} dB ` : 'はるかに'}大きい`,
  speechPassed: (p) => `${p.duration} 秒 · ${p.sampleRate} Hz`,
  imagePassed: (p) => `${p.width}×${p.height} · ${p.steps} ステップ`,

  envLocked:
    'モデルフォルダは環境変数 BAOCUT_MODELS_DIR で指定されています。変更するには環境変数を変更して BaoCut を再起動してください',
  movingDirWaitOrCancel: 'モデルフォルダを移動中です。移動が完了するかキャンセルされてから変更してください',
  folderMissing: 'このフォルダは存在しません（外付けドライブが接続されていない場合にも起こります）',
  folderNotWritable: 'BaoCut にはこのフォルダへの書き込み権限がありません',
  dirNested:
    '新しい場所と現在のモデルフォルダが互いを含んでいます。現在のフォルダの中になく、それを含みもしないフォルダを選んでください',
  noSpaceForMove: '新しい場所のディスクに、移動するモデルを入れる空き容量がありません',
  noSpaceRemedy: '空き容量を確保するか、別の場所を選ぶか、「場所だけを切り替える」を選んでください',
  dirInUse: 'ローカルモデルを使用中のタスクがあります。タスクが終了するかキャンセルされてからモデルフォルダを変更してください',
  sourceKept: (p) => `元のフォルダにある ${p.count} 個のリポジトリを削除できませんでした。手動で削除できます`,
  moveNoSpace: '新しい場所のディスクがいっぱいになったため、移動を元に戻しました',
  moveFailed: 'モデルの移動中にエラーが発生したため、移動を元に戻しました',
  moveFailedRemedy: '元のモデルフォルダは変わっておらず、モデルは引き続き使用できます',

  noAlignableFormat: (p) => `モデル ${p.modelId} は位置合わせ可能な音声形式を出力しません`,
  synthOutputCount: (p) => `音声合成の出力が ${p.count} 個あります。1 個である必要があります`,
  synthOutputOutsideStaging: '音声合成の出力が staging フォルダにありません',
  dubGrantHint: (p) =>
    `吹き替えでは文字起こし（翻訳と、翻訳がない部分の原文）を ${p.recipient} に送信します。プロバイダをオンにしたときに作成される既定の許可には文字起こしが含まれないため、` +
    'ユーザが明示的に許可を発行してから（下のコマンド、または BaoCut の設定で）、この吹き替えをもう一度実行する必要があります。',
  voiceRemoved: (p) => `${p.reason}：声 ${p.voice}`,

  notSpeakersJob: 'このタスクは話者の認識ではありません',
  jobNotForVideo: 'この認識はこの動画のものではありません',
  speakersNotDone: '話者の認識が完了していません',
  speakersCleaned: '認識結果は削除されました。もう一度話者を認識してください',

  recoveryPrincipalName: 'タスクの復旧',
};
