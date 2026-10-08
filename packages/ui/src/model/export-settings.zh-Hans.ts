import type { ExportSettingsMessages } from './export-settings.ts';

export const zhHans: ExportSettingsMessages = {
  quality: { small: '省空间', standard: '标准', high: '高画质' },
  qualityNote: {
    small: '压得更狠，画面细节略少，文件更小',
    standard: '默认的画质与体积',
    high: '细节更多，文件更大',
  },
  loudnessOn: (lufs: string, truePeak: string) => `整片混音统一到 ${lufs} LUFS，真峰值不超过 ${truePeak} dBTP。`,
  loudnessOff: '关：按视频里的混音原样导出。',
  audioFormatNote: {
    wav: '无损 · 体积最大 · 拿去后期再加工用这个',
    mp3: '通用 · 播客平台、车机和老设备都认',
    m4a: 'AAC · 同码率比 MP3 清楚一点 · Apple 生态原生',
  },
  dubGroup: (language: string | null) => `${language ?? '这一组'}配音`,
  mix: '成片混音',
  mixNote: '跟时间轴上现在听到的一样',
  originalOnly: '只要原声',
  originalOnlyNote: '去掉全部配音，被配音静音掉的原声恢复',
  dubOnly: (label: string) => `只要${label}`,
  dubOnlyNote: '只留这一组配音，原声、音乐和别的配音都不要',
  mono: '单声道',
  stereo: '立体声',
  subtitleFormatNote: {
    srt: '通用，几乎所有播放器和平台都认',
    vtt: '网页播放器用，带位置提示',
    ass: '带字幕样式（字体、描边、位置），播放器支持较少',
    json: '每条带逐词时间戳，给脚本和工具用',
  },
  transcription: '转写',
  plainText: '纯文本',
  transcriptFormatNote: {
    md: '可带文首元信息，章节成小标题、说话人加粗、译文成引用 · 贴进笔记或文档',
    txt: '不带标记语法 · 章节标题单独一行',
  },
};
