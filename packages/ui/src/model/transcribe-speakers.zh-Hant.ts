import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const zhHant: TranscribeSpeakersMessages = {
  packFallback: '說話者區分',
  builtinNote: (model: string) => `${model} 本身就能區分說話者，轉錄時一併完成`,
  builtinSummary: '辨識說話者 · 模型內建',
  noneNote: (model: string) => `${model} 無法區分說話者。如有需要，請換用本機模型，或內建此功能的服務`,
  missingNote: (pack: string, size: string | null) => `請先下載「${pack}」${size ? `（${size}）` : ''}，才能區分說話者`,
  missingSummary: '辨識說話者 · 需先下載模型',
  onNote: '轉錄後，「說話者區分」會為每一句標上說話者，字幕與逐字稿都會帶有名字',
  summaryOn: '辨識說話者',
  offNote: '不區分說話者，字幕與逐字稿不會標上名字',
  summaryOff: '不辨識說話者',
  downloading: (pack: string, pct: number | null) => `正在下載「${pack}」${pct === null ? '…' : ` · ${pct}%`}`,
};
