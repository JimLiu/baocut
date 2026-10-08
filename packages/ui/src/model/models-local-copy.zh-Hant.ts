import type { ModelsLocalMessages } from './models-local-copy.ts';

export const zhHant: ModelsLocalMessages = {
  reason: {
    unsupported: '這台電腦不支援',
    resource: '已停用',
    'worker-missing': '缺少 Model Worker',
    'missing-manifest': '缺少清單',
    'missing-file': '缺少檔案',
    'size-mismatch': '檔案大小不符',
    'hash-mismatch': '總和檢查碼不符',
    incomplete: '缺少元件',
    'load-failed': '無法載入',
    relocating: '正在移動',
  },
  chipDefault: '預設',
  chipLoading: '正在載入',
  chipReady: '已載入',
  chipBusy: '執行中',
  chipUnloading: '正在卸載',
  chipUnavailable: '無法使用',
  capability: {
    transcribe: '轉錄',
    align: '對齊',
    synthesize: '合成',
    image: '影像生成',
    separate: '分離',
    diarize: '說話者區分',
  },
  auto: '自動',
  notInstalled: (name) => `${name}（未安裝）`,
  componentName: { aligner: '強制對齊器', speaker: '聲紋嵌入', vad: 'VAD（語音活動偵測）' },
  weights: '模型權重',
};
