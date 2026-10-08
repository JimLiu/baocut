import type { ServicesApiMessages } from './services-api-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ServicesApiMessages = {
  capabilities: { transcribe: 'Transcrever', synthesizeSpeech: 'Sintetizar fala', generateImage: 'Gerar imagens', generateText: 'Gerar texto' },
  endpoints: { models: 'Listar modelos', model: 'Obter um modelo', info: 'Informações do serviço e versão da interface', transcriptions: 'Transcrever áudio', speech: 'Sintetizar fala', images: 'Gerar imagens', chat: 'Gerar texto (conversa)' },
  routing: {
    online: { label: 'Serviços online', desc: 'Encaminhar solicitações para serviços de nuvem conectados (pode ter custo; os dados saem deste computador)' },
    nodes: { label: 'Nós da LAN', desc: 'Encaminhar solicitações para outros computadores pareados' },
    agent: { label: 'Agentes', desc: 'Encaminhar solicitações para runtimes de agentes conectados neste computador (como Codex)' },
  },
  modelsAvailable: (n) => pluralForm('pt-BR', n, { one: `${n} modelo disponível`, other: `${n} modelos disponíveis` }),
  notRouted: 'Há modelos disponíveis, mas o roteamento está desativado para a categoria deles; as solicitações recebem 503 por enquanto',
  noModels: 'Ainda não há modelos disponíveis; as solicitações recebem 503 por enquanto',
  defaultModel: 'Modelo padrão', target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: 'Não é possível encontrar este provedor; as solicitações recebem 404',
  aliasNotRouted: 'O roteamento está desativado para esta categoria; as solicitações recebem 404',
  aliasProviderUnavailable: 'Este provedor não está disponível agora', aliasModelUnavailable: 'Este modelo não está disponível agora',
  targetNotRouted: 'Roteamento desativado', targetUnavailable: 'Indisponível agora',
  aliasNameEmpty: 'Insira um nome, como whisper-1',
  aliasNameSlash: 'Nomes não podem conter “/”: <provider>/<model> é a forma canônica, e aliases não podem coincidir com ela',
  aliasNameChars: 'Use apenas letras, dígitos e . _ : -, começando com uma letra ou dígito',
  aliasNameTaken: (name) => `“${name}” já existe; para alterar o destino, exclua essa linha primeiro`,
};
