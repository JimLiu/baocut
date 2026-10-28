import type { ProvidersAgentMessages } from './providers-agent.ts';

export const ja: ProvidersAgentMessages = {
  codexUpgradeHint: 'Codex CLI を更新してから（例：npm install -g @openai/codex@latest）、もう一度確認してください',
  codexImageModel: 'Codex の画像生成（モデルは Codex とお使いのアカウントが決定）',
  codexImageNotes:
    'このコンピュータでサインイン済みの Codex アカウントで生成します。1 回に PNG 1 枚、同時に実行できるのは 1 タスクのみで、通常 1〜2 分かかります。' +
    'サイズとシードは指定できず（指定したリクエストは拒否されます）、ピクセルサイズは生成結果によって決まります。サブスクリプションの利用枠を使い、残りの枠は不明です。' +
    'オンにすると、プロンプトを Codex アカウントに送信することに同意したことになります。',
  codexImageNotesApiKey:
    "Codex は API キーなど ChatGPT サブスクリプション以外の方法でサインインしています。画像生成が使えない場合があり、費用はサブスクリプションではなくそのアカウントに請求されます。BaoCut は自動では選びません。試すには手動で選んでください。1 回に PNG 1 枚、サイズと seed は指定できません。",
  imagesOnly: (p) => `${p.label} は画像しか生成できません`,
  onePngOnly: (p) => `${p.label} は一度に PNG を 1 枚しか生成できず、サイズとシードは指定できません`,
  unavailable: (p) => `${p.label} を使用できません：${p.message}`,
  sessionNotStarted: (p) => `${p.label} のセッションを開始できませんでした：${p.error}`,
  timedOut: (p) => `${p.label} が ${p.minutes} 分以内に完了しなかったため、中断しました`,
  exited: (p) => `${p.label} が予期せず終了しました：${p.message}`,
  notCompleted: (p) => `${p.label} はこの生成を完了しませんでした：${p.reason}`,
  turnInterrupted: 'ターンの中断',
  noImage: (p) => `${p.label} は画像を生成しませんでした`,
  noImageReply: (p) => `${p.label} は画像を生成しませんでした：${p.reply}`,
  unknownError: '不明なエラー',
  processExited: 'プロセスが終了しました',
  turnNotStarted: (p) => `ターンを開始できませんでした：${p.error}`,
  codexTextModel: "Codex のテキスト生成（モデルは Codex とお使いのアカウントが決定）",
  codexTextNotes:
    "このコンピュータでサインイン済みの Codex アカウントで文章を生成します。同時に実行できるのは 1 リクエストのみで、毎回新しい Codex セッションを開くため API より時間がかかります。推論の強さ、temperature、seed、出力の長さは指定できません。サブスクリプションの利用枠を使い、残りの枠は不明です。オンにすると、プロンプト（含まれる書き起こしなども含む）を Codex アカウントに送信することに同意したことになります。",
  codexTextNotesApiKey:
    "Codex は API キーなど ChatGPT サブスクリプション以外の方法でサインインしています。費用はサブスクリプションではなくそのアカウントに請求されます。同時に 1 リクエストのみ。推論の強さ、temperature、seed、出力の長さは指定できません。",
};
