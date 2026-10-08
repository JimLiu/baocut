import type { ToolFrameMessages } from './tool-frame.ts';

export const ptBR: ToolFrameMessages = {
  noneAvailable: (noun) => `Ainda não há ${noun} disponível; configure nas Configurações`,
  pickOne: (noun) => `Escolha primeiro: ${noun}`,
  notInstalled: (name) => `A instalação de ${name} ainda não foi feita`,
  notConnected: (provider) => `Ainda não há conexão com ${provider}`,
  unavailable: (name, why) => `${name} · ${why ?? 'Indisponível'}`,
  notInstalledWarning: (name) => `A instalação de ${name} ainda não foi feita. Escolha um já instalado ou baixe nas Configurações`,
  notConnectedWarning: (provider) => `Ainda não há conexão com ${provider}. Escolha um que funcione ou conecte nas Configurações`,
  noModel: (noun, local) => local ? `Ainda não há ${noun} disponível. Instale um modelo local ou conecte um serviço de nuvem nas Configurações.` : `Ainda não há ${noun} disponível. Conecte um serviço de nuvem nas Configurações.`,
};
