import type { QuickChatMessages } from './quick-chat-copy.ts';

export const ptBR: QuickChatMessages = {
  label: "Sessão deste vídeo",
  open: "Abrir sessão deste vídeo",
  fresh: "Nova sessão",
  expand: "Expandir sessão à esquerda",
  minimize: "Minimizar",
  about: (name: string) => `Sobre “${name}”`,
  placeholder: "O que você quer fazer com este vídeo? Digite / para usar ferramentas",
  hint: "O agente trabalha nele aqui mesmo",
  failed: (message: string) => `Não foi possível enviar: ${message}`,
  untitled: "Vídeo",
  send: "Enviar",
};
