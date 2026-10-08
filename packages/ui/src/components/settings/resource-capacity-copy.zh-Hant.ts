import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const zhHant: ResourceCapacityMessages = {
  title: '資源調度',
  resetAll: '全部回復為自動',
  lead: '轉錄、本機模型與匯出這類重度任務會依這台電腦的容量排隊：容量足夠就開始，不夠就等前面的完成。容量會自動偵測；如果這台電腦還要執行其他大型程式，或偵測不準，可以手動設定上限，留空則為自動。',
  disconnected: '未連線到 Runtime',
  loadFailed: '無法讀取資源狀態',
  loading: '正在讀取資源狀態…',
  limitOf: (label: string, unit: string) => `${label}上限（${unit}）`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: '執行緒' },
  notSettable: '無法手動設定',
  inUseAndQueued: '使用中與排隊中',
  inUse: (demand: string) => `使用中 · ${demand}`,
  queued: (detail: string | null, demand: string) => `排隊中 · ${detail ?? '等待開始'} · 需要 ${demand}`,
  idle: '沒有任務佔用本機資源',
  saveFailed: (message: string) => `無法儲存：${message}`,
};
