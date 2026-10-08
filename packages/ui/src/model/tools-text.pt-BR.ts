import type { ToolsTextMessages } from './tools-text.ts';

export const ptBR: ToolsTextMessages = {
  emptyInput: "Insira primeiro o que gerar",
  tooLong: (max) => `Até ${max} caracteres por vez`,
  sample: "Escreva uma dublagem de 30 segundos para um vídeo de passeio pela cidade. Use um tom natural e destaque as ruas, os cafés e o entardecer.",
  counter: (n, max) => `${n} / ${max} caracteres`,
  connectTextModel: "Conecte primeiro um modelo de texto",
  connectFirst: (provider) => `Conecte primeiro ${provider}`,
  effortFixed: "Esforço de raciocínio · não ajustável neste modelo",
  effort: (label) => `Esforço de raciocínio · ${label} (padrão definido na página Modelos)`,
  auto: "Automático",
  headerChip: (provider) => `Online · ${provider} · cobrado por token`,
  fileStem: "Texto gerado",
  chars: (n) => `${n} caracteres`,
  outputTokens: (n) => `Tokens de saída: ${n}`,
  truncated: "O limite de saída foi atingido; o restante foi cortado",
};
