import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ja: ResourceCapacityMessages = {
  title: 'リソースのスケジューリング',
  resetAll: 'すべて自動に戻す',
  lead: '文字起こし、ローカルモデル、書き出しなどの重いタスクは、このコンピュータの容量に応じて順番を待ちます。収まれば開始し、収まらなければ先のタスクが終わるのを待ちます。容量は自動で検出されます。このコンピュータでほかの大きなプログラムも動かしている場合や、検出が正確でない場合は、上限を手動で設定できます。空欄にすると自動になります。',
  disconnected: 'Runtime に接続されていません',
  loadFailed: 'リソースの状況を読み込めませんでした',
  loading: 'リソースの状況を読み込み中…',
  limitOf: (label: string, unit: string) => `${label} の上限（${unit}）`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: 'スレッド' },
  notSettable: '手動では設定できません',
  inUseAndQueued: '使用中と待機中',
  inUse: (demand: string) => `使用中 · ${demand}`,
  queued: (detail: string | null, demand: string) => `待機中 · ${detail ?? '開始待ち'} · 必要量 ${demand}`,
  idle: 'ローカルリソースを使用中のタスクはありません',
  saveFailed: (message: string) => `保存できませんでした：${message}`,
};
