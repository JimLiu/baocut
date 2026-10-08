import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: "iniciar a instalação",
  check: "verificar atualizações",
  download: "iniciar o download",
  cancel: "cancelar o download",
  retry: "Tentar novamente",
  downloadPage: "abrir a página de download",
};

export const ptBR: UpdateMessages = {
  failed: (step, message) => `Não foi possível ${STEP[step]}: ${message}`,
  progress: "Progresso do download",
  notes: "Novidades desta versão",
  close: "Fechar",
};
