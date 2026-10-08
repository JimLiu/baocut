import type { ToolOutputsMessages } from './tool-outputs.ts';

export const ptBR: ToolOutputsMessages = {
  actionLabel: { 'open-movie': "Abrir no editor", 'new-movie': "Novo vídeo a partir deste" },
  blockTextOnly: "Transcrições e legendas precisam de um arquivo de vídeo ou áudio para criar um vídeo; ainda não é possível fazer isso daqui",
  blockTrashed: "Restaure este item da Lixeira primeiro",
  blockGenerating: "Ainda gerando; disponível quando terminar",
  blockMissing: "Não é possível encontrar o arquivo deste resultado neste computador",
  handover: {
    subtitle: "Traduza estas legendas para outro idioma, mantendo os códigos de tempo.",
    document: "Escreva um resumo desta transcrição.",
    audio: "Crie um vídeo com este áudio.",
    image: "Crie um vídeo com esta imagem como capa.",
    'video-file': "Adicione legendas a este vídeo.",
    export: "Adicione legendas a este vídeo.",
    video: "Continue editando este vídeo.",
  },
  handoverDefault: "Continue trabalhando neste resultado.",
};
