import type { ThreadMessages } from './thread-copy.ts';

export const ja: ThreadMessages = {
  withDetail: (text, detail) => `${text}（${detail}）`,
  copy: 'コピー',
  copied: 'コピーしました',
  copyFailed: 'コピーできませんでした。再試行してください',
  copyCode: 'コードをコピー',
  copyReply: 'この返答をコピー',
  change: {
    added: (n) => `追加 ${n}`,
    updated: (n) => `変更 ${n}`,
    deleted: (n) => `削除 ${n}`,
    duration: (clock) => `長さ ${clock}`,
    durationChange: (before, after) => `長さ ${before} → ${after}`,
    revision: (before, after) => `バージョン ${before} → ${after}`,
    locked: '動画は現在変更できません',
    undoStep: (videoName, label) => `「${videoName}」の 1 ステップを取り消しました：${label}`,
    changed: (videoName, label) => `「${videoName}」を変更しました：${label}`,
    aria: (label) => `動画の変更：${label}`,
  },
  message: {
    contextTitle: 'メッセージと一緒に送られたエディタの状態',
    context: (videoName, revision, playhead, selected) =>
      `「${videoName}」 · バージョン ${revision} · 再生ヘッド ${playhead}${selected ? ` · ${selected} 個のクリップを選択中` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}、${detail}`,
  },
  steps: {
    more: (n) => `${n} 件を実行中`,
    failed: (n) => `${n} 件失敗`,
    thinking: '思考',
    viewFile: (name) => `${name} を表示`,
    input: '入力',
    error: 'エラー',
    output: '出力',
    waiting: '出力待ち',
    noOutput: '出力なし',
  },
};
