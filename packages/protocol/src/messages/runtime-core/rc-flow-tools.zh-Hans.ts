import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : '';
}

function originalLabel(original: string): string {
  switch (original) {
    case 'mute':
      return '静音';
    case 'keep':
      return '保持';
    default:
      return '压低';
  }
}

function transcodeAction(action: string): string {
  switch (action) {
    case 'merge':
      return '按顺序合并';
    case 'extract-audio':
      return '取出音轨';
    default:
      return '压缩';
  }
}

export const zhHans: RcFlowToolsMessages = {
  listSeparator: '、',

  transcribeVideoSummary: (p) => `转写${p.asset ? `素材 ${p.asset}` : '主轨上的素材'}${providerNote(p)}${p.captions ? '，并建立字幕层' : ''}`,
  transcribeFileSummary: (p) => `转写 ${p.file}${providerNote(p)}，写出 TXT 与 SRT 文稿${p.outDir ? `到 ${p.outDir}` : '到下载目录'}`,
  transcribeCreateSummary: (p) =>
    `新建视频${p.name ? `「${p.name}」` : ''}、导入 ${p.file} 并放上时间线，再转写${providerNote(p)}${p.captions ? '、建立字幕层' : ''}`,

  translateVideoSummary: (p) =>
    `用文本模型把转写译成 ${p.to}${providerNote(p)}${p.captions ? `，并建立${p.bilingual ? '双语' : ''}字幕层` : ''}`,
  translateFileSummary: (p) =>
    `用文本模型把字幕文件 ${p.input} 译成 ${p.to}${providerNote(p)}，写成新文件${p.outDir ? `到 ${p.outDir}` : '到下载目录'}`,

  dubSummary: (p) =>
    `翻译配音${p.to ? `（${p.to}）` : ''}：${p.translation ? `用译文 ${p.translation}` : '先用文本模型翻译'}，逐句合成${providerNote(p)}${p.voice ? `，音色 ${p.voice}` : ''}，放上新的配音轨，原声${originalLabel(p.original)}`,

  transcodeSummary: (p) =>
    `${transcodeAction(p.action)} ${p.count} 个文件（${p.files}${p.truncated ? '……' : ''}），输出${p.outDir ? `到 ${p.outDir}` : '到下载目录'}`,
  transcribeReplaceSummary: (p) =>
    `重新转录${p.asset ? `素材 ${p.asset}` : '主轨上的素材'}${providerNote(p)}，取代这部视频当前的文稿，并结转译文、字幕与配音（一笔可撤销的事务）`,
};
