import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const ko: TranscribeSpeakersMessages = {
  packFallback: '화자 구분',
  builtinNote: (model: string) => `${model} 모델이 전사하는 동안 직접 화자를 구분합니다`,
  builtinSummary: '화자 식별 · 모델에 내장',
  noneNote: (model: string) => `${model} 모델은 화자를 구분하지 않습니다. 필요하면 로컬 모델이나 화자 구분이 내장된 서비스로 바꾸세요`,
  missingNote: (pack: string, size: string | null) => `화자를 구분하려면 먼저 “${pack}”${size ? `(${size})` : ''} 모델을 다운로드하세요`,
  missingSummary: '화자 식별 · 먼저 모델 다운로드 필요',
  onNote: '전사 후 “화자 구분”이 문장마다 화자를 표시하며, 자막과 전사본에 이름이 포함됩니다',
  summaryOn: '화자 식별',
  offNote: '화자를 구분하지 않습니다. 자막과 전사본에 이름이 포함되지 않습니다',
  summaryOff: '화자 식별 안 함',
  downloading: (pack: string, pct: number | null) => `“${pack}” 다운로드 중${pct === null ? '…' : ` · ${pct}%`}`,
};
