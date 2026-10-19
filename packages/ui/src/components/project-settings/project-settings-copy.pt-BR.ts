import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const ptBR: ProjectSettingsMessages = {
  menuItem: 'Configurações do projeto…',
  title: 'Configurações do projeto',
  close: 'Fechar configurações do projeto',
  done: 'Concluído',
  loading: 'Verificando o git',
  loadFailed: (message: string) => `Não foi possível verificar o git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'O BaoCut pode fazer commit dos snapshots de espaço de trabalho dos seus vídeos no repositório git em que o projeto está. O histórico de versões não precisa do git e funciona igual fora de um repositório.',
  branch: (name: string) => `Branch ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Verificar novamente',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Pronto',
  lightPaused: (label: string) => `Pausado · ${label}`,
  lightNotRepo: 'Não está em um repositório git',
  lightUnavailable: 'git não encontrado',
  lightError: 'Falha no git',
  pauseLocked: 'Repositório em uso',
  pauseMerge: 'Merge em andamento',
  pauseRebase: 'Rebase em andamento',
  pauseCherryPick: 'Cherry-pick em andamento',
  pauseRevert: 'Revert em andamento',
  pauseBisect: 'Bisect em andamento',
  pauseDetached: 'HEAD desanexado',
  pauseLocalConfig: 'Filtros locais',
  pauseLocalConfigChanged: 'Filtros locais alterados',

  pausedHeading: (label: string) => `Commits pausados: ${label}`,
  pausedNote:
    'Enquanto os commits estão pausados, o commit automático e “Fazer commit no git” aguardam. Abrir, editar e o histórico de versões não são afetados.',
  errorHeading: 'Falha no git',
  unavailableHeading: 'git não encontrado',

  lcEntry: 'Entrada',
  lcValue: 'Comando ou arquivo incluído',
  lcExplain:
    'Depois que você permitir, o BaoCut segue estas entradas quando executa o git (por exemplo, para a criptografia do git-crypt). A permissão fica salva só neste computador, não no projeto, e o BaoCut pausa de novo se as entradas ou os arquivos incluídos mudarem. Isso não é confiar na pasta: abrir, editar e os agentes não são afetados.',
  lcWeb:
    'Estas entradas só são listadas, e só podem ser permitidas, nas configurações do projeto do app para desktop do BaoCut (ou com baocut projects git-allow). Enquanto os commits estão pausados, abrir, editar e o histórico de versões não são afetados.',
  allow: 'Permitir',
  allowedTitle: 'Filtros locais permitidos',
  allowedText: 'A permissão fica salva neste computador, não no projeto. Agora você pode fazer commit.',
  allowFailed: 'Não permitido',

  commit: 'Fazer commit no git',
  committing: 'Fazendo commit',
  commitDesc: (maxMiB: number) =>
    `Faz commit só dos arquivos do BaoCut: os snapshots de espaço de trabalho dos vídeos alterados e as mídias de até ${maxMiB} MiB. Os outros arquivos do projeto e as alterações que você já preparou (staged) ficam como estão. O BaoCut não faz push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Último commit ${commit} · ${auto ? 'automático' : 'manual'} · ${ago}`,
  lastFailed: (message: string) => `A última tentativa falhou: ${message}`,
  committedTitle: 'Commit feito no git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Commit ${commit} feito: ${files === 1 ? '1 arquivo' : `${files} arquivos`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `“${name}”` : from === to ? `“${name}” versão ${to}` : `“${name}” versões ${from}–${to}`,
  unnamedVideo: 'um vídeo',
  nothingTitle: 'Nada para fazer commit',
  nothingText: 'Os arquivos do BaoCut estão iguais aos do último commit.',
  commitFailed: 'Commit não feito',

  autoCommit: 'Commit automático',
  autoCommitDesc:
    'Faz um commit depois que o projeto fica 5 minutos sem alterações, quando você fecha o último vídeo aberto do projeto ou quando sai do BaoCut. Todos os projetos deste computador compartilham esta configuração.',

  initTitle: 'Inicializar o git',
  initDesc: 'Crie um repositório git na pasta do projeto para poder fazer commit dos snapshots nele.',
  initWebNote: 'Só o app para desktop do BaoCut ou a CLI (baocut projects git-init) podem criar um repositório em uma pasta no computador do Runtime.',
  initRefused: (why: string) => `Não disponível aqui: ${why}`,
  initRefusedNote: 'Se precisar de um, mova os vídeos para uma pasta de projeto própria e inicialize o git nela.',
  refusalHome:
    'o projeto é a sua pasta pessoal. Com um repositório aqui, todas as pastas da sua pasta pessoal pareceriam parte dele para outras ferramentas.',
  refusalUserFolder:
    'o projeto é uma pasta de usuário padrão (como Mesa, Documentos, Downloads, Filmes, Música ou Imagens). Com um repositório aqui, todas as pastas dentro dela pareceriam parte dele para outras ferramentas.',
  refusalVolumeRoot: 'o projeto é a raiz de um disco. Com um repositório aqui, o disco inteiro pareceria parte dele.',
  refusalInsideRepo: 'o projeto já está em um repositório git.',
  initConfirmTitle: 'Inicializar o git na pasta do projeto?',
  initConfirmBody: (path: string) =>
    `Cria um repositório git em ${path}. As regras de ignorar do BaoCut ficam no próprio .git/info/ do repositório, então nenhum arquivo do projeto muda. Nenhum commit ou push é feito.`,
  cancel: 'Cancelar',
  initDoneTitle: 'git inicializado',
  initDoneText: 'Ainda não há commits. Use “Fazer commit no git” para fazer o primeiro commit.',
  initFailed: 'Não inicializado',

  recheckSame: 'Nada mudou',
  recheckReadyTitle: 'Pronto para fazer commit',
  recheckReadyText: 'O repositório não está mais pausado.',

  outsideHeading: 'Mídias fora do projeto',
  outsideLead:
    'Quando um vídeo usa mídias fora da pasta do projeto, o snapshot de espaço de trabalho registra o caminho da mídia (começando com ~/ dentro da sua pasta pessoal; caso contrário, o caminho completo). Depois de um commit ou push, os outros recebem só o caminho, não o arquivo. Para entregar as mídias também, use um pacote portátil.',

  stripLabel: 'git do projeto',
  projectSettings: 'Configurações do projeto',
};
