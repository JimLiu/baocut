import type { RcGitMessages } from './rc-git.ts';

export const ru: RcGitMessages = {
  gitPurpose: 'Коммитит файлы BaoCut в проекте в git (необязательно)',
  gitMissingRemedyMac: 'Установите git: выполните xcode-select --install в Терминале, чтобы получить Command Line Tools, или установите его через Homebrew (brew install git)',
  gitMissingRemedyWin: 'Установите Git for Windows с https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Установите git через менеджер пакетов',
  xcodeStub: 'Пока Command Line Tools не установлены, /usr/bin/git лишь предлагает их установить',

  notRepo: 'Этот проект не находится в git-репозитории',
  initRemedy: 'Нажмите «Инициализировать git» в настройках проекта в настольном приложении BaoCut или выполните baocut projects git-init, либо сами запустите git init там, где нужен репозиторий',
  initHome: 'BaoCut не создаёт git-репозиторий в домашней папке: для других инструментов все папки внутри выглядели бы частью одного репозитория',
  initUserFolder: (p) =>
    `BaoCut не создаёт git-репозиторий в стандартной папке пользователя (${p.path}): для других инструментов все папки внутри выглядели бы частью одного репозитория`,
  initVolumeRoot: 'BaoCut не создаёт git-репозиторий в корне тома или диска',
  initInsideRepo: 'Этот проект уже находится в git-репозитории',
  initElsewhere: 'Сначала перенесите проект в отдельную папку или сами выполните git init там, где нужен репозиторий',
  pausedLocked: 'Репозиторий занят другой командой git (есть index.lock)',
  lockedRemedy:
    'Дождитесь завершения другой команды git. BaoCut повторит попытку при следующем коммите и никогда не удаляет файл блокировки; если ни одна команда git не выполняется, удалите блокировку сами',
  pausedMerge: 'В репозитории идёт слияние (merge)',
  pausedRebase: 'В репозитории идёт перебазирование (rebase)',
  pausedCherryPick: 'В репозитории идёт cherry-pick',
  pausedRevert: 'В репозитории идёт revert',
  pausedBisect: 'В репозитории идёт bisect',
  pausedDetached: 'HEAD отсоединён (репозиторий не находится ни на одной ветке)',
  repoStateRemedy: 'Завершите или отмените операцию в git; после этого BaoCut снова начнёт коммитить',
  detachedRemedy: 'Переключитесь на ветку в git; после этого BaoCut снова начнёт коммитить',
  pausedLocalConfig:
    'Локальная конфигурация репозитория запускает программы или подключает другие файлы (фильтры или include), поэтому BaoCut не выполняет команды git, читающие ваши файлы',
  pausedLocalConfigChanged: 'Локальные фильтры или include репозитория изменились после вашего разрешения, поэтому BaoCut снова приостановил коммиты',
  localConfigRemedy: 'Просмотрите записи и запускаемые ими команды, затем разрешите их в настройках проекта в настольном приложении BaoCut или через baocut projects git-allow',
  gitFailed: (p) => `Ошибка git в этом репозитории: ${p.detail}`,

  manageOnlyInAppOrCli: 'Инициализировать git и разрешать локальные фильтры можно только в настольном приложении или CLI',
  digestChanged: 'Локальная конфигурация изменилась после просмотра; просмотрите записи снова',
  commitFailed: (p) => `Не удалось закоммитить в git: ${p.detail}`,
  initFailed: (p) => `Не удалось инициализировать git: ${p.detail}`,

  commitSummary: (p) => `Закоммитить в git файлы BaoCut в проекте «${p.name}»`,
  commitTitle: (p) => `BaoCut: обновление ${p.names}`,
};
