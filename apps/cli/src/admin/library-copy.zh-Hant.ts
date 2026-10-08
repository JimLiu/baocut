import type { LibraryMessages } from './library-copy.ts';

export const zhHant: LibraryMessages = {
  help: `用法：
  baocut library import <file>     匯入交換檔案，依內容（而非副檔名）判斷類型：Markdown 術語表、.bcvoice 音色包、
                                   品牌庫的顏色與字幕樣式 JSON、Lottie 貼紙、圖片、影片、字型
  baocut library export <library> <id> <path>
                                   匯出目前版本：術語表為 Markdown，音色為 .bcvoice，品牌素材為原始檔案；
                                   目標已存在時不會覆寫
  baocut library remove <library> <id>
                                   刪除一個項目（已複製到影片中的內容不受影響）
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   將音色的參考錄音上傳給供應商以建立克隆音色（目前只支援 elevenlabs）：需要同意聲明，
                                   以及涵蓋「audio」的資料分享授權（baocut grants create）；以任務執行，Ctrl-C 取消
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   刪除克隆音色：先請供應商刪除，成功後再清除記錄；--local-only 只清除本機記錄
  baocut library video-selection <video id> [options]
                                   影片中啟用的資料庫項目（儲存在影片中，可還原）：未指定選項時顯示；
                                   指定的部分會整體取代，其餘維持不變。新影片會自動啟用資料庫中標記為「預設啟用」的術語表
    --transcribe-glossaries <id,…> 轉錄用術語表（轉錄未指定術語表時使用）；空字串會清空
    --translate-glossaries <id,…>  翻譯用術語表（translate 與 dub 的翻譯都會使用）；空字串會清空
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   說話者的音色（可重複，整體取代）：library:<id> 或供應商的音色 ID（此時加上 @Provider）
    --clear-speaker-voices         清空說話者的音色`,
  importUsage: '用法：baocut library import <file>',
  exportUsage: '用法：baocut library export <glossaries|voices|brand> <id> <path>',
  removeUsage: '用法：baocut library remove <glossaries|voices|brand> <id>',
  voiceCloneUsage: '用法：baocut library voice-clone <voice id> --provider <id> [--name <name>]',
  voiceCloneRemoveUsage: '用法：baocut library voice-clone-remove <voice id> --provider <id> [--local-only]',
  videoSelectionUsage: '用法：baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label, id, name) => `已匯入${label}：${id}  ${name}`,
  exported: (id, version, file, bytes) => `已將 ${id} 版本 ${version} 匯出到 ${file}（${bytes} 位元組）`,
  deleted: (id) => `已刪除 ${id}`,
  remoteCloneOutcome: { deleted: '遠端已刪除', 'not-found': '遠端已沒有這個音色', skipped: '未聯絡遠端' },
  voiceCloneRemoved: (id, provider, remote) => `已刪除 ${id} 在 ${provider} 上的克隆音色（${remote}）`,
  libraryLabels: { glossaries: '術語表', voices: '音色', brand: '品牌庫' },
  unknownLibrary: (text) => `沒有這個資料庫：${text ?? '（缺少）'}。可用的有 glossaries、voices、brand`,
  speakerVoiceFormat: (text) => `--speaker-voice 的格式為 <transcript id>:<speaker>=<voice>[@<Provider>]，收到的是 ${text}`,
  listSep: ', ',
  none: '（無）',
  selectionHead: (videoId, documentId, revision) =>
    `影片 ${videoId}${documentId ? `（library-selection 文件 ${documentId} 版本 ${revision}）` : '（尚未啟用任何項目）'}`,
  transcribeGlossaries: (list) => `轉錄用術語表：${list}`,
  translateGlossaries: (list) => `翻譯用術語表：${list}`,
  speakerVoicesNone: '說話者的音色：（無）',
  speakerVoice: (documentId, speakerId, voice, providerId) =>
    `說話者的音色：${documentId}:${speakerId} = ${voice}${providerId ? `（僅限 ${providerId}）` : ''}`,
};
