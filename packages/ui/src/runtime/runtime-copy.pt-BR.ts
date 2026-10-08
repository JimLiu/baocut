import type { RuntimeMessages } from './runtime-copy.ts';

export const ptBR: RuntimeMessages = {
  missingContext: "RuntimeContext está ausente",
  mediaStatus: (status) => `O serviço de mídia retornou ${status}`,
  noRootSequence: "O novo vídeo não tem sequência principal",
  edit: {
    importAssets: "Importar mídias",
    setBackground: "Definir plano de fundo",
    addWaveform: "Adicionar forma de onda",
  },
  waveformName: "Forma de onda",
  noDuration: "O vídeo ainda não tem duração, por isso a forma de onda não foi adicionada",
  noOpenVideo: "Nenhum vídeo aberto",
  notCaughtUp: "O vídeo ainda não está atualizado e não pode ser alterado agora",
};
