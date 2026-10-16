import type { OnboardingMessages } from './onboarding-copy.ts';

export const ptBR: OnboardingMessages = {
  dialogLabel: 'Boas-vindas ao BaoCut',
  stepsLabel: 'Etapas de configuração',
  step: {
    agent: 'Conectar um agente',
    asr: 'Reconhecimento de fala',
    tts: 'Síntese de fala',
    semantic: 'Busca semântica',
    image: 'Geração de imagens',
    music: 'Geração de música',
  },
  title: {
    agent: 'Boas-vindas ao BaoCut',
    asr: 'Baixar modelos de reconhecimento de fala',
    tts: 'Baixar modelos de síntese de fala',
    semantic: 'Instalar a busca semântica',
    image: 'Baixar modelos de geração de imagens',
    music: 'Baixar modelos de geração de música',
  },
  lead: {
    agent:
      'Descreva o vídeo que você quer, e um agente transcreve, adiciona legendas, traduz, dubla e edita para você. O BaoCut usa os agentes deste computador (como Claude Code ou Codex) com sua própria conta, sem custo extra.',
    asr: 'Transcrever, adicionar legendas e editar vídeos de fala começam por transformar a fala em texto. Os modelos rodam neste computador e funcionam offline.',
    tts: 'Os modelos de síntese de fala leem textos em voz alta, clonam uma voz a partir de uma gravação e dublam vídeos traduzidos. Escolha um ou dois para começar; baixe outros depois em Configurações › Síntese de fala.',
    semantic:
      'Encontra o que foi dito e mostrado pelo significado: a busca do Space, a escolha de material por tema, a combinação de imagens e a memória de tradução usam esse recurso. Depois de instalada, seus vídeos existentes são indexados em segundo plano.',
    image: 'Gere imagens a partir de uma frase neste computador, para capas e ilustrações. Os modelos são grandes e a geração é lenta.',
    music:
      'Gere música de fundo e canções a partir de um estilo ou de uma letra neste computador, prontas para adicionar à faixa de música de um vídeo. A geração é lenta: alguns minutos para cada 30 segundos.',
  },
  where: {
    tts: {
      title: 'Use em Ferramentas › Gerar fala',
      body: 'Escreva um texto, ou escolha um documento ou legendas no Space, e depois escolha um modelo e uma voz. Os modelos que você ainda não baixou também podem ser baixados lá.',
    },
    image: { title: 'Use em Ferramentas › Gerar imagem', body: 'Descreva a imagem em uma frase. Os agentes também usam esse recurso para criar capas.' },
    music: {
      title: 'Use em Ferramentas › Gerar música',
      body: 'Escolha um estilo e escreva a letra. A música é salva no Space e pode ser adicionada aos seus vídeos.',
    },
  },
  diarizes: 'Diferencia os falantes ao transcrever',
  needsDiarization: (pack) => `Para diferenciar os falantes, baixe também “${pack}”`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 vozes predefinidas · descreva um estilo de fala em uma frase',
    'qwen3-tts-0.6b-base': 'Clona uma voz a partir de uma gravação de 3 segundos',
    voxcpm2: 'Clona uma voz a partir de uma gravação · descreva um estilo · 30 idiomas e cantonês',
    'qwen-image-2.1-turbo': 'Destilado · 8 etapas fixas · mais de duas vezes mais rápido que o modelo base',
    'qwen-image-2.1': 'Modelo base · mais lento, mais etapas',
    'yue2-3b': 'Gera a partir de um estilo ou de uma letra · alguns minutos para cada 30 segundos',
  },
  recommended: 'Recomendado',
  installed: 'Instalado',
  missingParts: 'Componentes ausentes',
  planLine: (parts) => `Baixados juntos: ${parts}`,
  downloading: (name) => `Baixando ${name}`,
  inBackground: 'Baixando em segundo plano',
  bgNote: 'Antes de baixar, você verá de onde vem e onde será salvo. O download só começa depois que você confirmar e roda em segundo plano, então não é preciso esperar.',
  asrAlt: 'Não quer baixar nada? Você também pode adicionar reconhecimento de fala na nuvem depois em Configurações › Provedores de API.',
  unsupported: 'Este computador não consegue rodar esses modelos. Você pode pular esta etapa.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agentes neste computador',
  agentChecking: 'Procurando agentes neste computador…',
  agentMissingBody: 'Marque os que você quer e o BaoCut os instala em segundo plano. Depois de instalados, entre uma vez com a conta que você já tem.',
  agentNote:
    'Os agentes marcados aparecem no menu de agentes das novas sessões. A instalação roda em segundo plano, então não é preciso esperar. Escolha o padrão ou adicione mais em Configurações › Provedores de agentes.',
  agentInstalled: 'Instalado neste computador',
  agentFix: (problem) => `${problem} · Resolva em Configurações › Provedores de agentes`,
  agentManual: 'Instale no terminal seguindo as instruções oficiais · Veja Configurações › Provedores de agentes',
  agentNotInstalled: (plan) => (plan ? `Não instalado · Depois de instalar, entre com: ${plan}` : 'Não instalado'),
  agentWillInstall: (method, command, login) =>
    `Será instalado em segundo plano com ${method} (${command}) · Depois, execute ${login} no terminal para entrar`,
  agentInstalling: (method, login) => `Instalando em segundo plano com ${method} · Depois, execute ${login} no terminal para entrar`,
  agentInstallingLabel: (name) => `Instalando ${name}`,
  agentInstallFailed: 'Não foi possível instalar · Os detalhes estão em Tarefas em segundo plano',

  next: 'Avançar',
  finish: 'Concluir',
  skip: 'Pular',
  exit: 'Sair da configuração',
  install: (n) => `Instalar ${n} em segundo plano e continuar`,
  download: (size, last) => `Baixar${size ? ` ${size}` : ''} em segundo plano e ${last ? 'concluir' : 'continuar'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Instalando ${name}${tail}` : kind === 'download' ? `Baixando ${name}${tail}` : `Preparando ${name}${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `Instalando ${n} em segundo plano` : kind === 'download' ? `Baixando ${n} em segundo plano` : `Preparando ${n} em segundo plano`,
    idle: (kind) =>
      kind === 'install' ? 'Instalações em segundo plano' : kind === 'download' ? 'Downloads em segundo plano' : 'Downloads e instalações em segundo plano',
    done: (kind, n) => {
      const s = n > 1 ? 's' : '';
      return kind === 'install' ? `${n} instalado${s}` : kind === 'download' ? `${n} baixado${s}` : `${n} concluído${s}`;
    },
    failed: (kind, n) => {
      const s = n > 1 ? 's' : '';
      return kind === 'install' ? `${n} não instalado${s}` : kind === 'download' ? `${n} não baixado${s}` : `${n} não concluído${s}`;
    },
  },
  closedToast: (models, agents) => {
    const parts = [
      ...(models ? [models === 1 ? '1 modelo está sendo baixado' : `${models} modelos estão sendo baixados`] : []),
      ...(agents ? [agents === 1 ? '1 agente está sendo instalado' : `${agents} agentes estão sendo instalados`] : []),
    ];
    return `${parts.join(' e ')} em segundo plano. ${models + agents === 1 ? 'Ele ficará pronto para uso ao terminar.' : 'Eles ficarão prontos para uso ao terminarem.'}`;
  },
  viewTasks: 'Ver tarefas em segundo plano',
};
