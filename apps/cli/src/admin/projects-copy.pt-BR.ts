import type { ProjectsMessages } from './projects-copy.ts';

export const ptBR: ProjectsMessages = {
  help: `Uso:
  baocut projects git-status [<projeto>]
                                   Status do git do projeto: repositório, branch, se o BaoCut pode fazer commit
                                   e por que está pausado (para fazer commit, baocut projects git-commit)
  baocut projects git-init [<projeto>]
                                   Inicializa o git na pasta do projeto (não na sua pasta pessoal, numa pasta
                                   padrão do usuário, na raiz de um volume nem dentro de outro repositório)
  baocut projects git-allow [<projeto>] [--yes]
                                   Mostra os filtros e include da configuração local do repositório e depois os
                                   permite: só então o BaoCut executa comandos do git que os executam
  baocut projects remove <projeto> [--yes]
                                   Remove o projeto do BaoCut: as sessões são excluídas; a pasta e os arquivos
                                   ficam no disco (abra a pasta de novo para trazer o projeto de volta)
  <projeto> é um ID, nome ou pasta de projeto; sem ele, o projeto que contém a pasta atual`,
  noProject: (cwd) => `Nenhum projeto contém ${cwd}. Informe um ID, nome ou pasta de projeto (baocut projects list)`,
  unknownProject: (text) => `Projeto não encontrado: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Há mais de um projeto chamado ${text}; informe o ID`,
  states: {
    ready: 'pronto',
    paused: 'pausado',
    'not-repo': 'fora de um repositório git',
    unavailable: 'git indisponível',
    error: 'erro',
  },
  head: (name, id) => `Projeto ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Branch: ${branch}`,
  detached: 'Branch: (HEAD desanexado)',
  version: (version) => `Versão do git: ${version}`,
  repo: (root) => `Repositório: ${root}`,
  autoCommit: (on) => `Commit automático: ${on ? 'ativado' : 'desativado'}`,
  lastCommit: (commit, auto, at) => `Último commit: ${commit.slice(0, 12)} (${auto ? 'automático' : 'manual'}, ${at})`,
  lastError: (message) => `Último erro: ${message}`,
  entriesHead: 'Filtros e include locais:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Revise-os e depois execute baocut projects git-allow para permiti-los',
  initDone: (root) => `git inicializado em ${root}`,
  nothingToAllow: 'Este repositório não tem filtros nem include locais aguardando permissão',
  allowPrompt: 'Permitir estas entradas? O BaoCut vai executar comandos do git que as executam [y/N] ',
  notTtyAllow: 'Fora de um terminal: revise as entradas com baocut projects git-status e execute de novo com --yes',
  notAllowed: 'Não permitido: os commits do BaoCut continuam pausados neste repositório',
  allowed: 'Permitido: o BaoCut volta a fazer commit neste repositório',
  removeHead: (name, id, dir) => `Projeto ${name} (${id}): ${dir}`,
  removeMissing: 'A pasta não está mais lá',
  removeEffect: (count) => `Remover exclui as ${count} sessões dele. A pasta e seus vídeos e arquivos ficam no disco`,
  removePrompt: 'Remover este projeto do BaoCut? [y/N] ',
  notTtyRemove: 'Fora de um terminal: confira o projeto com baocut projects list e execute de novo com --yes',
  notRemoved: 'Não removido',
  removed: (name, count) => `${name} foi removido do BaoCut e ${count} sessões foram excluídas. A pasta não foi alterada: abra-a de novo (ou execute baocut projects create <pasta>) para trazer o projeto de volta`,
};
