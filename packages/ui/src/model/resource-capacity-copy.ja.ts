import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ja: ResourceCapacityMessages = {
  sources: {
    system: 'システムで検出',
    setting: '手動で設定',
    'unified-estimate': 'ユニファイドメモリから推定',
    unknown: '不明',
    statfs: '一時ファイルのあるディスクの空き容量',
  },
  dimensions: { memory: 'メモリ', gpuMemory: 'GPU メモリ', cpuThreads: 'CPU スレッド', scratchDisk: '一時ディスク容量' },
  unknown: '不明',
  threads: (n) => `${n} スレッド`,
  unifiedMemory: 'メモリと共有。GPU の使用量もメモリに計上されます',
  inUse: (amount) => `${amount} 使用中`,
  backgroundAvailable: (amount) => `バックグラウンドタスクで ${amount} 使用可能`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join('、'),
  noDemand: 'ローカルのリソースを使用しません',
  auto: '自動',
  autoWith: (value) => `自動（${value}）`,
};
