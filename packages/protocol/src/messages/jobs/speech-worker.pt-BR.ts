import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const ptBR: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `O protocolo do Speech Worker não é ${p.protocol}`,
  exited: "O Speech Worker saiu inesperadamente",
  translationLanguage: "language da tradução não corresponde ao idioma de destino",
  outputInvalid: "O resultado do Speech Worker não corresponde ao contrato",
  outputTruncated: "A saída do modelo atingiu o limite e foi cortada",
  resultMissing: (p: { field: string }) => `O resultado do Speech Worker não tem ${p.field}`,
  unreadableFile: (p: { name: string }) => `Não é possível ler o arquivo escrito pelo Speech Worker: ${p.name}`,
  cuesNotObject: "As legendas não são um objeto",
  cuesSchema: (p: { schema: string }) => `schema das legendas deve ser ${p.schema}`,
  cuesLanguage: "language das legendas não corresponde ao idioma de destino",
  cuesTimescale: "timescale das legendas deve corresponder ao da transcrição de origem",
  cuesMissing: "cues está ausente",
  cueNotObject: (p: { n: number }) => `Legenda ${p.n} não é um objeto`,
  cueNoText: (p: { n: number }) => `Legenda ${p.n} não tem texto`,
  cueNoSentence: (p: { n: number }) => `Legenda ${p.n} não tem sua frase ou unidade`,
  cueFallback: (p: { n: number }) => `Legenda ${p.n} tem fallback que não é booleano`,
  cueTicks: (p: { n: number }) => `Legenda ${p.n} tem tempos que não são ticks inteiros`,
  cueRange: (p: { n: number }) => `Legenda ${p.n} tem intervalo de tempo inválido`,
  cueOverlap: (p: { n: number }) => `Legenda ${p.n} se sobrepõe à anterior ou está fora de ordem`,
  cueBeyond: (p: { n: number }) => `Legenda ${p.n} ultrapassa a duração da mídia`,
};
