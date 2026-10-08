import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const zhHans: ResourceCapacityMessages = {
  sources: {
    system: '系统探测',
    setting: '手动设定',
    'unified-estimate': '按统一内存估计',
    unknown: '未知',
    statfs: '临时文件所在磁盘的可用空间',
  },
  dimensions: { memory: '内存', gpuMemory: 'GPU 内存', cpuThreads: 'CPU 线程', scratchDisk: '临时磁盘空间' },
  unknown: '未知',
  threads: (n) => `${n} 线程`,
  unifiedMemory: '与内存共用，GPU 的用量同时计入内存',
  inUse: (amount) => `正在用 ${amount}`,
  backgroundAvailable: (amount) => `后台任务还能用 ${amount}`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join('、'),
  noDemand: '不占本机资源',
  auto: '自动',
  autoWith: (value) => `自动（${value}）`,
};
