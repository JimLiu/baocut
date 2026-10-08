import type { ThreadMessages } from './thread-copy.ts';

export const ja: ThreadMessages = {
  videoTools: {
    videos_list: '動画を一覧表示',
    videos_create: '新しい動画',
    videos_inspect: '動画を読み取る',
    edits_apply: '動画を編集',
    edits_undo: '編集を取り消す',
  },
  toolTitle: (action: string, label: string) => `${action}：${label}`,
  steps: { command: 'コマンドを実行', read: 'ファイルを読み取る', edit: 'ファイルを編集', search: '検索', other: 'その他のツール' },
  phrase: {
    command: 'コマンドを実行',
    read: (count: number) => `${count} 個のファイルを読み取り`,
    edit: (count: number) => `${count} 個のファイルを編集`,
    search: '検索',
    video: (count: number) => `${count} 件の動画編集をコミット`,
    tool: 'ツールを呼び出し',
  },
  summary: (phrases: readonly string[]) => phrases.join('、'),
  thinking: '思考',
  stepsFallback: 'ステップ',
};
