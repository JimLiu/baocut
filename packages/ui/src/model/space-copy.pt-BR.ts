import type { SpaceMessages } from './space-copy.ts';

export const ptBR: SpaceMessages = {
  kind: {
    video: "Vídeo",
    export: "Exportação",
    'video-file': "Mídia de vídeo",
    image: "Imagem",
    audio: "Áudio",
    subtitle: "Legendas",
    document: "Documento",
    package: "Pacote de vídeo",
    template: "Template",
  },
  categoryAll: "Todos",
  favorite: "Favoritos",
  trash: "Lixeira",
  sort: { created: 'Data de criação', updated: 'Data de atualização', recent: "Atividade recente", name: "Nome", kind: "Tipo" },
  status: {
    generating: "Gerando",
    candidate: "Candidato",
    applied: "Aplicado",
    published: "Publicado",
    'source-changed': "Fonte alterada",
    missing: "Ausente",
    failed: "Falhou",
  },
  statusAny: "Todos os status",
  statusNone: "Sem status",
  noProject: "Fora de um projeto",
  removedProject: "Projeto removido",
  conversation: (title: string) => `Sessão “${title}”`,
};
