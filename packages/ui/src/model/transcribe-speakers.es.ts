import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';
export const es: TranscribeSpeakersMessages = {
  packFallback: 'Diarización de hablantes',
  builtinNote: (model: string) => `${model} distingue a los hablantes por sí solo durante la transcripción`,
  builtinSummary: 'Identificar hablantes · integrado en el modelo',
  noneNote: (model: string) => `${model} no distingue a los hablantes. Si lo necesitas, cambia a un modelo local o a un servicio que lo tenga integrado`,
  missingNote: (pack: string, size: string | null) => `Primero descarga «${pack}»${size ? ` (${size})` : ''} para distinguir a los hablantes`,
  missingSummary: 'Identificar hablantes · primero descarga el modelo',
  onNote: 'Después de transcribir, «Diarización de hablantes» etiqueta cada frase con su hablante, y los subtítulos y las transcripciones incluyen los nombres',
  summaryOn: 'Identificar hablantes',
  offNote: 'No se distinguen los hablantes; los subtítulos y las transcripciones no incluirán nombres',
  summaryOff: 'No identificar hablantes',
  downloading: (pack: string, pct: number | null) => `Descargando «${pack}»${pct === null ? '…' : ` · ${pct}%`}`,
};
