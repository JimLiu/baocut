import type { ProjectsMessages } from './projects-copy.ts';

export const ru: ProjectsMessages = {
  help: `Использование:
  baocut projects git-status [<проект>]
                                   Состояние git проекта: репозиторий, ветка, может ли BaoCut делать коммиты
                                   и почему они приостановлены (коммит — baocut projects git-commit)
  baocut projects git-init [<проект>]
                                   Инициализировать git в папке проекта (не в домашней папке, стандартной
                                   папке пользователя, корне тома и не внутри другого репозитория)
  baocut projects git-allow [<проект>] [--yes]
                                   Показать фильтры и include в локальной конфигурации репозитория и разрешить их:
                                   только после этого BaoCut запускает команды git, которые их выполняют
  baocut projects remove <проект> [--yes]
                                   Удалить проект из BaoCut: его сессии удаляются, папка и файлы остаются на диске
                                   (откройте папку снова, чтобы вернуть проект)
  <проект> — ID, имя или папка проекта; без него — проект, содержащий текущую папку`,
  noProject: (cwd) => `Ни один проект не содержит ${cwd}. Укажите ID, имя или папку проекта (baocut projects list)`,
  unknownProject: (text) => `Проект не найден: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Несколько проектов называются ${text}; укажите ID`,
  states: {
    ready: 'готов',
    paused: 'приостановлен',
    'not-repo': 'не в репозитории git',
    unavailable: 'git недоступен',
    error: 'ошибка',
  },
  head: (name, id) => `Проект ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Ветка: ${branch}`,
  detached: 'Ветка: (отсоединённый HEAD)',
  version: (version) => `Версия git: ${version}`,
  repo: (root) => `Репозиторий: ${root}`,
  autoCommit: (on) => `Автокоммит: ${on ? 'вкл.' : 'выкл.'}`,
  lastCommit: (commit, auto, at) => `Последний коммит: ${commit.slice(0, 12)} (${auto ? 'автоматически' : 'вручную'}, ${at})`,
  lastError: (message) => `Последняя ошибка: ${message}`,
  entriesHead: 'Локальные фильтры и include:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Проверьте их, затем разрешите командой baocut projects git-allow',
  initDone: (root) => `git инициализирован в ${root}`,
  nothingToAllow: 'В этом репозитории нет локальных фильтров или include, ожидающих разрешения',
  allowPrompt: 'Разрешить эти записи? BaoCut будет запускать команды git, которые их выполняют [y/N] ',
  notTtyAllow: 'Не в терминале: проверьте записи командой baocut projects git-status, затем запустите снова с --yes',
  notAllowed: 'Не разрешено: коммиты BaoCut в этом репозитории остаются приостановленными',
  allowed: 'Разрешено: BaoCut снова делает коммиты в этом репозитории',
  removeHead: (name, id, dir) => `Проект ${name} (${id}): ${dir}`,
  removeMissing: 'Папки больше нет',
  removeEffect: (count) => `При удалении будут удалены его сессии (${count}). Папка с видео и файлами останется на диске`,
  removePrompt: 'Удалить этот проект из BaoCut? [y/N] ',
  notTtyRemove: 'Не в терминале: проверьте проект через baocut projects list и запустите снова с --yes',
  notRemoved: 'Не удалено',
  removed: (name, count) => `Проект ${name} удалён из BaoCut, удалено сессий: ${count}. Папка не тронута: откройте её снова (или выполните baocut projects create <папка>), чтобы вернуть проект`,
};
