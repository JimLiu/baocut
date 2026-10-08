import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const zhHant: ResourceCapacityMessages = {
  sources: {
    system: '系統偵測',
    setting: '手動設定',
    'unified-estimate': '依統一記憶體估算',
    unknown: '不明',
    statfs: '暫存檔所在磁碟的可用空間',
  },
  dimensions: { memory: '記憶體', gpuMemory: 'GPU 記憶體', cpuThreads: 'CPU 執行緒', scratchDisk: '暫存磁碟空間' },
  unknown: '不明',
  threads: (n) => `${n} 個執行緒`,
  unifiedMemory: '與記憶體共用，GPU 的用量也會計入記憶體',
  inUse: (amount) => `使用中 ${amount}`,
  backgroundAvailable: (amount) => `背景任務可用 ${amount}`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join('、'),
  noDemand: '不使用本機資源',
  auto: '自動',
  autoWith: (value) => `自動（${value}）`,
};
