import { pluralForm } from '@baocut/protocol';
import type { AgentPolicy } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { AgentMessages } from './agent-copy.ts';

export const ptBR: AgentMessages = {

  pageTitle: "Provedores de agentes",

  factsLabel: "Como agentes funcionam",

  permissionsTitle: "Permissões do agente",
  lede: "Agente é assistente de código local, como Claude Code ou Codex. BaoCut chama direto para transcrever, traduzir e editar em uma frase.",

  facts: [
    { key: 'cli', title: "Usa o que você já tem", body: "Chama agente local da CLI, sem instalar outro." },
    { key: 'plan', title: "Usa sua própria assinatura", body: "Sem pagar extra ao BaoCut ou informar chave API." },
    { key: 'ask', title: "Pergunta antes de alterar", body: "Espera sua aprovação antes de gravar no vídeo, desfazível a qualquer momento." },
  ] as readonly { key: 'cli' | 'plan' | 'ask'; title: string; body: string }[],

  providersHeading: "Agentes neste computador",
  providersHint:
    "Detecta os instalados. Um agente funcional basta; se dúvida, Claude Code ou Codex. Integrados podem ser desativados; adicionados removidos.",

  providersMeta: (checked: string | null, builtin: number, added: number, found: number) =>
    `${checked ? `Verificados ${checked} · ` : ""}BaoCut tem ${builtin} integrados ${pluralForm('pt-BR', builtin, { one: "Agente", other: "Agentes" })}${added ? `, você adicionou ${added}` : ""}; ${found} detectados neste computador`,

  statusLabel: "Estado do agente",
  scanDone: (n: number) => (n ? `Verificação concluída · ${n} ${pluralForm('pt-BR', n, { one: "Agente", other: "Agentes" })} neste computador` : "Verificação concluída · nenhum agente instalado"),
  scanFailed: (message: string) => `Não foi possível verificar novamente: ${message}`,
  enableFailed: (message: string) => `Não foi possível ativar: ${message}`,
  scanning: "Verificando…",
  rescan: "Verificar novamente",
  emptyDisconnected: "Conecte ao Runtime para verificar agentes locais.",
  emptyNoDrivers: "Este Runtime não inclui agentes.",
  emptyNoneFound: "Nenhum agente local detectado; os comuns aparecem abaixo.",
  scanProgress: "Verificando agentes",
  faqLabel: "Perguntas frequentes",
  goCloudModels: "Ir aos modelos de nuvem",
  goSkills: "Ir às Skills",


  moreProviders: {
    title: (count: number) => `Outros agentes aceitos · ${count}`,
    sub: (names: string) => `${names} · nenhum detectado localmente`,
    expand: "Mostrar",
    collapse: "Esconder",
  },


  fullAccessOnly:
    "Não pode pedir aprovação por etapas; só Acesso total: não pergunta antes de comandos ou mudanças.",


  untested: {
    badge: "Não testado no BaoCut",
    body: "Ainda não concluiu sessão real no BaoCut. Detecção, login e modelos funcionam; problemas em sessão devem seguir documentação própria.",
  },


  catalog: {
    heading: "Adicionar mais agentes",
    hint: "Agentes ACP (Agent Client Protocol) também podem ser adicionados. Não verificados individualmente; funcionamento depende do teste.",
    custom: "Comando personalizado…",
    search: "Buscar agentes para adicionar",
    searchPlaceholder: "Buscar por nome, descrição ou comando",
    count: (total: number) => `${total} no catálogo`,
    found: (n: number) => `${n} encontrados`,
    list: "Agentes para adicionar",
    add: "Adicionar",
    addTo: (name: string) => `Adicionar ${name}`,
    added: "Adicionado",
    empty: (query: string) => `Sem correspondência para “${query}”. Para agente fora da lista, adicione pelo comando de início.`,
    landed: (name: string, custom: boolean) => `Adicionado ${name}${custom ? " (comando personalizado)" : ""} · após detectar, disponível nas sessões`,
    addFailed: (message: string) => `Não foi possível adicionar: ${message}`,
    webNote:
      "Não pode adicionar ou remover agentes no navegador porque define comandos locais. Use aplicativo desktop.",
  },


  customDialog: {
    title: "Adicionar agente com comando personalizado",
    lede: "Informe o comando ACP usado no terminal. BaoCut inicia direto, sem terminal.",
    name: "Nome",
    namePlaceholder: "Ex.: meu agente",
    id: 'id',
    idPlaceholder: "my-agent",
    idHint: "Identifica nas configurações e diagnóstico: minúscula inicial, apenas minúsculas, números e hífens.",
    command: "Comandos",
    commandPlaceholder: "my-agent --acp",
    commandHint: "Separa programa e argumentos por espaços; use aspas se argumento tem espaço.",
    commandParts: (exe: string, args: string[]) => `Inicia como: programa ${exe}, argumentos ${args.join(" · ")}`,
    env: "Variáveis de ambiente (opcional)",
    envPlaceholder: "MY_AGENT_TOKEN_FILE=~/.config/my-agent/token\nMY_AGENT_LOG=0",
    envHint: "Um KEY=VALUE por linha, só ao iniciar pelo BaoCut.",
    note: "Depois verifica se inicia, precisa de login e quais modelos possui. Aparece nas sessões após detecção.",
    cancel: "Cancelar",
    submit: "Adicionar",
    exists: (id: string) => `Um agente já usa “${id}”. Escolha outro ID.`,
  },


  added: {
    chip: "Adicionado por você",
    detect: "Verificação",
    detecting: "Verificando…",
    remove: "Remover",
    subFound: (version: string | null) => ["Detectado", version ? `v${version}` : null, "Conectado por ACP"].filter(Boolean).join(" · "),
    subLauncher: (launcher: string, needs: string) => `Ainda não verificado · ${launcher} baixa ao iniciar; exige ${needs}`,
    subMissing: (command: string) => `Ainda não verificado · ${command} não encontrado localmente`,
    note: (name: string) =>
      `${name} conecta por ACP (Agent Client Protocol). Não verificado pelo BaoCut; siga a documentação própria para instalação e conta.`,
    noInstall: "Sem instalação separada",
    noInstallBody: (launcher: string, spec: string, needs: string) =>
      `Quando o BaoCut inicia, ${launcher} baixa ${spec} automaticamente. Exige ${needs} neste computador.`,
    install: "Instalar neste computador seguindo as instruções oficiais",
    installBody: (command: string) => `Após instalar, ${command} deve executar no terminal.`,
    docs: "Abrir instruções oficiais",
    launch: "BaoCut inicia com este comando",
    launchCopy: "comando de início",
    envNote: (keys: string[]) => `Adiciona variáveis de ambiente ${keys.join(", ")} ao iniciar (valores não exibidos).`,
    login: "Se precisar de login, entre pelo próprio agente",
    loginBody: "Siga as instruções no terminal. Login na janela própria; BaoCut não trata conta ou senha.",
    detectStep: "Verificação",
    detectBody: "Inicia uma vez para confirmar conexão, login e modelos.",
    launchRow: "Comando de início",
    launchRowHint: "Inicia com este comando via ACP (Agent Client Protocol).",
    versionPinned: (spec: string) => `O comando fixa ${spec}. Para mudar versão, remova e adicione novamente com comando personalizado.`,
    versionOwn: "Atualize pela documentação própria, depois verifique aqui.",
    account: (name: string, signedOut: boolean) =>
      `${signedOut ? "Não conectado ou login expirado. " : ""}Login e cobrança ocorrem em ${name}; BaoCut não trata conta nem cobra extra.`,
    removeTitle: (name: string) => `Remover ${name}?`,
    removeBody: (name: string) =>
      `${name} será removido da lista com ativação e modelo padrão. Se padrão de novas sessões, outro agente disponível assume. Tarefas que usam terminam. Programa local inalterado, adicionável depois.`,
    removed: (name: string) => `Removida ${name}`,
    removeFailed: (message: string) => `Não foi possível remover: ${message}`,
  },


  codexImage: {
    title: "Desenhar com Codex",
    body: "Sem chave; usa assinatura Codex. Uma imagem por vez, ignora tamanho e qualidade, 5–10× mais lento que API. Ativado, bcut image e agentes podem escolher “Codex”. Nunca escolhido sozinho; defina padrão em Modelos › Geração de imagens › Modelos de nuvem.",
    checking: "Verificando se Codex local desenha…",
    on: "Ativado",

    period: ".",
    probeFailed: "Não foi possível verificar · clique “Verificar novamente”.",
    outdated: "Codex antigo · atualize CLI e ative",
    signedOut: "Codex não conectado · desenhos usam sua conta; entre antes de ativar.",
    notInstalled: "Codex ausente · instale CLI e entre antes de desenhar.",
    unavailable: (detail: string | null) =>
      detail ? `Codex não pode desenhar agora · ${detail}` : "Codex não pode desenhar · clique “Verificar novamente”.",
    turnedOn: "Desenhar com Codex ativado · agora no menu de modelos de imagem",
    turnedOff: "Desenhar com Codex desativado",
    toggleFailed: (enabled: boolean, message: string) =>
      enabled ? `Não foi possível ativar Desenhar com Codex: ${message}` : `Não foi possível desativar Desenhar com Codex: ${message}`,
  },


  faq: [
    {
      key: 'cost',
      title: "Preciso pagar ou assinar o BaoCut separadamente?",
      body: "Não. Agentes usam sua assinatura Claude ou ChatGPT, com custo e cota lá. BaoCut não inclui modelo próprio, não coleta chaves nem retransmite pela nuvem. Sem assinatura, ignore agentes; o resto funciona normalmente.",
    },
    {
      key: 'account',
      title: "BaoCut vê minha conta e senha?",
      body: "Não. Login na janela do agente. BaoCut só inicia localmente e entrega o vídeo. Pergunta antes de alterar; regras em Configurações › Privacidade e permissões.",
    },
    {
      key: 'cloud',
      title: "Como agente difere de modelos de nuvem?",
      body: "Agente usa assistente local com assinatura própria para várias etapas. Nuvem executa ferramentas diretas com chave API e cobrança por uso. Configurados separadamente.",
      link: "modelos",
    },
    {
      key: 'terminal',
      title: "Quer usar BaoCut por agentes no terminal?",
      body: "Sessões no BaoCut não exigem mais configuração. Para terminal ou outros aplicativos, instale a Skill do BaoCut; veja Configurações › Skills.",
      link: "skills",
    },
  ] as readonly { key: string; title: string; body: string; link?: 'models' | 'skills' }[],

  permissionsHeading: "Você decide quando perguntar",
  policyHeading: "Menos perguntas repetidas",
  policyHint: "Regras autorizam ações correspondentes; modo de acesso também decide perguntas.",

  policy: {
    read: { label: "Ler conteúdo do vídeo", desc: "Permite ver transcrição e configurações sem perguntar sempre." },
    bcutro: { label: "Consultar vídeos e progresso", desc: "Verifica informações e progresso; comandos não alteram vídeo." },
    loop: { label: "Responder a tarefas de IA", desc: "Recebe tarefas e envia respostas, com menos interrupções em várias etapas." },
  } as Record<keyof AgentPolicy, { label: string; desc: string }>,
  accessModes: "Modos de acesso",
  firstDefault: "Padrão inicial",
  alwaysAllowed: "Comandos sempre permitidos",
  saveFailed: (message: string) => `Não foi possível salvar: ${message}`,
  ruleRemoved: (rule: string) => `Regra removida ${rule}`,
  ruleRemoveFailed: (message: string) => `Não foi possível remover regra: ${message}`,

  modeHint: (firstDefault: string, last: string | null) =>
    `Escolha o modo abaixo do campo. Na primeira vez, padrão “${firstDefault}”; depois novas sessões mantêm a última escolha${last ? ` (atual “${last}”)` : ""}.`,

  advancedHeading: "Avançado e diagnóstico",
  advancedHint: "Se conectado, nada aqui precisa mudar.",
  modelAutoUpdate: {
    label: "Atualizar listas de modelos automaticamente",
    desc: "Ao iniciar e durante uso, atualiza modelos dos agentes ativados. Desativado: atualize manualmente nos detalhes.",
  },
  executableHint:
    "Busca PATH e locais comuns (Homebrew, npm global, ~/.local/bin). nvm/asdf/mise podem instalar em outro lugar; informe caminho completo. Vazio retoma busca automática.",
  techPanel: "Informações técnicas e locais",
  techTitle: "Informações técnicas do agente",
  techSubtitle: "Versões, caminhos e modelos disponíveis",
  techEmpty: "Sem verificações ainda.",
  techNotInstalled: "· Não instalado",
  techNoModels: "Sem lista de modelos",

  pathLabel: "caminho",
  diagnosticsLabel: "diagnostics",
  copyDiagnostics: "Copiar diagnóstico",
  locateTitle: "Definir local do agente manualmente",
  locateSubtitle: "Quando detecção automática não encontra",


  command: {
    copied: (label: string) => `Copiado ${label}`,
    copyFailed: "Não foi possível copiar. Selecione o texto e copie manualmente.",
    copy: (label: string) => `Copiar ${label}`,
    stop: "Parar",
    run: "Executar este comando",
    output: "Saída do comando",
    running: "Em execução",
    runningText: "Em execução…",
    done: "Concluído",
    stopped: "Parado. O que executou não é revertido; pode executar de novo.",
    failed: (reason: string) => `Não concluiu (${reason}). A saída explica; se exige senha, execute no terminal.`,
    runInTerminal: "Executar no terminal",
    exitCode: (code: number) => `código de saída ${code}`,
    startFailed: (error: string) => `não iniciou: ${error}`,
    killed: "o processo foi encerrado",
    confirmInstall: (name: string) => `Executar instalação de ${name}?`,
    confirmUpgrade: (name: string) => `Executar atualização de ${name}?`,
    confirmRun: "Em execução",
    cancel: "Cancelar",
    confirmBefore: "BaoCut executará o comando localmente. Saída abaixo, pode parar a qualquer momento.",
    confirmAfter: "Comandos com senha falham aqui; execute no terminal.",
    restored: (name: string) => `${name} voltou à busca automática`,
    switched: (path: string) => `Agora usando ${path}`,
    notFoundAt: (path: string, command: string) => `Nenhuma cópia executável de ${command} encontrada em ${path}`,
    saveFailed: (message: string) => `Não foi possível salvar local: ${message}`,
    locationLabel: (name: string) => `${name}: local`,
    locationPlaceholder: (command: string) => `/full/path/${command}`,
    locationSaved: "Definido manualmente. Limpe e salve para busca automática.",
    locationAuto: "Vazio = busca automática",
    save: "Salvar",
    restoreAuto: "Usar busca automática",
  },

  skills: {
    lede: "Skill é pasta com SKILL.md e referências opcionais que ensina um método ao agente. Ativada, usada automaticamente quando relevante; desativada, só quando escolhida em “+”. Mudanças de ativação, adição ou remoção valem da próxima nova sessão.",
    search: "Buscar Skills",
    filter: "Filtrar por origem",
    tab: (label: string, count: number) => `${label} ${count}`,
    tabLabel: (label: string, count: number) => `${label}, ${count}`,
    add: "Adicionar Skill",
    addFolder: "Adicionar pasta local",
    addGithub: "Importar do GitHub",
    loading: "Carregando Skills…",
    loadFailed: (message: string) => `Não foi possível carregar Skills: ${message}`,
    retry: "Tentar novamente",
    disconnected: "Não conectado ao Runtime; Skills listadas após conectar.",
    emptyTitle: "Sem Skills ainda",
    emptyBody:
      "Sem Skills disponíveis. Adicione pasta própria ou importe do GitHub. Terceiros ficam desativados; revise antes de ativar.",
    emptyWeb: "Sem Skills disponíveis. Navegador só visualiza e alterna; adicione ou importe no aplicativo desktop.",
    noMatch: (query: string) => `Nenhuma Skill para “${query}”`,
    noMatchHint: "Tente outra palavra ou “Todas”.",
    noneInTab: (label: string) => `Sem ${label} Skills ainda`,
    webNote: "Navegador visualiza e alterna; adicione, importe e remova pelo desktop.",
    view: (name: string) => `Ver ${name}`,
    enable: (name: string) => `Ativar ${name}`,
    toggledOn: (name: string) => `Ativada “${name}”: na próxima sessão, o agente usa quando relevante`,
    toggledOff: (name: string) => `Desativada “${name}”: só usa quando escolhida em “+”`,
    added: (name: string) => `Adicionada “${name}”`,
    imported: (name: string) => `Importada “${name}”, desativada por padrão`,
    removed: (name: string) => `Removida “${name}”`,
    diagnosticsTitle: (count: number) => `${count} ${pluralForm('pt-BR', count, { one: "pasta", other: "pastas" })} não puderam carregar`,
    diagnosticsHint: "Pastas não são Skills utilizáveis, ignoradas. Corrija e volte para recarregar.",
    diagnosticCode: { invalid: "Formato inválido", 'duplicate-id': "Nome duplicado", 'builtin-conflict': "Mesmo nome de Skill integrada" } as Record<string, string>,

    diagnosticLine: (dir: string, reason: string, issue: string) => `${dir} · ${reason}: ${issue}`,
    externalTitle: "Usar BaoCut com agentes no terminal ou outros aplicativos",
    externalBody:
      "Skills acima são para agentes internos. Para ensinar Claude Code ou Codex externos a transcrever, traduzir, editar e exportar, instale a Skill do BaoCut. Instalar globalmente em um clique e consultar locais e atualização virá depois.",
  },

  skillDetail: {
    close: "Fechar",
    stateOn: "Ativada: o agente usa quando relevante.",
    stateOff: "Desativada: só usa quando escolhida em “+”.",
    thirdPartyNote:
      "Skills de terceiros vêm de repositórios compartilhados; revise antes de ativar. BaoCut não executa arquivos de Skills, nem elas ampliam permissões.",
    source: "Fonte",
    location: "Local",
    version: "Versão",
    noVersion: "Não especificado",
    get reveal() {
      return revealLabel();
    },
    body: "SKILL.md",
    emptyBody: "Além do nome e descrição, SKILL.md não tem conteúdo.",
    files: (count: number) => `Arquivos (${count})`,
    back: "Voltar",
    notText: "Não é texto, não exibido aqui",
    tooLarge: "Arquivo grande demais, não exibido",
    loading: "Lendo…",
    loadFailed: (message: string) => `Não foi possível carregar: ${message}`,
    remove: "Remover",
    removeBuiltin: "Skills integradas não removíveis, mas desativáveis.",
    removeTitle: (name: string) => `Remover “${name}”?`,
    removeBody: (path: string) => `Exclui a pasta ${path} e todos os arquivos, irreversível. Sessões em andamento não mudam.`,
    cancel: "Cancelar",
  },

  skillGithub: {
    title: "Importar do GitHub",
    label: "URL do repositório",
    placeholder: "owner/repo",
    description: "Também pode colar URL completa, como https://github.com/owner/repo/tree/main/skills/name",
    note: "Baixa só arquivos da pasta apontada, sem executar. Skills importadas são de “Terceiros”, desativadas; só usadas escolhendo em “+”. Revise antes de ativar.",
    submit: "Importar",
    pending: "Baixando do GitHub…",
    cancel: "Cancelar",
  },
};
