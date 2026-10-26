import type { ProjectsMessages } from './projects-copy.ts';

export const es: ProjectsMessages = {
  help: `Uso:
  baocut projects git-status [<proyecto>]
                                   Estado de git del proyecto: repositorio, rama, si BaoCut puede confirmar
                                   y por qué está en pausa (para confirmar, baocut projects git-commit)
  baocut projects git-init [<proyecto>]
                                   Inicializa git en la carpeta del proyecto (no en tu carpeta personal, en una
                                   carpeta de usuario estándar ni en la raíz de un volumen, ni dentro de otro repositorio)
  baocut projects git-allow [<proyecto>] [--yes]
                                   Muestra los filtros e include de la configuración local del repositorio y luego
                                   los permite: solo entonces BaoCut ejecuta comandos de git que los ejecutan
  baocut projects remove <proyecto> [--yes]
                                   Quita el proyecto de BaoCut: se eliminan sus sesiones; la carpeta y sus
                                   archivos se quedan en el disco (abre la carpeta de nuevo para recuperarlo)
  <proyecto> es un ID, nombre o carpeta de proyecto; sin él, el proyecto que contiene la carpeta actual`,
  noProject: (cwd) => `Ningún proyecto contiene ${cwd}. Indica un ID, nombre o carpeta de proyecto (baocut projects list)`,
  unknownProject: (text) => `No existe el proyecto: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Hay más de un proyecto llamado ${text}; indica su ID`,
  states: {
    ready: 'listo',
    paused: 'en pausa',
    'not-repo': 'no está en un repositorio de git',
    unavailable: 'git no disponible',
    error: 'error',
  },
  head: (name, id) => `Proyecto ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Rama: ${branch}`,
  detached: 'Rama: (HEAD separado)',
  version: (version) => `Versión de git: ${version}`,
  repo: (root) => `Repositorio: ${root}`,
  autoCommit: (on) => `Confirmación automática: ${on ? 'activada' : 'desactivada'}`,
  lastCommit: (commit, auto, at) => `Última confirmación: ${commit.slice(0, 12)} (${auto ? 'automática' : 'manual'}, ${at})`,
  lastError: (message) => `Último error: ${message}`,
  entriesHead: 'Filtros e include locales:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Revísalos y luego ejecuta baocut projects git-allow para permitirlos',
  initDone: (root) => `git inicializado en ${root}`,
  nothingToAllow: 'Este repositorio no tiene filtros ni include locales pendientes de permitir',
  allowPrompt: '¿Permitir estas entradas? BaoCut ejecutará comandos de git que las ejecutan [y/N] ',
  notTtyAllow: 'No estás en una terminal: revisa las entradas con baocut projects git-status y vuelve a ejecutar con --yes',
  notAllowed: 'No permitido: las confirmaciones de BaoCut siguen en pausa en este repositorio',
  allowed: 'Permitido: BaoCut vuelve a confirmar en este repositorio',
  removeHead: (name, id, dir) => `Proyecto ${name} (${id}): ${dir}`,
  removeMissing: 'La carpeta ya no está',
  removeEffect: (count) => `Al quitarlo se eliminan sus ${count} sesiones. La carpeta y sus vídeos y archivos se quedan en el disco`,
  removePrompt: '¿Quitar este proyecto de BaoCut? [y/N] ',
  notTtyRemove: 'No estás en una terminal: revisa el proyecto con baocut projects list y vuelve a ejecutar con --yes',
  notRemoved: 'No se quitó',
  removed: (name, count) => `Se quitó ${name} de BaoCut y se eliminaron ${count} sesiones. La carpeta no se tocó: ábrela de nuevo (o ejecuta baocut projects create <carpeta>) para recuperar el proyecto`,
};
