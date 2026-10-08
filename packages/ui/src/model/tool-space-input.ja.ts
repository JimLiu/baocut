import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const ja: ToolSpaceInputMessages = {
  reasons: {
    trashed: 'ゴミ箱にあります',
    generating: 'まだ生成中です。完了すると選べます',
    missing: 'ファイルが見つかりません。再接続してから選んでください',
    failed: '前回の生成に失敗しました',
    textOnly: '.txt と .md ドキュメントのテキストのみ読み取れます',
    subtitleOnly: '.srt と .vtt の字幕のみ受け付けます',
    noPath: 'この項目にはこのコンピュータ上のファイルがありません。新しい動画はローカルファイルから始める必要があります',
  },
  joinKinds: (labels) => labels.join('、'),
};
