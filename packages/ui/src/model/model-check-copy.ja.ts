import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: 'モデルは動作しますが、サンプルの音声を認識できません',
  synthesize: 'モデルは動作しますが、合成された声が正しくありません',
  image: 'モデルは動作しますが、描かれた画像が正しくありません',
  separate: 'モデルは動作しますが、声と背景を分離できませんでした',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'BaoCut に付属するファイルが見つかりません。モデルの問題ではありません',
    todo: 'BaoCut を再インストールすると解決します。ダウンロード済みのモデルには影響しません。',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: 'モデルのファイルが破損しています', todo: '修復すると、破損したファイルをもう一度ダウンロードします。' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: 'まず修復してください。修復後も同じ場合は、技術的な詳細をコピーして送ってください。',
  }),
  MODEL_OUT_OF_MEMORY: () => ({
    text: 'メモリが足りないため、モデルを読み込めませんでした',
    todo: 'ほかの大きなモデルやメモリを多く使うアプリを閉じてから、もう一度確認してください。',
  }),
  MODEL_WORKER_FAILED: () => ({
    text: 'モデルを実行するバックグラウンドプロセスでエラーが発生しました',
    todo: 'もう一度確認してください。繰り返し起きる場合は BaoCut を再起動するか、技術的な詳細をコピーして送ってください。',
  }),
};

function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `メモリが足りず、${verb}を完了できませんでした`, todo: noMemoryTodo },
    modelError: { text: `モデルでエラーが発生し、${verb}できませんでした`, todo: 'モデルを確認して、何が問題かを調べてください。' },
    other: (message) => ({
      text: `${verb}できませんでした：${message}`,
      todo: '再試行できます。繰り返し起きる場合は、バックグラウンドタスクで詳細を確認してください。',
    }),
    notStarted: (message) => ({ text: `${verb}を開始できませんでした：${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo}今${noun}しても、おそらく失敗します。`,
  };
}

export const ja: ModelCheckMessages = {
  label: {
    check: '確認',
    checkFull: 'モデルを確認',
    recheck: '再確認',
    repair: '修復…',
    repairSub: '破損したファイルだけをもう一度ダウンロードします',
    details: '技術的な詳細',
    hideDetails: '技術的な詳細を隠す',
    copy: '技術的な詳細をコピー',
    copied: '技術的な詳細をコピーしました',
    copyFailed: 'コピーできませんでした。上のテキストを選択して、手動でコピーしてください。',
    cancel: 'キャンセル',
    retry: '再試行',
    pickRef: '別の録音を選択…',
    useSample: 'サンプル録音を使用',
  },
  caption:
    '確認ではモデルが正しく動作するかを確かめます。修復では破損したファイルだけをもう一度ダウンロードします。モデルを削除しても、ほかのモデルがまだ使っている共通コンポーネントは残ります。',
  head: {
    running: '確認中…',
    repairing: '修復中…',
    failed: '確認で問題が見つかりました：',
    notStarted: '確認を開始できませんでした：',
  },
  sentence: (text) => `${text}。`,
  phase: {
    queued: '待機中',
    loading: 'モデルを読み込み中',
    running: '短いサンプルを実行中',
    verifying: '結果を検証中',
    repairing: '破損したファイルをもう一度ダウンロード中。修復後に自動でもう一度確認します',
  },
  checkSentences,
  unknown: {
    text: 'モデルが正しく動作しませんでした',
    todo: 'もう一度確認してください。繰り返し起きる場合は、技術的な詳細をコピーして送ってください。',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: {
      text: 'BaoCut のバックグラウンドサービスが応答していません',
      todo: 'しばらくしてからもう一度確認してください。繰り返し起きる場合は BaoCut を再起動してください。',
    },
    MODEL_IN_USE: {
      text: '別のタスクがこのモデルを使用中です',
      todo: 'そのタスクが終わるのを待つか、バックグラウンドタスクでキャンセルしてから、もう一度確認してください。',
    },
    MODEL_UNAVAILABLE: { text: 'このモデルは現在使用できません', todo: '先に修復するか、もう一度有効にしてから確認してください。' },
    RESOURCE_ADMISSION_UNSATISFIABLE: {
      text: 'このコンピュータにはこのモデルを実行するだけのメモリがありません',
      todo: 'もっと小さいモデルに切り替えてください。',
    },
    WEB_METHOD_NOT_ALLOWED: { text: 'ブラウザではローカルモデルを確認できません', todo: 'デスクトップアプリで確認してください。' },
    OFFLINE_STRICT: { text: '厳格オフラインモードがオンです', todo: '設定で厳格オフラインモードをオフにしてから、もう一度確認してください。' },
  },
  notStartedUnknown: {
    text: 'BaoCut はこの確認を受け付けませんでした',
    todo: 'しばらくしてからもう一度確認してください。繰り返し起きる場合は、技術的な詳細をコピーして送ってください。',
  },
  detail: {
    code: (code) => `コード ${code}`,
    model: (id, when) => `モデル ${id} · ${when}`,
    message: (message) => `メッセージ ${message}`,
    passed: (when) => `確認で問題なし · ${when}`,
  },
  noticeText: (what) => `このモデルは前回の確認で問題が見つかりました：${what}`,
  refUnreadable: (file) => ({
    text: `録音「${file}」を読み取れませんでした。ファイルが破損しているか、音声ではない可能性があります`,
    todo: '別の録音を試すか、先にサンプル録音で仕上がりを聞いてみてください。',
  }),
  refUnknown: '録音',
  trySpeech: trySubject('合成', '試聴', 'ほかの大きなモデルやメモリを多く使うアプリを閉じてから、再試行してください。'),
  tryImage: trySubject('描画', '試し描き', 'ほかの大きなモデルを閉じてから再試行するか、ステップ数を下げてください。'),
};
