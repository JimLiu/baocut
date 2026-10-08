import type { HomeBriefMessages } from './home-brief.ts';

export const ptBR: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `Cerca de ${[minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean).join(' ')}`,
  fromMaterials: 'Crie um vídeo com os materiais que anexei.',
  materials: (paths: readonly string[]) => `Materiais: ${paths.join(', ')}`,
  connectFirst: 'Conectar IA primeiro',
  sayFirst: 'Diga o que quer criar ou anexe materiais',
  agentOffTitle: 'Todos os agentes de código instalados estão desativados',
  agentOffBody: 'Há um agente de código instalado neste computador, mas desativado nas Configurações. Ative um para começar aqui mesmo.',
  enableNamed: (name: string) => `Ativar ${name}`,
  enableAgent: 'Ativar agente',
  agentMissingTitle: 'Isto precisa de um agente de código',
  agentMissingBody: 'Instale Claude Code ou Codex CLI e entre com sua própria assinatura, depois volte aqui para começar.',
  connectAgent: 'Conectar agente',
  nameEmpty: 'Insira um nome de projeto',
  nameInvalid: 'O nome do projeto não pode conter barras ou caracteres de controle',
};
