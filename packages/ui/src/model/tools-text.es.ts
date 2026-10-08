import type { ToolsTextMessages } from './tools-text.ts';
export const es: ToolsTextMessages = {
  emptyInput: 'Primero indica qué quieres generar', tooLong: (max: string) => `Hasta ${max} caracteres a la vez`,
  sample: 'Escribe un doblaje de 30 segundos para un vídeo de un paseo por la ciudad. Mantén un tono natural y destaca las calles, los cafés y el atardecer.',
  counter: (n: string, max: string) => `${n} / ${max} caracteres`,
  connectTextModel: 'Primero conecta un modelo de texto',
  connectFirst: (provider: string) => `Primero conecta ${provider}`,
  effortFixed: 'Esfuerzo de razonamiento · no se puede ajustar en este modelo',
  effort: (label: string) => `Esfuerzo de razonamiento · ${label} (valor predeterminado en la página Modelos)`,
  auto: 'Automático', headerChip: (provider: string) => `En línea · ${provider} · facturado por token`,
  fileStem: 'Texto generado', chars: (n: string) => `${n} caracteres`,
  outputTokens: (n: string) => `${n} tokens de salida`,
  truncated: 'Se alcanzó el límite de salida; el resto se recortó',
};
