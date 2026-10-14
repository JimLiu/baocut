import type { ModelsEmbeddingMessages } from './embedding.ts';

export const es: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: uso gratuito, también comercial; al redistribuirlo, conserva los avisos de copyright y de licencia',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM no tiene una compilación para este equipo (${p.platform}), así que la búsqueda semántica local aún no está disponible aquí`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} no está instalado`,
  countMismatch: (p: { expected: number; actual: number }) => `Se esperaban ${p.expected} vectores, pero se obtuvieron ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `Un vector tiene ${p.actual} dimensiones en lugar de ${p.expected}`,
  notFinite: 'Un vector contiene un valor que no es un número finito',
  notNormalized: (p: { norm: string }) => `Un vector no tiene longitud unitaria (norma ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `La frase relacionada no puntuó por encima de la no relacionada (coseno ${p.relevant} frente a ${p.irrelevant})`,
  noModel: 'No hay ningún modelo de embeddings local instalado',
  noVisionModel: 'Ningún modelo de embeddings local instalado puede leer imágenes. Instala EmbeddingGemma 2 740M para buscar por lo que se ve en pantalla',
  inputTooLong: (p: { index: number; max: number }) => `El texto ${p.index} es más largo de lo que acepta el modelo (${p.max} tokens)`,
  modelUnavailable: (p: { problem: string }) => `El modelo de embeddings local no está disponible: ${p.problem}`,
  cannotEmbed: 'Este Model Worker todavía no puede calcular embeddings con este modelo',
  embedReturned: (p: { code: string }) => `embed.run devolvió ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dimensiones · coseno ${p.relevant} frente a ${p.irrelevant} · ${p.device}`,
};
