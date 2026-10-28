import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const ptBR: TextModelChoiceMessages = {
  placeholder: 'Escolha um modelo de texto',
  providers: 'Provedores',
  agentReady: (provider) => `Agente · Usa sua assinatura do ${provider} · Mais lento que a API`,
  agentNote: (note) => `Agente · ${note}`,
  connected: (n) => (n === 1 ? 'Conectado · 1 modelo' : `Conectado · ${n} modelos`),
  notConnected: 'Não conectado · Conecte nas Configurações',
  settings: 'Gerenciar modelos de texto…',
  settingsSub: 'Conectar provedores de API · Modelo padrão',
};
