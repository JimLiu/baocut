import type { ModelsEmbeddingMessages } from './embedding.ts';

export const fr: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0 : utilisation libre, y compris commerciale ; conservez les mentions de copyright et de licence en cas de redistribution',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM n’a pas de build pour cette machine (${p.platform}) : la recherche sémantique locale n’y est pas encore disponible`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} n’est pas installé`,
  countMismatch: (p: { expected: number; actual: number }) => `${p.expected} vecteurs attendus, ${p.actual} obtenus`,
  wrongDims: (p: { expected: number; actual: number }) => `Un vecteur a ${p.actual} dimensions au lieu de ${p.expected}`,
  notFinite: 'Un vecteur contient une valeur qui n’est pas un nombre fini',
  notNormalized: (p: { norm: string }) => `Un vecteur n’est pas de norme unitaire (norme ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `La phrase liée n’a pas obtenu un meilleur score que la phrase sans rapport (cosinus ${p.relevant} contre ${p.irrelevant})`,
  noModel: 'Aucun modèle d’embeddings local n’est installé',
  noVisionModel: 'Aucun modèle d’embeddings local installé ne sait lire les images. Installez EmbeddingGemma 2 740M pour chercher d’après ce qui est à l’écran',
  inputTooLong: (p: { index: number; max: number }) => `Le texte ${p.index} dépasse la longueur acceptée par le modèle (${p.max} jetons)`,
  modelUnavailable: (p: { problem: string }) => `Le modèle d’embeddings local n’est pas disponible : ${p.problem}`,
  cannotEmbed: "Ce Model Worker ne sait pas encore calculer d’embeddings avec ce modèle",
  embedReturned: (p: { code: string }) => `embed.run a renvoyé ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dimensions · cosinus ${p.relevant} contre ${p.irrelevant} · ${p.device}`,
};
