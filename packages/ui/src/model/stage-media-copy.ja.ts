import type { StageMediaMessages } from './stage-media-copy.ts';

export const ja: StageMediaMessages = {
  titles: {
    missing: '元のファイルが見つかりません',
    changed: '元のファイルが変更されています',
    'outside-project': '元のファイルがプロジェクトフォルダの外にあります',
    unplayable: '元のファイルを再生できません',
  },
  causes: {
    missing: 'ファイルが移動、名前変更、削除されたか、接続が外れたドライブ上にある可能性があります。',
    changed:
      'この場所にあるファイルは、読み込んだときのファイルではなくなっています（サイズが一致しません）。上書きされたか、書き出し直された可能性があります。',
    'outside-project': '記録されている場所が、この動画のあるプロジェクトフォルダの外にあり、BaoCut はそこにあるファイルを読み込みません。',
  },
  unplayable: (error: string) => `プレーヤでこのファイルを開けません：${error}。`,
  tail: {
    video: '字幕はそのまま再生されますが、映像と元の音声はありません。',
    audio: '字幕はそのまま再生されますが、この音声は聞こえません。',
  },
  body: (cause: string, tail: string) => `${cause}${tail}`,
  volume: (volume: string) => `ファイルは「${volume}」にあります。そのドライブを接続すると自動的に復元されます。`,
  more: (count: number) => `ほかにも動画または音声の素材 ${count} 個を再生できません。`,
  relinkHint: '元のファイルを選ぶと復元できます。BaoCut は内容を照合するため、内容が異なるファイルは再リンクできません。',
  desktopOnly: '復元するには、BaoCut デスクトップアプリでこの動画を開き、キャンバス上の「再リンク…」で元のファイルを選んでください。',
  managed: 'このファイルは動画フォルダ内に保存されていたため、別の場所に再リンクすることはできません。',
  oldRevision: 'タイムラインはこの素材の古いバージョンを使っています。再リンクできるのは現在のバージョンだけです。',
  relink: '再リンク…',
  relinking: '確認中…',
  pickTitle: (name: string) => `「${name}」を探す`,
  pickButton: '再リンク',
  label: (name: string) => `「${name}」を再リンク`,
  relinkFailed: (message: string) => `再リンクできませんでした：${message}`,
  decodeFailed: 'デコードに失敗しました',
  unsupported: '非対応の形式',
};
