import type { RuntimeMessages } from './runtime-copy.ts';

export const zhHant: RuntimeMessages = {
  missingContext: '缺少 RuntimeContext',
  mediaStatus: (status) => `媒體服務傳回 ${status}`,
  noRootSequence: '新影片沒有主序列',
  edit: {
    importAssets: '匯入素材',
    setBackground: '設定背景',
    addWaveform: '新增波形',
  },
  waveformName: '波形',
  noDuration: '影片還沒有長度，因此未加入波形',
  noOpenVideo: '沒有開啟的影片',
  notCaughtUp: '影片尚未同步到最新狀態，目前無法修改',
};
