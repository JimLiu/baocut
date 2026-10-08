import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const zhHans: TranscribeSpeakersMessages = {
  packFallback: '说话人区分',
  builtinNote: (model: string) => `${model} 自带说话人区分，转录时一起完成`,
  builtinSummary: '识别说话人 · 模型自带',
  noneNote: (model: string) => `${model} 不区分说话人；需要时换一只本机模型，或自带区分的服务`,
  missingNote: (pack: string, size: string | null) => `要先下载「${pack}」${size ? `（${size}）` : ''}，下完才能区分说话人`,
  missingSummary: '识别说话人 · 要先下载模型',
  onNote: '转写之后用「说话人区分」给每句标上说话人，字幕与文稿都会带名字',
  summaryOn: '识别说话人',
  offNote: '不区分说话人，字幕与文稿不标名字',
  summaryOff: '不识别说话人',
  downloading: (pack: string, pct: number | null) => `正在下载「${pack}」${pct === null ? '…' : `· ${pct}%`}`,
};
