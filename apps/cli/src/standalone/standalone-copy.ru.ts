import type { StandaloneMessages } from './standalone-copy.ts';

export const ru: StandaloneMessages = {
  cliHelp: `Использование:
  baocut cli install               Устанавливает этот пакет командной строки для текущего пользователя и помещает baocut в
                                   PATH. Пакет копируется в ~/.local/share/baocut/versions/<версия> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<версия>), если его там ещё нет. macOS: ссылка
                                   ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, а эта папка
                                   добавляется в PATH пользователя. Права администратора не нужны
  baocut cli status                Где лежит baocut, на какую установленную версию он указывает и какой baocut находит ваш
                                   терминал
  baocut cli remove                Удаляет то, что поместил baocut cli install; установленные версии остаются. То, что
                                   лежит по этому пути и было положено туда не BaoCut, никогда не заменяется и не удаляется`,
  help: `baocut update [--check | --rollback]

Обновляет отдельный пакет командной строки: читает тот же канал выпусков, что и приложение BaoCut, скачивает пакет
командной строки последнего выпуска, проверяет его размер и sha256 (а в macOS ещё подпись и нотаризацию), устанавливает
его рядом с текущей версией и перенаправляет на него baocut. Предыдущая версия остаётся для --rollback; более старые,
которыми больше не пользуется ни один Runtime, удаляются.
  --check      Только сообщить, есть ли более новая версия
  --rollback   Вернуться к предыдущей версии
Уже запущенный Runtime работает на старой версии, пока не остановится (baocut runtime stop).
Так обновляется только отдельный пакет: приложение BaoCut обновляется само, установка Homebrew — через brew upgrade.
Задайте BAOCUT_UPDATE_APPCAST, чтобы читать другой канал (URL или локальный файл, для тестирования).`,
  version: (version, build) => `${version} (Build ${build})`,
  state: {
    none: 'Не установлен',
    current: 'Указывает на текущую версию',
    stale: 'Указывает на другой BaoCut',
    broken: 'Указывает на место, которого больше нет',
    foreign: 'Там что-то другое (не трогаем)',
  },
  statusPackage: (version, root) => `Пакет     ${version}  ${root}`,
  statusVersions: (versions, root) => `Версии    ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `В ${root} пока ничего не установлено: baocut cli install скопирует туда этот пакет`,
  currentMark: ' (текущая)',
  previousMark: ' (предыдущая)',
  copied: (dest, from) => `Пакет скопирован в ${dest}; ${from} больше не нужен`,
  versionsKept: (dir) => `Установленные версии остаются в ${dir}: чтобы удалить их, удалите эту папку`,
  entryTaken: (path) =>
    `${path} положен туда не BaoCut, поэтому его не трогаем. Переместите или удалите его сами, затем снова выполните baocut cli install`,
  pathFailed: (dir) => `Не удалось добавить ${dir} в PATH пользователя: добавьте эту папку в «Свойства системы → Переменные среды»`,
  copyFailed: (from, dest, detail) => `Не удалось скопировать ${from} в ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update принимает --check или --rollback (что-то одно): ${token}`,
  updateUnavailable:
    'baocut update обновляет отдельный пакет командной строки. Этот baocut принадлежит приложению BaoCut, которое обновляется само (BaoCut → Проверить обновления), или Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Установлена последняя версия: ${current}`,
  available: (latest, current) => `Доступна версия ${latest} (у вас ${current})`,
  downloading: (version, build, megabytes) => `Скачивание ${version} (Build ${build}), ${megabytes} МБ…`,
  updated: (from, to) => `Обновлено: ${from} → ${to}`,
  rolledBack: (from, to) => `Выполнен возврат с ${from} на ${to}`,
  rollbackHint: 'Чтобы вернуться: baocut update --rollback',
  entrySwitched: (path) => `${path} теперь указывает на эту версию`,
  entryNotInstalled: (path) => `${path} не установлен: baocut cli install помещает baocut в PATH`,
  entryLeftAlone: (path) =>
    `${path} указывает не на этот пакет, поэтому его не трогали: baocut cli install направит его сюда`,
  removedVersions: (versions) => `Удалены более старые версии: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Runtime (pid ${pid}) ещё работает на версии, с которой запустился; когда он остановится, следующая команда запустит новую (baocut runtime stop остановит его сейчас)`,
  systemTooOld: (required, system) => `Новой версии нужна macOS ${required}; на этом Mac — ${system}`,
  feedFailed: (url, detail) => `Не удалось прочитать канал выпусков ${url}: ${detail}`,
  feedMissing: (url) => `В канале выпусков ${url} пока нет пакета командной строки: попробуйте после следующего выпуска`,
  downloadFailed: (url, detail) => `Не удалось скачать ${url}: ${detail}`,
  verifyFailed: (detail) => `Скачанный пакет не прошёл проверку и не установлен: ${detail}`,
  unsignedBuild:
    'Этот пакет не подписан, поэтому не может проверить подпись обновления. Скачайте отдельный пакет со страницы выпусков BaoCut',
  noPrevious: (dir) => `В ${dir} нет предыдущей версии, к которой можно вернуться`,
  inProgress: (pid) => `Уже выполняется другой baocut update (pid ${pid}): дождитесь его завершения`,
};
