import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const zhHant: JobsToolCatalogueMessages = {
  transcribeLabel: '轉錄',
  transcribeDescription:
    '把本機媒體檔案或 Space 中的影片轉錄成逐字稿：指定影片時會寫入一份新的逐字稿並建立字幕層；只指定檔案時會把 TXT 與 SRT 寫到儲存位置，也可以建立新影片。',
  translateSubtitlesLabel: '翻譯字幕',
  translateSubtitlesDescription:
    '把影片的逐字稿逐句翻譯成另一種語言，並以新的譯文寫入影片；也可以把 SRT / VTT 字幕檔案（本機檔案或 Space 中的字幕條目）翻譯成新的字幕檔案。',
  dubLabel: '翻譯配音',
  dubDescription: '依逐字稿（沒有譯文時先翻譯）逐句合成目標語言的語音，對齊時間後以新的一組配音寫入影片。',
  synthesizeSpeechLabel: '生成語音',
  synthesizeSpeechDescription: '把一段文字合成為語音，結果是音訊產出；也可以讀取 Space 中的文件或字幕條目（字幕會去掉時間碼）。',
  generateTextLabel: '生成文字',
  generateTextDescription: '依提示生成一段文字（可以要求依 JSON Schema 輸出），結果是文字產出；可以附上 Space 中的文件或字幕條目作為素材。',
  generateImageLabel: '生成圖片',
  generateImageDescription: '依描述生成圖片，結果是圖片產出。',
  linkImportLabel: '下載影片',
  linkImportDescription: '用 yt-dlp 把影片下載到這台電腦；可以使用瀏覽器 Cookie，下載後可轉錄為逐字稿與字幕。',
  compressVideoLabel: '壓縮影片',
  compressVideoDescription: '逐一壓縮影片檔案：檔案對檔案，不建立影片，輸出不會覆寫現有檔案。',
  mergeVideoLabel: '合併影片',
  mergeVideoDescription: '把多個影片檔案依序合併成一個：檔案對檔案，不建立影片，輸出不會覆寫現有檔案。',
  extractAudioLabel: '擷取音訊',
  extractAudioDescription:
    '從影片或音訊檔案中取出音軌：編碼可放進常見容器的直接複製，其餘重新編碼為 AAC；檔案對檔案，不建立影片，輸出不會覆寫現有檔案。',
};
