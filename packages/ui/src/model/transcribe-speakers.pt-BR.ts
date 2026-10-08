import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const ptBR: TranscribeSpeakersMessages = {
  packFallback: 'Diarização de falantes',
  builtinNote: (model: string) => `${model} distingue os falantes por conta própria durante a transcrição`,
  builtinSummary: 'Identificar falantes · integrado ao modelo',
  noneNote: (model: string) => `${model} não distingue os falantes. Se precisar, mude para um modelo local ou um serviço com esse recurso integrado`,
  missingNote: (pack: string, size: string | null) => `Baixe “${pack}”${size ? ` (${size})` : ''} primeiro para distinguir os falantes`,
  missingSummary: 'Identificar falantes · baixar o modelo primeiro',
  onNote: 'Após a transcrição, “Diarização de falantes” identifica o falante de cada frase, e as legendas e transcrições incluem os nomes',
  summaryOn: 'Identificar falantes',
  offNote: 'Os falantes não são diferenciados; as legendas e transcrições não incluem nomes',
  summaryOff: 'Não identificar falantes',
  downloading: (pack: string, pct: number | null) => `Baixando “${pack}”${pct === null ? '…' : ` · ${pct}%`}`,
};
