import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const ja: TranscribeSpeakersMessages = {
  packFallback: '話者分離',
  builtinNote: (model: string) => `${model} は文字起こし中に自身で話者を区別します`,
  builtinSummary: '話者を識別 · モデルに内蔵',
  noneNote: (model: string) => `${model} は話者を区別しません。必要な場合は、ローカルモデルか、話者の区別を内蔵したサービスに切り替えてください`,
  missingNote: (pack: string, size: string | null) => `話者を区別するには、先に「${pack}」${size ? `（${size}）` : ''}をダウンロードしてください`,
  missingSummary: '話者を識別 · 先にモデルをダウンロード',
  onNote: '文字起こしの後、「話者分離」が各文に話者を付け、字幕と文字起こしに名前が入ります',
  summaryOn: '話者を識別',
  offNote: '話者を区別しません。字幕と文字起こしに名前は入りません',
  summaryOff: '話者を識別しない',
  downloading: (pack: string, pct: number | null) => `「${pack}」をダウンロード中${pct === null ? '…' : ` · ${pct}%`}`,
};
