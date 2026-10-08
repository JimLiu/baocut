import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const zhHans: JobsToolCatalogueMessages = {
  transcribeLabel: '转录',
  transcribeDescription:
    '把本机媒体文件或 Space 里的视频转写成文稿：给视频时写入一份新的文稿并建立字幕层；只给文件时把 TXT 与 SRT 写到保存位置，也可以新建视频。',
  translateSubtitlesLabel: '翻译字幕',
  translateSubtitlesDescription:
    '把视频里的文稿逐句翻译成另一种语言，作为新的译文写进视频；也可以把一个 SRT / VTT 字幕文件（本机文件或 Space 里的字幕条目）翻译成新的字幕文件。',
  dubLabel: '翻译配音',
  dubDescription: '按文稿（缺译文时先翻译）逐句合成目标语言的语音，对齐时间后作为新的一组配音写进视频。',
  synthesizeSpeechLabel: '生成语音',
  synthesizeSpeechDescription: '把一段文字合成语音，结果是音频产物；也可以读 Space 里的文档或字幕条目（字幕去掉时间码）。',
  generateTextLabel: '文本生成',
  generateTextDescription: '按提示生成一段文字（可以要求按 JSON Schema 输出），结果是文本产物；可以附上 Space 里的文档或字幕条目当素材。',
  generateImageLabel: '生成图片',
  generateImageDescription: '按描述生成图片，结果是图片产物。',
  linkImportLabel: '下载视频',
  linkImportDescription: '用 yt-dlp 下载视频到本机；可使用浏览器 Cookie，下载后可转录为文稿和字幕。',
  compressVideoLabel: '压缩视频',
  compressVideoDescription: '逐个压缩视频文件：文件到文件，不建视频，输出不覆盖已有的文件。',
  mergeVideoLabel: '合并视频',
  mergeVideoDescription: '把几个视频文件按顺序合并成一个：文件到文件，不建视频，输出不覆盖已有的文件。',
  extractAudioLabel: '提取音频',
  extractAudioDescription:
    '从视频或音频文件里取出音轨：编码放得进常见容器的直接复制，其余重新编码为 AAC；文件到文件，不建视频，输出不覆盖已有的文件。',
};
