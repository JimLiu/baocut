import type { FontsMessages } from './fonts-copy.ts';

export const ja: FontsMessages = {
  help: `使い方：
  baocut fonts [downloaded]        ダウンロード済みのフォント（Google Fonts、必要に応じてダウンロード）：
                                   ファミリー、ウェイト、サイズ、ライセンス、合計サイズ
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   フォント選択リスト：アプリ内蔵、このコンピュータ上、フォントカタログ内のファミリーを
                                   状態（内蔵、このコンピュータ、ダウンロード済み、ダウンロード可能、ダウンロード中、失敗）
                                   付きで表示。カテゴリ：sans-serif、serif、display、handwriting、monospace。
                                   文字体系：chinese、japanese、korean、latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   ファミリーをダウンロード（既定はレギュラーとボールド）。進行状況は stderr に出力し、
                                   Ctrl-C でキャンセル。送信するのはファミリー名とウェイトだけです。ミラーは設定
                                   fonts.cssEndpoint と fonts.fileEndpoint を参照。厳格なオフラインモードでは拒否します
  baocut fonts remove <family>     このファミリーのダウンロード済みフォントを削除（未完了の書き出しで使用中なら拒否）
  baocut fonts clear               ダウンロード済みフォントを消去（未完了の書き出しで使用中のものは残します）`,
  alreadyDownloaded: (family) => `「${family}」はすでにダウンロード済みです`,
  downloadDone: 'ダウンロード完了',
  remedy: (text) => `対処：${text}`,
  usage:
    '使い方：baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear',
  listSep: '、',
  categoryChoices: (choices: readonly string[]) => `--category には ${choices.join('、')} のいずれかを指定してください`,
  scriptChoices: (choices: readonly string[]) => `--script には ${choices.join('、')} のいずれかを指定してください`,
  limitRange: '--limit には 1 から 500 までの整数を指定してください',
  italicNeedsWeights: '--italic は --weights と一緒に指定してください',
  weightsFormat: '--weights には 1 から 1000 までのウェイトをカンマ区切りで指定してください',
  stateLabels: {
    'built-in': '内蔵',
    installed: 'このコンピュータ',
    downloaded: 'ダウンロード済み',
    downloadable: 'ダウンロード可能',
    downloading: 'ダウンロード中',
    failed: '失敗',
    unavailable: '利用不可',
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' イタリック' : ''}`,
  noDownloads: 'ダウンロード済みのフォントはまだありません',
  downloadedTotal: (families: number, faces: number, size: string) => `${families} ファミリー、${faces} ウェイト、合計 ${size}`,
  noMatches: '一致するフォントはありません',
  failedWithReason: (state: string, message: string) => `${state}（${message}）`,
  truncated: (total: number, shown: number) => `（全 ${total} 件中、先頭の ${shown} 件を表示）`,
  removed: (count: number, freed: string) => `${count} ウェイトを削除し、${freed} を解放しました`,
  nothingToRemove: '削除できるフォントはありません',
  kept: (count: number, faces: readonly string[]) => `${count} 件を残しました（未完了の書き出しで使用中）：${faces.join('、')}`,
};
