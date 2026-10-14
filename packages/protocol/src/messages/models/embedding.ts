import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './embedding.zh-Hans.ts';
import { zhHant } from './embedding.zh-Hant.ts';
import { ja } from './embedding.ja.ts';
import { ko } from './embedding.ko.ts';
import { es } from './embedding.es.ts';
import { fr } from './embedding.fr.ts';
import { de } from './embedding.de.ts';
import { nl } from './embedding.nl.ts';
import { ptBR } from './embedding.pt-BR.ts';
import { it } from './embedding.it.ts';
import { ru } from './embedding.ru.ts';
import { pl } from './embedding.pl.ts';
import { tr } from './embedding.tr.ts';
import { vi } from './embedding.vi.ts';

/**
 * `packages/models` 本机 embedding（EmbeddingGemma 2 / LiteRT-LM）给人看的文字：许可摘要、C 库没有这个平台的版本、自检没通过的原因、
 * Provider 的错误。模型名、库名、许可证名不翻译。
 */
const en = {
  apacheLicense: 'Apache-2.0: free to use, including commercially; keep the copyright and license notices when redistributing',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM has no build for this machine (${p.platform}), so local semantic search is not available here yet`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} is not installed`,
  countMismatch: (p: { expected: number; actual: number }) => `Expected ${p.expected} vectors but got ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `A vector has ${p.actual} dimensions instead of ${p.expected}`,
  notFinite: 'A vector contains a value that is not a finite number',
  notNormalized: (p: { norm: string }) => `A vector is not unit length (norm ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `The related sentence did not score above the unrelated one (cosine ${p.relevant} vs ${p.irrelevant})`,
  noModel: 'No local embedding model is installed',
  noVisionModel: 'No installed local embedding model can read images. Install EmbeddingGemma 2 740M to search by what is on screen',
  inputTooLong: (p: { index: number; max: number }) => `Text ${p.index} is longer than the model accepts (${p.max} tokens)`,
  modelUnavailable: (p: { problem: string }) => `The local embedding model is not available: ${p.problem}`,
  cannotEmbed: "This Model Worker can't compute embeddings with this model yet",
  embedReturned: (p: { code: string }) => `embed.run returned ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dims · cosine ${p.relevant} vs ${p.irrelevant} · ${p.device}`,
};

export type ModelsEmbeddingMessages = typeof en;

export const ModelsEmbedding = defineCatalog('modelsEmbedding', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
