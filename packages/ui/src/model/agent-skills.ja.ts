import type { AgentSkillsMessages } from './agent-skills.ts';

export const ja: AgentSkillsMessages = {
  origin: { builtin: '内蔵', personal: 'マイ', 'third-party': 'サードパーティ' },
  all: 'すべて',
  commit: (sha: string) => `（${sha}）`,
  bytes: (n: number) => `${n} バイト`,
  action: {
    load: 'Skills を読み込み',
    toggle: '切り替え',
    add: '追加',
    import: '読み込み',
    remove: '削除',
    read: 'ファイルを読み込み',
    send: '送信',
  },
  exists: (id: string | null) =>
    `${id ? `「${id}」という` : '同じ'}名前の Skill がすでにあるため、上書きしません。先に古いほうを削除するか、フォルダの名前を変えてから追加し直してください。`,
  invalid: (issue: string) => `使える Skill ではありません：${issue}。ルートフォルダに、先頭に name と description を書いた SKILL.md が必要です。`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `この Skill は大きすぎます。Skill 1 つあたりファイルは最大 ${files} 個・合計 ${total} まで、SKILL.md 自体は ${skillFile} までです。`,
  githubNotFound: 'GitHub でこのリポジトリ、ブランチ、またはフォルダが見つかりませんでした（非公開の可能性があります）。アドレスを確認してください。',
  folderNotFound: 'このフォルダが見つかりませんでした。移動または削除された可能性があります。',
  urlInvalid: 'アドレスを認識できませんでした。owner/repo、または https://github.com/owner/repo/tree/ブランチ/フォルダ の形式で入力してください。',
  network: 'GitHub に接続できません。ネットワークを確認して、もう一度お試しください。',
  rateLimited: 'GitHub の匿名アクセスの上限に達しました。しばらくしてからもう一度読み込んでください。',
  offline: '厳格オフラインモードがオンのため、GitHub から読み込めません。',
  builtinNotRemovable: '内蔵の Skill は削除できませんが、オフにはできます。',
  notFound: 'この Skill はもうありません。削除されたばかりの可能性があります。',
  fileNotFound: 'このファイルはもうありません。',
  fileTooLarge: 'このファイルは大きすぎるため、ここには表示しません。フォルダで開いてください。',
  fileNotText: 'テキストファイルではないため、ここには表示しません。',
  webNotAllowed: 'ブラウザではこの操作はできません。BaoCut デスクトップアプリで行ってください。',
  webReadOnly: 'このブラウザセッションは読み取り専用のため、変更できません。',
  failed: (action: string, raw: string) => `${action}できませんでした：${raw}`,
  sendFailed: (raw: string) => `送信できませんでした：${raw}`,
};
