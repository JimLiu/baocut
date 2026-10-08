import type { DriversPiMessages } from './drivers-pi.ts';

export const ptBR: DriversPiMessages = {
  plan: 'Contas de modelos no Pi', installHint: 'Instalar Pi com npm (npm install -g @earendil-works/pi-coding-agent, precisa de Node.js)',
  signedOut: 'Pi não está conectado. Execute pi em um terminal e digite /login ou defina uma chave de API para um provedor de modelos (por exemplo ANTHROPIC_API_KEY).',
  rpcFailed: (p) => `O modo RPC do Pi não iniciou: ${p.error}`, processStartFailed: (p) => `O processo do Pi não iniciou: ${p.error}`,
  processExited: (p) => `O processo do Pi saiu (code ${p.code}, signal ${p.signal})${p.tail ? `: ${p.tail}` : ''}`,
  processClosed: 'O processo do Pi está fechado', requestTimeout: (p) => `Pi não respondeu a ${p.command} em ${p.ms} ms`, stdinUnwritable: 'Não é possível gravar no stdin do Pi', commandFailed: (p) => `O comando ${p.command} do Pi falhou`,
  toolFallback: 'Ferramenta', sessionFileMissing: 'arquivo de sessão não encontrado', withStderr: (p) => `${p.error} (${p.tail})`,
  mcpNameInvalid: (p) => `O nome do servidor MCP ${p.name} tem caracteres que o Pi não aceita (somente letras, dígitos, _ e -), então não pode ser usado nesta sessão.`,
  modelFormat: (p) => `Modelos do Pi devem ser escritos como provider/id: ${p.model}`,
  switchModelFailed: (p) => `Pi não pôde trocar para o modelo ${p.model}: ${p.error}`,
  effortUnsupported: (p) => `Pi não tem o nível de esforço de raciocínio “${p.level}”, então este turno usa a configuração atual.`,
  effortFailed: (p) => `Pi não pôde definir o esforço de raciocínio (${p.error}), então este turno usa a configuração atual.`,
  mcpConnectFailed: (p) => `Pi não pôde conectar ao servidor MCP do BaoCut, então as ferramentas do BaoCut (ler e gravar projetos, legendas etc.) não estão disponíveis nesta sessão: ${p.error}`,
  extensionError: (p) => `Uma extensão do Pi falhou: ${p.error}`, modelCallFailed: 'A chamada de modelo do Pi falhou', notice: (p) => `Pi: ${p.message}`,
  extensionAsked: (p) => `Uma extensão do Pi queria perguntar algo${p.title ? ` (“${p.title}”)` : ''}. O BaoCut ainda não pode transmitir este tipo de pergunta, então o BaoCut a cancelou em seu lugar.`,
  fullAccessOnly: (p) => `Pi não tem como perguntar antes de cada ação, então o BaoCut só pode executá-lo no modo “${p.mode}”: não perguntará antes de executar comandos ou alterar arquivos.`,
};
