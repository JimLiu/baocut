import type { LibraryMessages } from './library-copy.ts';

export const ja: LibraryMessages = {
  help: `使い方：
  baocut library import <file>     交換ファイルを読み込み、種類は拡張子ではなく内容で判別：Markdown の用語集、
                                   .bcvoice の声パック、ブランドキットの色と字幕スタイルの JSON、Lottie ステッカー、
                                   画像、動画、フォント
  baocut library export <library> <id> <path>
                                   現在のバージョンを書き出し：用語集は Markdown、声は .bcvoice、ブランド素材は
                                   元のファイルとして。書き出し先がすでにある場合は上書きしません
  baocut library remove <library> <id>
                                   項目を削除（動画にコピー済みの内容には影響しません）
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   声の参照音声をプロバイダにアップロードしてクローンを作成（現在は elevenlabs のみ）：
                                   同意の表明と、「audio」を含むデータ送信の許可（baocut grants create）が必要です。
                                   タスクとして実行し、Ctrl-C でキャンセル
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   クローンを削除：まずプロバイダに削除を依頼し、成功したら記録を消去します。
                                   --local-only はローカルの記録だけを消去
  baocut library video-selection <video id> [options]
                                   動画で有効にしているライブラリの項目（動画に保存、取り消し可能）：オプションなしで表示。
                                   指定した部分はまとめて置き換え、指定しなかった部分はそのまま。
                                   新しい動画では、ライブラリで「既定で有効」にした用語集が自動で有効になります
    --transcribe-glossaries <id,…> 文字起こし用の用語集（文字起こしで用語集を指定しなかったときに使用）。
                                   空文字列で消去
    --translate-glossaries <id,…>  翻訳用の用語集（translate と dub の翻訳で使用）。空文字列で消去
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   話者の声（複数指定可、まとめて置き換え）：library:<id> またはプロバイダの声 ID
                                   （その場合は @Provider を付ける）
    --clear-speaker-voices         話者の声を消去`,
  importUsage: '使い方：baocut library import <file>',
  exportUsage: '使い方：baocut library export <glossaries|voices|brand> <id> <path>',
  removeUsage: '使い方：baocut library remove <glossaries|voices|brand> <id>',
  voiceCloneUsage: '使い方：baocut library voice-clone <voice id> --provider <id> [--name <name>]',
  voiceCloneRemoveUsage: '使い方：baocut library voice-clone-remove <voice id> --provider <id> [--local-only]',
  videoSelectionUsage: '使い方：baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label, id, name) => `${label} に読み込みました：${id}  ${name}`,
  exported: (id, version, file, bytes) => `${id} のバージョン ${version} を ${file} に書き出しました（${bytes} バイト）`,
  deleted: (id) => `${id} を削除しました`,
  remoteCloneOutcome: {
    deleted: 'リモートで削除済み',
    'not-found': 'リモートにはすでにこの声がありません',
    skipped: 'リモートには問い合わせていません',
  },
  voiceCloneRemoved: (id, provider, remote) => `${provider} 上の ${id} のクローンを削除しました（${remote}）`,
  libraryLabels: { glossaries: '用語集', voices: '声', brand: 'ブランドキット' },
  unknownLibrary: (text) => `そのライブラリはありません：${text ?? '（指定なし）'}。使えるのは glossaries、voices、brand です`,
  speakerVoiceFormat: (text) => `--speaker-voice の形式は <transcript id>:<speaker>=<voice>[@<Provider>] です。受け取った値：${text}`,
  listSep: '、',
  none: '（なし）',
  selectionHead: (videoId, documentId, revision) =>
    `動画 ${videoId}${documentId ? `（library-selection ドキュメント ${documentId} バージョン ${revision}）` : '（まだ何も有効にしていません）'}`,
  transcribeGlossaries: (list) => `文字起こし用の用語集：${list}`,
  translateGlossaries: (list) => `翻訳用の用語集：${list}`,
  speakerVoicesNone: '話者の声：（なし）',
  speakerVoice: (documentId, speakerId, voice, providerId) =>
    `話者の声：${documentId}:${speakerId} = ${voice}${providerId ? `（${providerId} でのみ）` : ''}`,
};
