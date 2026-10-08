import type { JobsVideoTargetMessages } from './video-target.ts';

export const ptBR: JobsVideoTargetMessages = {
  stepLabel: "Resolver destino",
  notSameVideo: "refere-se a um vídeo diferente de videoId",
  targetShapeOneOf: "deve ser um de { videoId }, { entryId } ou { create }",
  createUnsupported: "Este fluxo não pode criar um vídeo: forneça um vídeo existente (videoId ou entryId)",
  createShape: "deve ser { projectId, name? } ou { conversationId, name? }",
  mediaNotAllowed: "não pode ser fornecida: a mídia é o resultado deste fluxo",
  unknownField: (p: { key: string }) => `tem um campo desconhecido ${p.key}`,
  scopeOnlyOne: "aceita apenas um entre projectId e conversationId",
  scopeRequired: "precisa de projectId ou conversationId",
  nameLength: "deve ter de 1 a 200 caracteres",
  mediaPath: "deve ser um caminho absoluto para um arquivo de mídia local",
};
