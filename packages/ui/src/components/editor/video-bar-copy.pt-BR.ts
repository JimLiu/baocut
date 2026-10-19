import type { VideoBarMessages } from './video-bar-copy.ts';

export const ptBR: VideoBarMessages = {
  closeToSpace: "Fechar vídeo · voltar ao Space",
  closeToHome: "Fechar vídeo · voltar ao Home",
  untitled: "Vídeo",
  rename: "Renomear vídeo",
  details: "Detalhes do vídeo",
  actions: "Ações do vídeo",
  showInSpace: "Mostrar no Space",
  revealVideoFolder: "Mostrar pasta do vídeo",
  close: "Fechar vídeo",
  nameLabel: "Nome",
  save: "Salvar",
  openFailed: "Não é possível abrir",
  stale: "Não atualizado · não é possível editar agora",
  openingAria: "Abrindo",
  opening: "Abrindo…",
  savingAria: "Salvando",
  saving: "Salvando…",
  agentChanged: (label: string) => `O agente alterou o vídeo: ${label}`,
  savedByAgent: (label: string) => `Salvo · Agente: ${label}`,
  saved: "Salvo",
};
