import type { ModelsEmbeddingMessages } from './embedding.ts';

export const ptBR: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: uso gratuito, inclusive comercial; ao redistribuir, mantenha os avisos de direitos autorais e de licença',
  runtimeNoBuild: (p: { platform: string }) => `O LiteRT-LM não tem uma compilação para esta máquina (${p.platform}), então a busca semântica local ainda não está disponível aqui`,
  runtimeNotInstalled: (p: { version: string }) => `O LiteRT-LM ${p.version} não está instalado`,
  countMismatch: (p: { expected: number; actual: number }) => `Eram esperados ${p.expected} vetores, mas vieram ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `Um vetor tem ${p.actual} dimensões em vez de ${p.expected}`,
  notFinite: 'Um vetor contém um valor que não é um número finito',
  notNormalized: (p: { norm: string }) => `Um vetor não tem comprimento unitário (norma ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `A frase relacionada não pontuou acima da não relacionada (cosseno ${p.relevant} contra ${p.irrelevant})`,
  noModel: 'Nenhum modelo de embeddings local está instalado',
  noVisionModel: 'Nenhum modelo de embeddings local instalado consegue ler imagens. Instale o EmbeddingGemma 2 740M para buscar pelo que aparece na tela',
  inputTooLong: (p: { index: number; max: number }) => `O texto ${p.index} é mais longo do que o modelo aceita (${p.max} tokens)`,
  modelUnavailable: (p: { problem: string }) => `O modelo de embeddings local não está disponível: ${p.problem}`,
  cannotEmbed: 'Este Model Worker ainda não consegue calcular embeddings com este modelo',
  embedReturned: (p: { code: string }) => `embed.run retornou ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dimensões · cosseno ${p.relevant} contra ${p.irrelevant} · ${p.device}`,
};
