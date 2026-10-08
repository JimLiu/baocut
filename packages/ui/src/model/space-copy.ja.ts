import type { SpaceMessages } from './space-copy.ts';

export const ja: SpaceMessages = {
  kind: {
    video: '動画',
    export: '書き出し',
    'video-file': '動画素材',
    image: '画像',
    audio: '音声',
    subtitle: '字幕',
    document: 'ドキュメント',
    package: '動画パッケージ',
    template: 'テンプレート',
  },
  categoryAll: 'すべて',
  favorite: 'お気に入り',
  trash: 'ゴミ箱',
  sort: { recent: '最近のアクティビティ', name: '名前', kind: '種類' },
  status: {
    generating: '生成中',
    candidate: '候補',
    applied: '適用済み',
    published: '公開済み',
    'source-changed': 'ソースが変更済み',
    missing: '見つかりません',
    failed: '失敗',
  },
  statusAny: 'すべての状態',
  statusNone: '状態なし',
  noProject: 'プロジェクトに属していません',
  removedProject: '削除されたプロジェクト',
  conversation: (title: string) => `セッション「${title}」`,
};
