import type { RcPackageMessages } from './rc-package.ts';

export const ja: RcPackageMessages = {
  localPathPlaceholder: '<ローカルパスを削除済み>',
  assetsUnreadable: (p) =>
    `${p.count} 個の素材リビジョンを読み取れないため、パッケージが不完全になります。見つけ出すかリンクし直すか、見つからない素材のスキップを選んでください`,
  assetsUnreadableRecovery:
    'リンクし直す（relinkAsset）か、ファイルを復元してください。または missingAssets: skip で書き出すと、マニフェストに見つからない素材として記録されます',
  documentDigestMismatch: (p) =>
    `ドキュメント ${p.documentId} のリビジョン ${p.revision} の本文が、記録されたダイジェストと一致しません`,
  documentsContainLocalPaths:
    'ローカルパスを含むドキュメントがあり、ポータブルパッケージには含められません。先にそれらのドキュメントを編集してください',
  missingNote: (p) => `書き出し時に読み取れなかった（${p.reason}）`,
  localPathsRemoved: (p) =>
    `スナップショット内の ${p.count} 個のローカルパスをプレースホルダに置き換えました：${p.places}${p.more ? '…' : ''}`,
  assetNotPackaged: (p) =>
    `素材リビジョン ${p.key} を読み取れません（${p.reason}）。パッケージには含めず、マニフェストで見つからない素材として記録しました`,
  filesNotArchivable: '.baocut アーカイブに書き込めないファイルがあります',
  insufficientSpace: (p) =>
    `書き出し先フォルダのあるディスクの空き容量が足りません：約 ${p.required} 必要ですが、残りは ${p.available} です`,
  assetReadIncomplete: (p) => `素材「${p.name}」を書き出し中に完全に読み取れなかったか、変更されました`,
  assetContentChanged: (p) =>
    `素材「${p.name}」が記録された内容と一致しません（${p.linked ? 'リンクしたファイルが変更されています' : '動画内のファイルが破損しています'}）`,
  diskFullWhileWriting: 'パッケージの書き込み中に、書き出し先フォルダのあるディスクがいっぱいになりました',
  packageVerifyFailed: (p) => `書き込んだパッケージの検証に失敗しました：${p.error}`,
  manifestReadBackMismatch: '書き込んだパッケージから読み戻したマニフェストが、書き込んだ内容と異なります',

  tarFileTooLarge:
    '1 つのファイルは 8 GiB を超えられません（それより大きなファイルには pax 拡張ヘッダが必要ですが、このバージョンは対応していません）',
  tarPathTooLong: (p) => `パッケージ内のパスが長すぎます（最大 ${p.max} バイト）`,
  archivePathTooLong: (p) => `パッケージ内のパスが長すぎます：${p.path}`,
  archiveFileTooLarge: (p) => `ファイルが大きすぎます：${p.path}`,
  entryLongerThanExpected: (p) => `${p.path} が想定より長くなっています：読み取り中に変更されました`,
  entryShorterThanExpected: (p) => `${p.path} が想定より短くなっています：読み取り中に変更されました`,
  archiveHeaderCorrupt: 'アーカイブのヘッダが破損しています',
  archiveTruncated: 'アーカイブが途中で切れています',
  archiveChecksumMismatch:
    'アーカイブのヘッダのチェックサムが正しくありません：ファイルが破損しているか、.baocut パッケージではありません',
  notUstar: 'POSIX ustar アーカイブではありません',
  archiveHasLink: (p) => `パッケージにリンク（${p.path}）が含まれています。リンクは受け付けません`,
  unsafePath: (p) => `パッケージ内に安全でないパスがあります：${p.path}`,
  unsupportedEntryType: (p) => `パッケージに対応していない種類のエントリがあります（${p.path}）`,
  duplicateEntry: (p) => `パッケージ内に ${p.path} が 2 回出現しています`,
  entryTooLarge: (p) => `${p.path} が大きすぎます`,

  manifestNotJson: 'パッケージのマニフェストが JSON ではありません',
  notBaocutPackage: 'BaoCut のポータブルパッケージではありません',
  invalidPackageVersion: 'パッケージのバージョンが不正です',
  packageVersionTooNew: (p) =>
    `このパッケージのバージョンは ${p.version} ですが、このバージョンの BaoCut が対応しているのは ${p.supported} までです。新しい BaoCut で開いてください`,
  manifestMissingFileList: 'パッケージのマニフェストにファイル一覧がありません',
  manifestIncompleteFile: 'パッケージのマニフェストに不完全なファイル記録があります',
  manifestUnsafePath: (p) => `パッケージのマニフェストに安全でないパスがあります：${p.path}`,
  manifestIncompleteEntry: 'パッケージのマニフェストに不完全なリビジョン記録があります',
  manifestMissingKey: (p) => `パッケージのマニフェストに ${p.key} がありません`,
  packageNoManifest: 'パッケージにマニフェスト（video.manifest.json）がありません',
  manifestDuplicate: (p) => `パッケージのマニフェストに ${p.path} が 2 回出現しています`,
  fileNotInManifest: (p) => `パッケージにマニフェストにないファイルがあります：${p.path}`,
  fileMissingFromPackage: (p) => `マニフェストに記載されたファイルがパッケージにありません：${p.path}`,
  fileLengthMismatch: (p) => `${p.path} の長さがマニフェストと一致しません`,
  packageNoSnapshot: 'パッケージに動画のスナップショット（video.snapshot.json）がありません',
  fileDigestMismatch: (p) => `${p.path} の内容がマニフェストのダイジェストと一致しません`,
  entryAsset: (p) => `素材 ${p.ref}`,
  entryDocument: (p) => `ドキュメント ${p.ref}`,
  entryIncludedWithoutPath: (p) => `${p.what} は含まれていると記録されていますが、パスがありません`,
  entryDigestMismatch: (p) => `${p.what} の内容のダイジェストがパッケージ内のファイルと一致しません`,
  entryFileMissing: (p) => `パッケージに ${p.what} のファイルがありません`,
};
