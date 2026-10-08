import type { FontsMessages } from './fonts-copy.ts';

export const zhHant: FontsMessages = {
  help: `用法：
  baocut fonts [downloaded]        已下載的字型（Google Fonts，依需要下載）：
                                   字型家族、字重、大小、授權條款，以及總大小
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   字型選擇器清單：應用程式內附、這台電腦上與字型目錄中的字型家族，以及它們的狀態
                                   （內建、本機、已下載、可下載、下載中、失敗）。分類：sans-serif、serif、
                                   display、handwriting、monospace；文字系統：chinese、japanese、korean、latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   下載一個字型家族（預設為常規與粗體）；進度輸出到 stderr，Ctrl-C 取消。
                                   只會傳送字型家族名稱與字重；鏡像站請見 fonts.cssEndpoint 與
                                   fonts.fileEndpoint 設定；嚴格離線模式下會拒絕
  baocut fonts remove <family>     刪除這個字型家族已下載的字型（有未完成的匯出正在使用時會拒絕）
  baocut fonts clear               清除已下載的字型（未完成的匯出正在使用的會保留）`,
  alreadyDownloaded: (family) => `「${family}」已下載`,
  downloadDone: '下載完成',
  remedy: (text) => `解決方式：${text}`,
  usage:
    '用法：baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear',
  listSep: '、',
  categoryChoices: (choices: readonly string[]) => `--category 必須是 ${choices.join('、')} 其中之一`,
  scriptChoices: (choices: readonly string[]) => `--script 必須是 ${choices.join('、')} 其中之一`,
  limitRange: '--limit 必須是 1 至 500 的整數',
  italicNeedsWeights: '--italic 必須與 --weights 一起使用',
  weightsFormat: '--weights 必須是以逗號分隔、1 至 1000 的字重',
  stateLabels: {
    'built-in': '內建',
    installed: '本機',
    downloaded: '已下載',
    downloadable: '可下載',
    downloading: '下載中',
    failed: '失敗',
    unavailable: '無法使用',
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' 斜體' : ''}`,
  noDownloads: '尚未下載任何字型',
  downloadedTotal: (families: number, faces: number, size: string) => `${families} 個字型家族、${faces} 個字重，共 ${size}`,
  noMatches: '沒有符合的字型',
  failedWithReason: (state: string, message: string) => `${state}（${message}）`,
  truncated: (total: number, shown: number) => `（共 ${total} 個，只顯示前 ${shown} 個）`,
  removed: (count: number, freed: string) => `已刪除 ${count} 個字重，釋出 ${freed}`,
  nothingToRemove: '沒有可刪除的字型',
  kept: (count: number, faces: readonly string[]) => `保留 ${count} 個（未完成的匯出正在使用）：${faces.join('、')}`,
};
