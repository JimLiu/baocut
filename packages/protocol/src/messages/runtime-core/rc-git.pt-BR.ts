import type { RcGitMessages } from './rc-git.ts';

export const ptBR: RcGitMessages = {
  gitPurpose: 'Faz commit no git dos arquivos do BaoCut de um projeto (opcional)',
  gitMissingRemedyMac: 'Instale o git: execute xcode-select --install no Terminal para obter as Command Line Tools, ou instale com o Homebrew (brew install git)',
  gitMissingRemedyWin: 'Instale o Git for Windows em https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Instale o git com o seu gerenciador de pacotes',
  xcodeStub: '/usr/bin/git só oferece instalar as Command Line Tools até que elas estejam instaladas',

  notRepo: 'Este projeto não está em um repositório git',
  initRemedy: 'Use “Inicializar o git” nas configurações do projeto do app para desktop do BaoCut ou execute baocut projects git-init, ou execute você mesmo git init onde quiser o repositório',
  initHome: 'O BaoCut não cria um repositório git na sua pasta pessoal: para outras ferramentas, todas as pastas dentro dela pareceriam parte de um mesmo repositório',
  initUserFolder: (p) =>
    `O BaoCut não cria um repositório git em uma pasta de usuário padrão (${p.path}): para outras ferramentas, todas as pastas dentro dela pareceriam parte de um mesmo repositório`,
  initVolumeRoot: 'O BaoCut não cria um repositório git na raiz de um volume ou unidade',
  initInsideRepo: 'Este projeto já está em um repositório git',
  initElsewhere: 'Primeiro mova o projeto para uma pasta própria, ou execute git init você mesmo onde quiser o repositório',
  pausedLocked: 'Outro comando do git está usando o repositório (index.lock existe)',
  lockedRemedy:
    'Deixe o outro comando do git terminar. O BaoCut tenta de novo no próximo commit e nunca apaga o arquivo de trava; se nenhum comando do git estiver rodando, remova a trava você mesmo',
  pausedMerge: 'O repositório está no meio de um merge',
  pausedRebase: 'O repositório está no meio de um rebase',
  pausedCherryPick: 'O repositório está no meio de um cherry-pick',
  pausedRevert: 'O repositório está no meio de um revert',
  pausedBisect: 'O repositório está no meio de um bisect',
  pausedDetached: 'O HEAD está desanexado (o repositório não está em nenhum branch)',
  repoStateRemedy: 'Conclua ou cancele no git; depois disso o BaoCut volta a fazer commits',
  detachedRemedy: 'Mude para um branch no git; depois disso o BaoCut volta a fazer commits',
  pausedLocalConfig:
    'A configuração local do repositório executa programas ou inclui outros arquivos (filtros ou include), então o BaoCut não executa comandos do git que leiam seus arquivos',
  pausedLocalConfigChanged: 'Os filtros ou includes locais do repositório mudaram depois que você os permitiu, então o BaoCut pausou seus commits de novo',
  localConfigRemedy: 'Revise as entradas e os comandos que elas executam e depois permita-as nas configurações do projeto do app para desktop do BaoCut ou com baocut projects git-allow',
  gitFailed: (p) => `O git falhou neste repositório: ${p.detail}`,

  manageOnlyInAppOrCli: 'Só o aplicativo para desktop ou a CLI podem inicializar o git ou permitir filtros locais',
  digestChanged: 'A configuração local mudou depois de revisada; revise as entradas de novo',
  commitFailed: (p) => `Falha ao fazer commit no git: ${p.detail}`,
  initFailed: (p) => `Falha ao inicializar o git: ${p.detail}`,

  commitSummary: (p) => `Fazer commit no git dos arquivos do BaoCut do projeto "${p.name}"`,
  commitTitle: (p) => `BaoCut: atualizar ${p.names}`,
};
