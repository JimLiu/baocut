import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const ptBR: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `O arquivo de legendas tem ${p.bytes} B, acima do limite de ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Mais de ${p.limit} legendas`,
  invalidAt: (p: { line: number; problem: string }) => `Linha do arquivo de legendas ${p.line}: ${p.problem}`,
  nul: "O arquivo contém caracteres NUL e não parece ser legendas em texto",
  vttHeader: "Um arquivo WebVTT deve começar com WEBVTT",
  vttHeaderBlank: "Deixe uma linha em branco após o cabeçalho WEBVTT antes das legendas",
  empty: "O arquivo não tem legendas",
  noTiming: "Este bloco tem texto, mas não tem linha de tempo",
  tooManyIdLines: "Só pode haver uma linha de número ou identificador antes da linha de tempo",
  srtIndex: (p: { id: string }) => `A linha de índice SRT deve ser um número: ${p.id}`,
  badTiming: (p: { timing: string }) => `Linha de tempo inválida: ${p.timing}`,
  endBeforeStart: "O fim ocorre antes do início",
  timingInText: "Uma linha de tempo aparece no texto da legenda (pode faltar uma linha em branco entre duas legendas)",
  cueTooLong: (p: { max: number }) => `O texto de uma legenda tem mais de ${p.max} caracteres`,
  minuteSecondRange: "Minutos ou segundos excedem 59",
};
