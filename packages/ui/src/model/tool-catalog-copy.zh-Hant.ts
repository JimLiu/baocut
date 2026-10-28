import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: '音訊', image: '圖片', doc: '文件', final: '影片檔', subtitle: '字幕' };

export const zhHant: ToolCatalogMessages = {
  inputLabels: {
    file: '本機檔案',
    space: 'Space',
    link: '連結',
    text: '文字',
    video: 'Space 中的影片',
    document: '文件',
  },
  outputLabels: { video: '影片', artifact: 'Space 中的項目' },
  artifactLabels,
  tools: {
    transcribe: { name: '轉錄', desc: '將影片或音訊檔轉成逐字稿和字幕；選擇可編輯的影片時會寫入其中，並新增字幕層' },
    'translate-subtitles': {
      name: '翻譯字幕',
      desc: '將字幕翻譯成另一種語言；選擇已轉錄的影片時，會新增譯文和可顯示雙語的字幕層，原文保持不變',
    },
    dub: { name: '翻譯配音', desc: '依譯文為已轉錄的影片加上新的配音；原始音訊可以壓低、靜音或保留' },
    'synthesize-speech': {
      name: '生成語音',
      desc: '朗讀文字，或 Space 中的文件與字幕；可使用內建音色、克隆一段錄音或描述一種音色',
    },
    'generate-text': {
      name: '生成文字',
      desc: '描述你的需求，直接呼叫文字模型生成文案、腳本或摘要；可以附上 Space 中的文件或字幕作為參考資料',
    },
    'generate-image': { name: '生成圖片', desc: '描述一個畫面，用雲端或本機影像模型畫出來；參考圖、長寬比和張數皆可選' },
    'upscale-image': { name: '放大圖片', desc: '用本機的 Real-ESRGAN、waifu2x 或 Upscayl 權重把圖片放大 2–4 倍，也可以讓圖像模型重畫一張大的' },
    'remove-object': { name: '去除物體', desc: '塗掉畫面裡不要的人或物，依周圍的畫面補上' },
    'remove-watermark': { name: '去浮水印', desc: '框出浮水印、角標或字幕條；同一位置可以一次處理多張圖' },
    'repaint-image': { name: '重繪局部', desc: '塗出一塊區域，寫一句改成什麼，只改這一塊' },
    'expand-image': { name: '擴展畫面', desc: '把畫面往外擴到新的比例，新增的部分接著原圖畫出來' },
    'generate-music': { name: '生成音樂', desc: '寫下風格與可選的歌詞，用本機音樂模型生成歌曲或純音樂；時長與種子可選' },
    'link-import': {
      name: '下載影片',
      desc: '貼上連結，將影片下載到這台電腦；可使用瀏覽器 Cookie，下載後可轉錄成逐字稿和字幕',
    },
    'compress-video': { name: '壓縮影片', desc: '依目標大小或畫質重新編碼；傳送或上傳前先縮小檔案' },
    'merge-video': { name: '合併影片', desc: '將多部影片依序首尾相接，合併成一個檔案' },
    'extract-audio': { name: '擷取音訊', desc: '去掉畫面，只保留音軌；常見的音訊編碼直接複製，不重新編碼' },
  },
  targetNone: '只建立逐字稿和字幕',
  targetCreate: '在專案中建立影片',
  subtitleFile: '本機字幕檔',
  groups: {
    speech: {
      label: '語音與字幕',
      desc: '轉錄、翻譯字幕、加上配音及朗讀文字。結果是文件、字幕與音訊項目；選擇 Space 中可編輯的影片時會寫入其中。',
    },
    'text-image': { label: '文字與圖片', desc: '直接呼叫文字模型與影像模型。結果是文件與圖片項目。' },
    music: { label: '音樂', desc: '用本機音樂模型生成歌曲與配樂。結果是音訊條目。' },
    'video-file': {
      label: '影片檔',
      desc: '使用這台電腦上的 yt-dlp 與 ffmpeg 下載、壓縮、合併影片及擷取音訊。結果是影片檔與音訊項目。',
    },
  },
  artifactItems: (artifacts) => `${artifacts.map((a) => artifactLabels[a]).join('與') || '產出'}項目`,
  resultWritesVideo: '結果：寫入你選擇的影片',
  resultInSpace: (items) => `結果：Space 中的${items}`,
  resultAlsoCreate: '也可以建立新影片',
  resultWritesEditable: '選擇可編輯的影片時會寫入其中',
  joinResult: (parts) => parts.join('；'),
};
