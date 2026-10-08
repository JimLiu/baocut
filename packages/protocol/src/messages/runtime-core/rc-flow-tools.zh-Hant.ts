import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : '';
}

function originalLabel(original: string): string {
  switch (original) {
    case 'mute':
      return '將原聲靜音';
    case 'keep':
      return '保留原聲';
    default:
      return '調低原聲';
  }
}

function transcodeAction(action: string, count: number): string {
  switch (action) {
    case 'merge':
      return `依序合併 ${count} 個檔案`;
    case 'extract-audio':
      return `擷取 ${count} 個檔案的音訊`;
    default:
      return `壓縮 ${count} 個檔案`;
  }
}

export const zhHant: RcFlowToolsMessages = {
  listSeparator: '、',

  transcribeVideoSummary: (p) =>
    `轉錄${p.asset ? `素材 ${p.asset}` : '主軌上的素材'}${providerNote(p)}${p.captions ? '，並新增字幕層' : ''}`,
  transcribeFileSummary: (p) =>
    `轉錄 ${p.file}${providerNote(p)}，並將 TXT 和 SRT 逐字稿寫入${p.outDir ? ` ${p.outDir}` : '下載資料夾'}`,
  transcribeCreateSummary: (p) =>
    `建立影片${p.name ? `「${p.name}」` : ''}，匯入 ${p.file} 並加入時間軸，然後轉錄${providerNote(p)}${p.captions ? '，並新增字幕層' : ''}`,

  translateVideoSummary: (p) =>
    `用文字模型將逐字稿翻譯成 ${p.to}${providerNote(p)}${p.captions ? `，並新增${p.bilingual ? '雙語' : ''}字幕層` : ''}`,
  translateFileSummary: (p) =>
    `用文字模型將字幕檔 ${p.input} 翻譯成 ${p.to}${providerNote(p)}，並將新檔案寫入${p.outDir ? ` ${p.outDir}` : '下載資料夾'}`,

  dubSummary: (p) =>
    `翻譯配音${p.to ? `（${p.to}）` : ''}：${p.translation ? `使用譯文 ${p.translation}` : '先用文字模型翻譯'}，逐句合成${providerNote(p)}${p.voice ? `，音色 ${p.voice}` : ''}，新增一條配音軌，並${originalLabel(p.original)}`,

  transcodeSummary: (p) =>
    `${transcodeAction(p.action, p.count)}（${p.files}${p.truncated ? '…' : ''}），並儲存到${p.outDir ? ` ${p.outDir}` : '下載資料夾'}`,
  transcribeReplaceSummary: (p) =>
    `重新轉錄${p.asset ? `素材 ${p.asset}` : '主軌道上的素材'}${providerNote(p)}，取代這部影片目前的逐字稿，並沿用譯文、字幕與配音（一筆可復原的操作）`,
};
