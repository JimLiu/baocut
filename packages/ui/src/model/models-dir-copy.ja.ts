import type { ModelsDirMessages } from './models-dir-copy.ts';

export const ja: ModelsDirMessages = {
  dir: {
    title: 'モデルフォルダ',
    defaultChip: '既定',
    envChip: '環境変数',
    change: '変更…',
    restore: '既定に戻す',
    envNote: '環境変数 BAOCUT_MODELS_DIR で指定されています。変更するには、環境変数を編集して BaoCut を再起動してください。',
    shareHint:
      'ほかのアプリとこのフォルダを共有している場合、ここでモデルを削除するとフォルダからファイルが削除され、それらのアプリでも見つからなくなります。',
    blockedPrefix: '現在は変更できません：',
    viewTasks: 'タスクを表示',
    changeTitle: 'モデルフォルダを変更',
    restoreTitle: '既定の場所に戻す',
    restoreLead: 'モデルフォルダを次の場所に戻します：',
    checking: 'このフォルダを確認中…',
    cancel: 'キャンセル',
    howTo: '既存のモデルの扱い',
    moveOption: '既存のモデルを移動する',
    switchOption: '場所だけを切り替える',
    confirmMove: '移動して変更',
    confirmSwitch: '場所を変更',
    movingLabel: 'モデルを移動中',
    stayOpen: 'その間は BaoCut を終了しないでください',
    missingDir:
      'このフォルダは存在しません（外付けドライブが接続されていない場合にも起こります）。接続すればモデルをまた使えます。別の場所を選ぶこともできます。',
    notWritableDir: 'BaoCut にはこのフォルダへの書き込み権限がないため、モデルをダウンロードできません。',
    loading: 'モデルフォルダを読み込み中…',
    pickFailed: (message) => `フォルダを選択できませんでした：${message}`,
    same: 'すでに現在のモデルフォルダです',
  },
  stats: (used, free, count) =>
    [`使用済み ${used}`, ...(free !== null ? [`ディスクの空き ${free}`] : []), `モデル ${count} 個を検出`].join(' · '),
  blocker: (downloading, testing, tasks) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`${downloading.join('、')} をダウンロード中`);
    if (testing.length) parts.push(`${testing.join('、')} を確認中`);
    if (tasks) parts.push(`${tasks} 件のタスクがローカルモデルを使用中`);
    return `${parts.join('、')}です。終わるのを待ってから変更してください。そうしないと、使用中のファイルが移動されます。`;
  },
  missingTitle: 'このフォルダが見つかりません',
  missingText: 'このフォルダは存在しません。外付けドライブが接続されていない場合にも起こります。接続してから、もう一度選んでください。',
  notWritableTitle: 'このフォルダには書き込めません',
  notWritableText:
    'BaoCut にはこのフォルダへの書き込み権限がないため、モデルをダウンロードできません。書き込み可能な場所を選ぶか、先に権限を変更してください。',
  nestedTitle: 'ここには置けません',
  nestedText:
    '新しい場所と現在のモデルフォルダが互いを含んでいます（一方がもう一方の中にあります）。現在のフォルダの中になく、それを含んでもいないフォルダを選んでください。',
  found: (count, bytes, free) =>
    `${
      count
        ? `ダウンロード済みのモデルが ${count} 個見つかりました（${bytes}）。すぐに使えます。`
        : 'このフォルダにはまだモデルがありません。今後ダウンロードするモデルはここに保存されます。'
    }${free !== null ? `ディスクの空きは ${free} です。` : ''}`,
  moveNoFit: (required, free, short) =>
    `移動には ${required} 必要ですが、移動先のドライブの空きは ${free} しかありません（${short} 不足）。収まりません。`,
  moveSameVolume: (size) => `同じドライブ上で ${size} を移動するため、すぐに終わります。移動後、元の場所にはファイルが残りません。`,
  moveOther: (size) => `${size} を移動します。移動後、元の場所にはファイルが残りません。`,
  switchDescription: (count) =>
    `元の場所のファイルは残り、削除されません。使えるのは新しい場所にすでにある${count ? ` ${count} 個の` : ''}モデルだけで、それ以外は未インストールと表示されます。`,
  appliedMoving: (where) => `${where} へのモデルの移動を開始しました`,
  appliedKept: (where) => `モデルフォルダを ${where} に変更しました · 元の場所のファイルは残っています`,
  applied: (where) => `モデルフォルダを ${where} に変更しました`,
  moveWaiting: (to) => `${to ? `${to} への` : ''}移動の開始を待機中…`,
  moveValidating: (amount) => `コピーしたファイルを検証中${amount ? `（${amount}）` : ''}…`,
  movePublishing: '移動を完了中…',
  moving: (amount, to) => `${to ? `${to} へ` : ''}移動中${amount ? ` ${amount}` : ''}…`,
};
