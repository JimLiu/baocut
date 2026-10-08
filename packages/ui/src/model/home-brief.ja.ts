import type { HomeBriefMessages } from './home-brief.ts';

export const ja: HomeBriefMessages = {
  about: (minutes: number, seconds: number) =>
    `約 ${[minutes ? `${minutes} 分` : '', seconds ? `${seconds} 秒` : ''].filter(Boolean).join(' ')}`,
  fromMaterials: '添付した素材から動画を作ってください。',
  materials: (paths: readonly string[]) => `素材：${paths.join('、')}`,
  connectFirst: '先に AI を接続',
  sayFirst: '作りたいものを入力するか、素材を添付してください',
  agentOffTitle: 'インストール済みのコーディング Agent がすべて無効です',
  agentOffBody: 'このコンピュータにはコーディング Agent がインストールされていますが、設定で無効になっています。いずれかを有効にすると、ここからすぐに始められます。',
  enableNamed: (name: string) => `${name} を有効にする`,
  enableAgent: 'Agent を有効にする',
  agentMissingTitle: 'これにはコーディング Agent が必要です',
  agentMissingBody: 'Claude Code または Codex CLI をインストールし、ご自身のサブスクリプションでサインインしてから、ここに戻って始めてください。',
  connectAgent: 'Agent を接続',
  nameEmpty: 'プロジェクト名を入力してください',
  nameInvalid: 'プロジェクト名にスラッシュや制御文字は使えません',
};
