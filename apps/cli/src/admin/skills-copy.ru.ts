import { pluralForm } from '@baocut/protocol';
import type { SkillsMessages } from './skills-copy.ts';

export const ru: SkillsMessages = {
  skillsHelp: "Использование:\n  baocut skills add <folder>       Скопировать локальную папку Skill (SKILL.md в корне)\n                                   в <BAOCUT_HOME>/skills, по умолчанию включено\n  baocut skills import <source>    Импортировать Skill из GitHub: owner/repo, URL репозитория или\n                                   …/tree/<branch>/<folder>; по умолчанию отключено, проверьте перед включением\n    --id <id>                      Для add и import: задать другой id (по умолчанию из имени папки;\n                                   если id уже есть — отказ, без перезаписи)\n  baocut skills enable|disable <id>\n                                   Включить / отключить Skill: применяется со следующей новой сессии агента\n  baocut skills remove <id>        Удалить добавленный или импортированный Skill (встроенные можно только отключить)",
  added: "Добавлено",
  imported: "Импортировано",
  turnedOn: "Включено",
  turnedOff: "Отключено",
  reviewFirst: (id) => `Сначала проверьте (baocut skills read ${id}), затем включите через baocut skills enable ${id}`,
  takesEffectNextSession: "Применяется со следующей новой сессии агента; текущие сессии не затрагиваются",
  removed: (id, path) => `Удалено: ${id} (${path})`,
  localSource: (path, addedAt) => `локальная папка ${path} (${addedAt})`,
  remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? "вкл." : "выкл."}) → ${path}${source ? `
Источник: ${source}` : ""}`,
  idFormat: (flag, value) => `${flag} принимает id Skill (строчные буквы, слова через дефис, см. baocut skills): ${value}`,

  skillHelp: `Использование:
  baocut skill install [--dir <папка>]… [--agent agents|claude] [--copy]
                                   Устанавливает навык BaoCut для внешних агентов (как пользоваться BaoCut). По умолчанию в
                                   ~/.agents/skills/baocut (Codex и другие агенты) и ~/.claude/skills/baocut (Claude Code)
                                   как ссылки на навык внутри приложения BaoCut, поэтому он обновляется вместе с приложением
    --dir <папка>                  Установить вместо этого в <папка>/.agents/skills и <папка>/.claude/skills: любая папка,
                                   не только проект BaoCut; повторите для нескольких папок
    --agent agents|claude          Только одно из двух: .agents/skills или .claude/skills
    --copy                         Копировать вместо ссылки (копия не обновляется с приложением: установите заново)
  baocut skill status              Версия навыка в приложении, где он установлен и актуально ли каждое место,
                                   и команда baocut в вашем терминале
  baocut skill remove [--dir <папка>]… [--agent agents|claude] [--yes]
                                   Удалить: у ссылки удаляется только ссылка; для удаления копии нужен --yes.
                                   То, что лежит в baocut/ и не является навыком BaoCut, никогда не заменяется и не удаляется`,
  installedAt: (path, linkTarget) => `Установлено: ${path}${linkTarget ? ` → ${linkTarget}` : ' (копия)'}`,
  takesEffect: 'Действует в новой сессии агента',
  removedAt: (path) => `Удалено: ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} — ${paths.length === 1 ? 'копия' : 'копии'}: удаление сотрёт файлы вместе со сделанными там правками. Добавьте --yes, чтобы удалить`,
  unknownAgent: (value) => `--agent принимает agents (.agents/skills) или claude (.claude/skills): ${value}`,
  fixHint: 'Некоторые установки устарели или сломаны: baocut skill install (с тем же --dir) исправит их',
  statusSkill: (version, source, bundled) => `Навык     ${version ?? '?'}  ${source}${bundled ? '' : ' (сборка для разработки: создан Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'не входит в сборку (сборка для разработки)'}`,
  statusOnPath: (path, target, fromApp) => `Терминал  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (из этого приложения)' : ' (не из этого приложения)'}`,
  statusNotOnPath: (command) => `Терминал  baocut нет в PATH${command ? `; чтобы пользоваться им в любом терминале: ${command}` : ''}`,
  statusAddToPath: (dir) => `Терминал  baocut нет в PATH; чтобы пользоваться им в любом терминале, добавьте ${dir} в PATH пользователя`,
  appOutsideApplications: 'BaoCut запущен не из папки «Программы»: ссылки сломаются, если переместить или удалить приложение',
  globalHeading: 'Глобально',
  state: { none: 'Не установлен', current: 'Актуален', stale: 'Устарел', broken: 'Сломанная ссылка', foreign: 'Там что-то другое (не трогаем)' },
  mode: { link: 'Ссылка', copy: 'Копия' },
};
