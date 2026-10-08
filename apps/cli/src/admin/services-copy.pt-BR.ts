import type { ServicesMessages } from './services-copy.ts';
import { pluralForm } from '@baocut/protocol';
import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';

export const ptBR: ServicesMessages = {
  accessLinkVideo: (video) => `Depois de entrar, o editor do vídeo ${video} abre diretamente`,
  help: `Uso:
  baocut services [status]         Serviços externos: estado, endereço, nível e escopo do
                                   serviço MCP, API de modelos, serviço web e nó da rede local
  baocut services start <service>  Iniciar um serviço (mcp, model-api, web, node)
  baocut services stop <service>   Parar um serviço (desconecta conexões externas e cancela pedidos aguardando
                                   confirmação; tarefas já enviadas terminam normalmente)
  baocut services configure <service> [options]
    --port <port>                  Porta de escuta (apenas endereço de loopback; MCP usa ${MCP_DEFAULT_PORT} e API de modelos
                                   ${MODEL_API_DEFAULT_PORT}); se estiver ocupada, o serviço informa erro em vez de mudar de porta
    --level read|ask|auto          read é somente leitura; ask exige confirmação de cada escrita, tarefa
                                   e geração no BaoCut (padrão); auto executa diretamente
    --videos all|<id,…>            Expor todos os vídeos ou apenas estes videoIds (separados por vírgulas); vídeos fora
                                   do escopo não ficam visíveis externamente (a API de modelos não tem escopo)
    --autostart on|off             Iniciar junto com o Runtime
    --route-online on|off          API de modelos: encaminhar para serviços on-line ativados (desativado por padrão, só modelos locais)
    --route-nodes on|off           API de modelos: encaminhar para nós da rede local emparelhados (desativado por padrão)
    --route-agent on|off           API de modelos: encaminhar para provedores de agentes (desativado por padrão)
    --max-concurrent <n>           API de modelos: pedidos em andamento por cliente (padrão 4); acima do limite recebem 429
    --read-only on|off             apenas web: o navegador só pode visualizar, não editar, enviar mensagens ou tarefas
    --methods default|<method,…>   apenas web: lista de métodos permitidos (nomes ou <namespace>.*), só pode restringir o padrão
  baocut services mcp add-client <name>
                                   Criar um token para um aplicativo externo (mostrado apenas
                                   uma vez); um por aplicativo, cada um pode ser revogado separadamente
  baocut services mcp clients      Listar clientes criados (sem tokens)
  baocut services mcp revoke <clientId>
                                   Revogar um cliente; seu token para de funcionar imediatamente
  baocut services mcp connection [clientId]
                                   Mostrar o endereço e um trecho para colar na configuração de um cliente
                                   MCP (com um espaço reservado para o token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clientes da API de modelos (endpoint local no estilo OpenAI), usados como acima;
                                   seus tokens não são intercambiáveis com os do MCP;
                                   connection mostra como definir OPENAI_BASE_URL e OPENAI_API_KEY
  baocut services model-api aliases
                                   Listar aliases de nomes de modelos (padrão whisper-1 → modelo local padrão de transcrição)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Adicionar ou alterar um alias; sem modelo, é usado o padrão do provedor
  baocut services model-api unalias <name>
                                   Excluir um alias
  baocut services web sessions     Listar sessões do navegador (sem tokens de sessão)
  baocut services web revoke <sessionId>
                                   Revogar uma sessão do navegador: sua conexão cai imediatamente`,
  webHelp: `Uso:
  baocut web open [--video <videoId>] [--launch]       Iniciar o serviço web (porta padrão ${WEB_DEFAULT_PORT}) e mostrar um link de acesso de uso único;
                                   o link funciona uma vez, por dois minutos. --video abre o vídeo diretamente no editor
                                   (videoId vem de baocut videos list). --launch abre a página de login sem o código no
                                   navegador padrão; o código de acesso aparece apenas no terminal para ser colado na
                                   página de login (não é passado nos argumentos do comando que abre o navegador)`,
  usage: 'Uso: baocut services [status | start <service> | stop <service>\n' + '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' + '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' + '                    [--read-only on|off] [--methods default|<method,…>]\n' + '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' + '       | mcp|model-api connection [clientId]\n' + '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' + '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `Serviço desconhecido: ${id}. Disponíveis: ${available.join(', ')}`, addClientUsage: (service) => `Uso: baocut services ${service} add-client <name> (escolha um nome reconhecível, como ${service === 'mcp' ? 'Claude Desktop' : 'Ferramenta de legendas'})`, aliasUsage: (capabilities) => `Uso: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (capacidades: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Capacidade desconhecida: ${capability}. Disponíveis: ${available.join(', ')}`, onOff: (flag) => `${flag} deve ser on ou off`, portRange: '--port deve ser um inteiro de 1 a 65535', levelChoice: (levels) => `--level deve ser um de: ${levels.join(', ')}`, videosFormat: '--videos deve ser all ou IDs de vídeo separados por vírgulas', maxConcurrentRange: '--max-concurrent deve ser um inteiro de 1 a 64', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent e --max-concurrent só se aplicam a model-api', methodsFormat: '--methods deve ser default ou nomes de métodos e <namespace>.* separados por vírgulas', webOnlyFlags: '--read-only e --methods só se aplicam ao serviço web', nothingToConfigure: 'Nada a alterar: informe --port, --level, --videos, --autostart, rotas e concorrência de model-api, ou --read-only e --methods para web', states: { off: 'Desativado', starting: 'Iniciando', on: 'Ativado', stopping: 'Parando', error: 'Erro' }, levels: { read: 'read (somente leitura)', ask: 'ask (confirmar cada escrita)', auto: 'auto (executar diretamente)' }, levelAskModelApi: 'ask (confirmar cada pedido de geração)', notProvided: (serviceId, label) => `${serviceId}  ${label}  Não disponível nesta versão`, port: (port) => `porta ${port}`, reason: (error) => `  Motivo: ${error}`, nodeHint: '  Use baocut share para porta, capacidades e emparelhamento', autostart: (on) => `  Iniciar com o Runtime: ${on ? 'sim' : 'não'}`, level: (level) => `  Nível: ${level}`, levelScope: (level, scope) => `  Nível: ${level}  Escopo: ${scope}`, allVideos: 'todos os vídeos', someVideos: (ids) => `${ids.length} ${pluralForm('pt-BR', ids.length, { one: 'vídeo', other: 'vídeos' })} (${ids.join(', ')})`, routeLocal: 'este computador', routeOnline: 'serviços on-line', routeNodes: 'nós da rede local', routeAgent: 'agente', routing: (routes, maxConcurrent) => `  Encaminha para: ${routes.join(', ')}  ${maxConcurrent} ${pluralForm('pt-BR', maxConcurrent, { one: 'pedido simultâneo', other: 'pedidos simultâneos' })} por cliente`, aliases: (aliases) => `  Aliases: ${aliases.length > 0 ? aliases.join(', ') : 'nenhum'}`, clientCount: (count) => `  Clientes: ${count}`, web: (readOnly, methods) => `  Somente leitura: ${readOnly ? 'sim' : 'não'}  Métodos permitidos: ${methods === null ? 'conjunto padrão' : methods.join(', ')}`, browserSessions: (count) => `  Sessões do navegador: ${count} (link de acesso: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'modelo padrão'} (${capability})`, noAliases: 'Nenhum alias. Adicione com baocut services model-api alias <name> <capability> <providerId>[/<modelId>]', noClients: (service) => `Nenhum cliente. Crie com baocut services ${service} add-client <name>`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  criado ${createdAt}  último uso ${lastUsedAt ?? 'nunca'}`, clientCreated: (name, clientId) => `Cliente criado: ${name} (${clientId})`, tokenOnce: (token) => `Token (mostrado apenas uma vez; copie e salve agora. Se perder, revogue o cliente e crie outro): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Cabeçalho: Authorization: Bearer <token>', header: (value) => `Cabeçalho: Authorization: ${value}`, interfaceVersion: (version) => `Versão da interface: ${version}`, snippetIntro: 'Trecho de configuração (substitua o espaço reservado pelo token recebido ao criar o cliente):', noWebSessions: 'Nenhuma sessão do navegador. Obtenha um link de acesso com baocut web open', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  login ${createdAt}  último uso ${lastUsedAt}  expira ${expiresAt}  ${connections} ${pluralForm('pt-BR', connections, { one: 'conexão', other: 'conexões' })}`, accessLinkNote: (expiresAt) => `Este link funciona uma vez e é válido até ${expiresAt}; não compartilhe. Depois de usado ou expirado, execute baocut web open novamente`, badAccessLink: 'O link de acesso não está no formato esperado: atualize o BaoCut ou execute novamente sem --launch', accessCode: (code) => `Código de acesso: ${code}`, launchNote: (loginUrl, expiresAt) => `Cole este código na página de login aberta no navegador (${loginUrl}). O código funciona uma vez e é válido até ${expiresAt}; não compartilhe. Depois de usado ou expirado, execute baocut web open novamente`, webNotStarted: (reason) => `O serviço web não iniciou: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} falhou: ${reason}`, clientRevoked: (clientId) => `Cliente revogado: ${clientId}; seu token para de funcionar imediatamente`, webSessionRevoked: (sessionId) => `Sessão revogada: ${sessionId}; sua conexão foi fechada`, browserFailed: (message) => `Não foi possível abrir o navegador: ${message}. Abra a página de login acima por conta própria`,
};
