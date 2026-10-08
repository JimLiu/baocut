import type { ServicesMessages } from './services.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ServicesMessages = {
  portRange: 'Insira um número de porta entre 1024 e 65535',
  portTaken: (port, service) => `${port} já é usada por “${service}”; escolha outra porta`,
  browser: 'Navegador',
  sessionMeta: (connections, ago, expires) => `${connections ? pluralForm('pt-BR', connections, { one: `${connections} conexão`, other: `${connections} conexões` }) : 'Nenhuma conexão'} · Ativo ${ago}${expires ? ` · Expira em ${expires}` : ''}`,
  runtime: { connected: 'Conectado', incompatible: 'Versão incompatível', disconnected: 'Não conectado' },
};
