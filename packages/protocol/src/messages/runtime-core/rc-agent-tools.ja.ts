import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return '字幕';
    case 'transcript':
      return '文字起こし';
    case 'audio':
      return '音声';
    case 'video':
      return '動画ファイル';
    case 'portable':
      return 'ポータブルパッケージ';
    case 'project':
      return 'プロジェクトファイル';
    default:
      return kind;
  }
}

function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `、言語 ${p.language}` : ''}${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`;
  if (p.target === 'create') {
    return `、動画${p.name ? `「${p.name}」` : '（名前はページタイトル）'}を作成してタイムラインに追加${p.transcribe ? `してから文字起こし${recognition}${p.captions ? 'と字幕レイヤーの作成' : ''}` : ''}`;
  }
  if (p.target === 'video') return `、動画に読み込み${p.transcribe ? 'して文字起こし' : ''}`;
  if (p.target === 'project') return `、プロジェクトの downloads/ に保存${p.transcribe ? 'して TXT と SRT に文字起こし' : ''}`;
  if (p.target === 'download') return `、ダウンロードフォルダに保存${p.transcribe ? 'して TXT と SRT に文字起こし' : ''}`;
  return '';
}

export const ja: RcAgentToolsMessages = {

  instructionsNotSet: 'セッションの指示が設定されていません：Runtime の組み立て順序が正しくありません',
  listSeparator: '、',
  clauseSeparator: '、',

  createVideoSummary: (p) => `動画「${p.name}」を作成`,
  editsSummary: (p) => `${p.label}（${p.count} 件の操作：${p.types}）`,
  captionsSummary: (p) => `ドキュメント ${p.documentId} の${p.bilingual ? 'バイリンガル' : ''}字幕レイヤーを追加`,
  captionsLabel: '字幕レイヤーを追加',
  undoSummary: (p) => `編集 ${p.transactionId} を取り消し`,
  undoLatestSummary: '直前の編集を取り消し',
  deleteVideoSummary: (p) =>
    `動画「${p.name}」（${p.path}）を削除：ゴミ箱に移動し、${p.days} 日間は Space で復元できます。リンクした素材の元ファイルはそのまま残ります`,
  importPackageSummary: (p) => `ポータブルパッケージ ${p.file} を開く`,
  renameVideoLabel: '動画の名前を変更',
  putDocumentSummary: (p) => `ドキュメント ${p.documentId} の新しいバージョンを書き込み`,
  newDocumentSummary: (p) => `ドキュメントを作成（${p.kind}）`,
  updateDocumentLabel: (p) => `ドキュメント「${p.name}」を更新`,
  newDocumentLabel: (p) => `ドキュメント「${p.name}」を作成`,
  translationDocumentName: (p) => `${p.language} の翻訳`,
  importAssetSummary: (p) => `素材 ${p.name} を読み込み${p.place ? '、タイムラインに追加' : ''}`,
  importAssetLabel: (p) => `${p.name} を読み込み${p.place ? '、タイムラインに追加' : ''}`,
  replaceCompositionSummary: (p) => `${p.name} を読み込み、タイムライン上のクリップ ${p.clip} と置き換え`,
  replaceCompositionLabel: (p) => `モーショングラフィックを ${p.name} に置き換え`,
  pruneAssetsSummary: (p) => `使われていない素材を動画から削除（${p.count} 個）：${p.names}`,
  pruneAssetsLabel: (p) => `使われていない素材を整理（${p.count} 個）`,
  adoptChaptersSummary: (p) =>
    `${p.asset} の配信元のチャプターを採用（${p.count} 個）${p.existing ? `、既存のチャプター（${p.existing} 個）を置き換え` : ''}`,
  adoptChaptersLabel: '配信元のチャプターを採用',

  transcribePurpose: (p) => `素材 ${p.assetId} を文字起こし`,
  transcribeSummary: (p) =>
    `素材 ${p.assetId} を文字起こし${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`,
  speechPurpose: (p) => `音声合成（${p.chars} 文字）`,
  speechSummary: (p) =>
    `音声合成（${p.chars} 文字${p.provider ? `、${p.provider}` : ''}${p.voice ? `、声 ${p.voice}` : ''}）`,
  imagePurpose: (p) => `画像を生成：${p.prompt}`,
  imageSummary: (p) => `画像を生成（${p.count} 枚${p.size ? `、${p.size}` : ''}${p.provider ? `、${p.provider}` : ''}）：${p.prompt}`,
  cancelJobSummary: (p) => `タスク ${p.jobId} をキャンセル`,
  retryPipelineSummary: (p) =>
    `パイプライン ${p.jobId}（${p.pipeline}、${p.attempt} 回目）を失敗したステップから再実行`,
  saveArtifactSummary: (p) => `生成物 ${p.artifactId} を ${p.path} として保存`,
  overwriteArtifactSummary: (p) => `生成物 ${p.artifactId} で既存のファイル ${p.path} を上書き`,

  exportSummary: (p) => {
    const range = p.rangeStart !== null ? `、${p.rangeStart}–${p.rangeEnd} 秒` : p.rangeCount !== null ? `、${p.rangeCount} 区間` : '';
    const size =
      p.width !== null && p.height !== null
        ? `、${p.width}×${p.height}`
        : p.width !== null
          ? `、幅 ${p.width}`
          : p.height !== null
            ? `、高さ ${p.height}`
            : '';
    const source = p.originalOnly ? '、元の音声のみ' : p.dubGroupId ? `、吹き替え ${p.dubGroupId} のみ` : '';
    return `${exportKindLabel(p.kind)}を書き出し（${p.format}${range}${size}${source}）${p.fileName ? `、ファイル名 ${p.fileName}` : ''}${p.overwrite ? '、既存のファイルを上書き' : ''}`;
  },

  installToolSummary: (p) =>
    `リンクから動画をダウンロードするため、${p.url} から ${p.tool} ${p.version}（${p.estimated ? `約 ${p.size}` : p.size}、${p.license}）をインストール。${p.host} からのダウンロードに必要です`,
  linkImportSummary: (p) =>
    `${p.tool}${p.version ? ` ${p.version}` : ''} で ${p.host} からダウンロード：${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) =>
    `BaoCut がこのコンピュータの ${p.tool}${p.version ? ` ${p.version}` : ''}${p.path ? `（${p.path}）` : ' '}を使って Web サイトから動画をダウンロードすることを許可し、${p.host} からダウンロード：${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p) =>
    `作業フォルダの ${p.source}（${p.size}）をダウンロードフォルダにコピー：${p.target}（同名のファイルがあれば番号を付け、上書きしません）`,

  grantSummary: (p) => `${p.recipients} にデータを送信：${p.items}`,
  grantSummaryItem: (p) => `${p.purpose}（${p.maxCalls === null ? '呼び出し回数の上限なし' : `最大 ${p.maxCalls} 回`}）`,

  testModelSummary: (p) => `ローカルモデルパッケージ ${p.bundleId} を確認：固定のサンプルで最初から最後まで実行`,
  installModelSummary: (p) =>
    `ローカルモデル ${p.bundleId} をダウンロード：${p.estimated ? `約 ${p.size}（サイズ不明のため推定）` : p.size}${p.resumed ? `、ダウンロード済みの ${p.resumed} から再開` : ''}、ダウンロード元 ${p.source}（${p.parts}）`,

  registerProjectSummary: (p) => `既存のフォルダ ${p.path} をプロジェクトとして登録${p.name ? `（${p.name}）` : ''}`,
  createProjectSummary: (p) => `プロジェクトフォルダ ${p.path} を作成${p.name ? `（${p.name}）` : ''}`,
};
