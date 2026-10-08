import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const zhHans: ResourceCapacityMessages = {
  title: '资源调度',
  resetAll: '全部恢复自动',
  lead: '转写、本机模型和导出这些重任务按机器的容量排队：放得下才开始，放不下就等前面的做完。容量自动探测；这台电脑还要跑别的大程序、或探测得不准时，可以手动设一个上限，留空为自动。',
  disconnected: '没有连上 Runtime',
  loadFailed: '没能读取资源状况',
  loading: '正在读取资源状况…',
  limitOf: (label: string, unit: string) => `${label}上限（${unit}）`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: '线程' },
  notSettable: '不能手动设',
  inUseAndQueued: '正在用与排队',
  inUse: (demand: string) => `正在用 · ${demand}`,
  queued: (detail: string | null, demand: string) => `排队 · ${detail ?? '等待开始'} · 需要 ${demand}`,
  idle: '没有任务占用本机资源',
  saveFailed: (message: string) => `没能保存：${message}`,
};
