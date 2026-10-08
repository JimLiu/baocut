import type { ProvidersAgentMessages } from './providers-agent.ts';

export const ptBR: ProvidersAgentMessages = {
  codexUpgradeHint: 'Atualize o Codex CLI (por exemplo, npm install -g @openai/codex@latest) e verifique novamente',
  codexImageModel: 'Geração de imagens do Codex (modelo escolhido pelo Codex e sua conta)',
  codexImageNotes: 'Gera com a conta Codex conectada neste computador: um PNG por vez, uma tarefa por vez, geralmente em um ou dois minutos. Não é possível definir tamanho e seed (pedidos que os incluem são rejeitados), e o tamanho em pixels depende do resultado. Usa a cota da sua assinatura; a cota restante é desconhecida. Ativar significa concordar em enviar prompts para sua conta Codex.',
  imagesOnly: (p) => `${p.label} só pode gerar imagens`,
  onePngOnly: (p) => `${p.label} gera um PNG por vez e não aceita tamanho ou seed`,
  unavailable: (p) => `${p.label} não está disponível: ${p.message}`,
  sessionNotStarted: (p) => `A sessão de ${p.label} não iniciou: ${p.error}`,
  timedOut: (p) => `A geração de ${p.label} não terminou em ${p.minutes} min e foi interrompida`,
  exited: (p) => `${p.label} saiu inesperadamente: ${p.message}`,
  notCompleted: (p) => `${p.label} não terminou esta geração: ${p.reason}`,
  turnInterrupted: 'o turno foi interrompido',
  noImage: (p) => `${p.label} não gerou imagem`,
  noImageReply: (p) => `${p.label} não gerou imagem: ${p.reply}`,
  unknownError: 'Erro desconhecido', processExited: 'O processo saiu',
  turnNotStarted: (p) => `O turno não iniciou: ${p.error}`,
};
